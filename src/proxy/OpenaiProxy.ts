import express, { Request, Response } from "express";
import cors from "cors";
import * as http from "http";
import { z } from "zod";
import { LightningPaymentManager } from "../payments/LightningPaymentManager.js";
import { FORMAT_OPENAI } from "../common/constants.js";
import { Proof, Quote, Prompt } from "../common/types.js";
import { debugClient, debugError } from "../common/debug.js";
import { OpenaiAskExperts } from "../openai/OpenaiAskExperts.js";
import { SimplePool } from "nostr-tools";
import { ChatCompletionCreateParams } from "openai/resources";

/**
 * OpenAI Chat Completions API request schema
 */
const OpenAIChatCompletionsRequestSchema = z.object({
  model: z
    .string()
    .min(1)
    .describe(
      "Expert's pubkey, optionally followed by ?max_amount_sats=N to limit payment amount"
    ),
  messages: z
    .array(
      z.object({
        role: z.string(),
        content: z.string(),
        name: z.string().optional(),
      })
    )
    .min(1),
  temperature: z.number().optional(),
  top_p: z.number().optional(),
  n: z.number().optional(),
  stream: z.boolean().optional(),
  max_tokens: z.number().optional(),
  presence_penalty: z.number().optional(),
  frequency_penalty: z.number().optional(),
  logit_bias: z.record(z.string(), z.number()).optional(),
  user: z.string().optional(),
});

/**
 * OpenAI Chat Completions API response schema
 */
const OpenAIChatCompletionsResponseSchema = z.object({
  id: z.string(),
  object: z.string(),
  created: z.number(),
  model: z.string(),
  choices: z.array(
    z.object({
      index: z.number(),
      message: z.object({
        role: z.string(),
        content: z.string(),
      }),
      finish_reason: z.string(),
    })
  ),
  usage: z.object({
    prompt_tokens: z.number(),
    completion_tokens: z.number(),
    total_tokens: z.number(),
  }),
});

/**
 * OpenAI Chat Completions API request type
 */
type OpenAIChatCompletionsRequest = z.infer<
  typeof OpenAIChatCompletionsRequestSchema
>;

/**
 * OpenAI Chat Completions API response type
 */
type OpenAIChatCompletionsResponse = z.infer<
  typeof OpenAIChatCompletionsResponseSchema
>;

/**
 * OpenaiProxy class that provides an OpenAI-compatible API for NIP-174
 */
export class OpenaiProxy {
  private app: express.Application;
  private port: number;
  private basePath: string;
  private stopped = true;
  private server?: http.Server;
  private discoveryRelays?: string[];
  private pool = new SimplePool();

  /**
   * Creates a new OpenAIProxy instance
   *
   * @param port - Port number to listen on
   * @param basePath - Base path for the API (e.g., '/v1')
   * @param discoveryRelays - Optional array of discovery relay URLs
   */
  constructor(port: number, basePath?: string, discoveryRelays?: string[]) {
    this.port = port;
    this.basePath = basePath
      ? basePath.startsWith("/")
        ? basePath
        : `/${basePath}`
      : "/";
    this.discoveryRelays = discoveryRelays;

    // Create the Express app
    this.app = express();

    // Configure middleware
    this.app.use(cors());
    this.app.use(express.json({ limit: '1mb' }));

    // Set up routes
    this.setupRoutes();
  }

  /**
   * Sets up the API routes
   * @private
   */
  private setupRoutes(): void {
    // Health check endpoint
    this.app.get(`${this.basePath}health`, (req: Request, res: Response) => {
      if (this.stopped) res.status(503).json({ error: "Service unavailable" });
      else res.status(200).json({ status: "ok" });
    });

    // OpenAI Chat Completions API endpoint
    this.app.post(
      `${this.basePath}chat/completions`,
      this.handleChatCompletions.bind(this)
    );
  }

  /**
   * Handles requests to the chat completions endpoint
   *
   * @param req - Express request object
   * @param res - Express response object
   * @private
   */
  private async handleChatCompletions(
    req: Request,
    res: Response
  ): Promise<void> {
    if (this.stopped) {
      res.status(503).json({ error: "Service unavailable" });
      return;
    }

    try {
      // Extract the Authorization header
      const authHeader = req.headers.authorization;
      if (!authHeader || !authHeader.startsWith("Bearer ")) {
        res
          .status(401)
          .json({ error: "Missing or invalid Authorization header" });
        return;
      }

      // Extract the NWC string
      const nwcString = authHeader.substring(7); // Remove 'Bearer ' prefix

      // Validate the request body
      const parseResult = OpenAIChatCompletionsRequestSchema.safeParse(
        req.body
      );

      if (!parseResult.success) {
        const errorMessage = parseResult.error.errors
          .map((err) => `${err.path.join(".")}: ${err.message}`)
          .join(", ");

        res.status(400).json({
          error: "Invalid request format",
          details: errorMessage,
        });
        return;
      }

      const requestBody = parseResult.data;

      // Extract the expert pubkey and query parameters from the model field
      let expertPubkey = requestBody.model;
      let maxAmountSats: number | undefined;

      // Check if the model field contains query parameters
      const queryParamIndex = expertPubkey.indexOf("?");
      if (queryParamIndex !== -1) {
        const queryString = expertPubkey.substring(queryParamIndex + 1);
        expertPubkey = expertPubkey.substring(0, queryParamIndex);

        // Parse query parameters
        const params = new URLSearchParams(queryString);
        const maxAmountParam = params.get("max_amount_sats");
        if (maxAmountParam) {
          maxAmountSats = parseInt(maxAmountParam, 10);
          if (isNaN(maxAmountSats)) {
            maxAmountSats = undefined;
          }
        }
      }

      // Create a LightningPaymentManager for this request
      const paymentManager = new LightningPaymentManager(nwcString);

      // Create the client
      const client = new OpenaiAskExperts(paymentManager, {
        pool: this.pool,
        discoveryRelays: this.discoveryRelays,
      });

      try {
        const { quoteId, amountSats } = await client.getQuote(
          expertPubkey,
          requestBody as ChatCompletionCreateParams
        );

        if (maxAmountSats && amountSats > maxAmountSats) {
          res.status(402).json({
            error: "Payment failed",
            message: "Quoted price too high",
          });
          return;
        }

        const reply = await client.execute(quoteId);

        // Check if streaming is requested
        if (!requestBody.stream) {
          // Send the response as JSON
          res.status(200).json(reply);
        } else {
          // Handle streaming response
          // Set appropriate headers for streaming
          res.setHeader('Content-Type', 'text/event-stream');
          res.setHeader('Transfer-Encoding', 'chunked');
          res.setHeader('Connection', 'keep-alive');
          res.setHeader('Cache-Control', 'no-cache');
          
          // Send each chunk as it arrives
          try {
            // reply is an AsyncIterable<ChatCompletionChunk> when streaming is true
            const streamingReply = reply as AsyncIterable<any>;
            
            for await (const chunk of streamingReply) {
              if (!chunk) continue;

              // Each chunk needs to be formatted according to SSE protocol
              // Format: data: {JSON_DATA}\n\n
              const chunkStr = `data: ${JSON.stringify(chunk)}\n\n`;
              
              // Write the chunk to the response
              res.write(chunkStr);
              
              // Ensure the chunk is sent immediately
              // The flush method might not be available on all Response objects
              // Use as any to bypass TypeScript error
              if ((res as any).flush) {
                (res as any).flush();
              }
            }
            
            // End the stream with a "data: [DONE]" message
            res.write('data: [DONE]\n\n');
            res.end();
          } catch (error) {
            debugError("Error streaming response:", error);
            // If we encounter an error during streaming, try to end the response
            // if it hasn't been ended already
            try {
              res.end();
            } catch (e) {
              // Ignore errors when ending an already-ended response
            }
          }
        }
      } finally {
        // Clean up resources
        paymentManager[Symbol.dispose]();
        client[Symbol.dispose]();
      }
    } catch (error) {
      debugError("Error handling chat completions request:", error);
      const message = error instanceof Error ? error.message : String(error);
      res.status(500).json({
        error: message,
        message: message,
      });
    }
  }

  /**
   * Starts the proxy server
   *
   * @returns Promise that resolves when the server is started
   */
  async start(): Promise<void> {
    if (this.server) throw new Error("Already started");
    this.stopped = false;
    this.server = this.app.listen(this.port);
    debugClient(
      `OpenAI Proxy server running at http://localhost:${this.port}${this.basePath}`
    );
  }

  /**
   * Stops the proxy server
   *
   * @returns Promise that resolves when the server is stopped
   */
  stop(): Promise<void> {
    return new Promise<void>(async (resolve) => {
      // Mark as stopped
      this.stopped = false;

      if (!this.server) {
        resolve();
        return;
      }

      debugError("Server stopping...");

      // Stop accepting new connections
      const closePromise = new Promise((ok) => this.server!.close(ok));

      // FIXME: if clients have active requests, we
      // risk losing their money by cutting them off,
      // ideally we would stop accepting new requests,
      // and wait for a while until existing requests are over,
      // and start terminating only after that.

      // Wait until all connections are closed with timeout
      let to;
      await Promise.race([
        closePromise,
        new Promise((ok) => to = setTimeout(ok, 5000)),
      ]);
      clearTimeout(to);

      debugError("Server stopped");
      resolve();
    });
  }
}
