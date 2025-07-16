import express from "express";
import cors from "cors";
import * as http from "http";
import { randomUUID } from "node:crypto";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { isInitializeRequest } from "@modelcontextprotocol/sdk/types.js";
import { AskExpertsMCP } from "./AskExpertsMCP.js";
import { AskExpertsSmartMCP } from "./AskExpertsSmartMCP.js";
import { debugMCP, debugError } from "../common/debug.js";

/**
 * Options for the AskExpertsHttp server
 */
export interface AskExpertsHttpOptions {
  port: number;
  type: "mcp" | "smart";
  basePath?: string;
  discoveryRelays?: string[];
  openaiBaseUrl?: string;
  openaiApiKey?: string;
}

/**
 * AskExpertsHttp class that implements an MCP server with HTTP transport
 */
export class AskExpertsHttp {
  private app: express.Application;
  private port: number;
  private basePath: string;
  private type: "mcp" | "smart";
  private discoveryRelays?: string[];
  private openaiBaseUrl?: string;
  private openaiApiKey?: string;
  private transports: { [sessionId: string]: StreamableHTTPServerTransport } =
    {};
  private servers: { [sessionId: string]: AskExpertsMCP | AskExpertsSmartMCP } =
    {};
  private server?: http.Server;
  private stopped = true;

  /**
   * Creates a new AskExpertsHttp instance
   *
   * @param options - Configuration options
   */
  constructor(options: AskExpertsHttpOptions) {
    if (options.type === "smart" && !(this.openaiApiKey && this.openaiBaseUrl))
      throw new Error("OpenAI base URL and API key required for smart server");

    this.port = options.port;
    this.basePath = options.basePath
      ? options.basePath.startsWith("/")
        ? options.basePath
        : `/${options.basePath}`
      : "/";
    this.type = options.type;
    this.discoveryRelays = options.discoveryRelays;
    this.openaiBaseUrl = options.openaiBaseUrl;
    this.openaiApiKey = options.openaiApiKey;

    // Create Express app
    this.app = express();
    this.app.use(express.json());

    // Enable CORS
    this.app.use(cors());

    // Set up routes
    this.setupRoutes();
  }

  /**
   * Set up the Express routes
   */
  private setupRoutes(): void {
    // Handle POST requests for client-to-server communication
    this.app.post(`${this.basePath}mcp`, async (req, res) => {
      if (this.stopped) {
        res.status(503).send("Service not available");
        return;
      }

      // Check for existing session ID
      const sessionId = req.headers["mcp-session-id"] as string | undefined;
      let transport: StreamableHTTPServerTransport;

      if (sessionId && this.transports[sessionId]) {
        // Reuse existing transport
        transport = this.transports[sessionId];
      } else if (!sessionId && isInitializeRequest(req.body)) {
        // Extract NWC string from Authorization header
        const authHeader = req.headers.authorization;
        if (!authHeader || !authHeader.startsWith("Bearer ")) {
          res.status(401).json({
            jsonrpc: "2.0",
            error: {
              code: -32001,
              message: "Unauthorized: Missing or invalid Authorization header",
            },
            id: null,
          });
          return;
        }

        const nwcString = authHeader.substring(7); // Remove 'Bearer ' prefix

        // Create new transport
        transport = new StreamableHTTPServerTransport({
          sessionIdGenerator: () => randomUUID(),
          onsessioninitialized: (sessionId) => {
            // Store the transport by session ID
            this.transports[sessionId] = transport;
          },
          // Note: DNS rebinding protection is not available in this version of the SDK
        });

        // Clean up transport when closed
        transport.onclose = async () => {
          if (transport.sessionId) {
            // Clean up server if it exists
            const server = this.servers[transport.sessionId];
            if (server) {
              try {
                await server.close();
              } catch (error) {
                debugError("Error closing server:", error);
              }
            }
            delete this.servers[transport.sessionId];
            delete this.transports[transport.sessionId];
          }
        };

        // Create the appropriate MCP server based on type
        let server: AskExpertsSmartMCP | AskExpertsMCP;

        if (this.type === "smart") {
          // Create Smart MCP server
          server = new AskExpertsSmartMCP(
            nwcString,
            this.openaiApiKey!,
            this.openaiBaseUrl!,
            this.discoveryRelays
          );
        } else {
          // Create regular MCP server
          server = new AskExpertsMCP(nwcString, this.discoveryRelays);
        }

        // Connect to the MCP server
        await server.connect(transport);

        // Store the server instance
        if (transport.sessionId) {
          this.servers[transport.sessionId] = server;
        }
      } else {
        // Invalid request
        res.status(400).json({
          jsonrpc: "2.0",
          error: {
            code: -32000,
            message: "Bad Request: No valid session ID provided",
          },
          id: null,
        });
        return;
      }

      // Handle the request
      await transport.handleRequest(req, res, req.body);
    });

    // Reusable handler for GET and DELETE requests
    const handleSessionRequest = async (
      req: express.Request,
      res: express.Response
    ) => {
      if (this.stopped) {
        res.status(503).send("Service not available");
        return;
      }

      const sessionId = req.headers["mcp-session-id"] as string | undefined;
      if (!sessionId || !this.transports[sessionId]) {
        res.status(400).send("Invalid or missing session ID");
        return;
      }

      const transport = this.transports[sessionId];
      await transport.handleRequest(req, res);
    };

    // Handle GET requests for server-to-client notifications via SSE
    this.app.get(`${this.basePath}mcp`, handleSessionRequest);

    // Handle DELETE requests for session termination
    this.app.delete(`${this.basePath}mcp`, handleSessionRequest);
  }

  /**
   * Start the HTTP server
   */
  public start(): void {
    if (this.server) throw new Error("Already started");
    this.stopped = false;
    this.server = this.app.listen(this.port);
    debugMCP(
      `AskExperts HTTP server (${this.type}) started on port ${this.port}`
    );
    debugMCP(`Base URL: ${this.basePath}`);
  }

  /**
   * Stop the HTTP server and clean up resources
   */
  public stop(): Promise<void> {
    return new Promise<void>(async (resolve) => {
      // Ensure it's marked as stopped
      this.stopped = false;

      // Didn't really start?
      if (!this.server) {
        resolve();
        return;
      }

      debugError("AskExperts HTTP server stopping...");

      // Stop accepting new connections
      const closePromise = new Promise((ok) => this.server!.close(ok));

      // FIXME: if clients have active requests, we
      // risk losing their money by cutting them off,
      // ideally we would stop accepting new requests,
      // and wait for a while until existing requests are over,
      // and start terminating only after that.

      // Close all existing MCP transports
      await Promise.allSettled(Object.values(this.transports).map(transport => transport.close()));

      // Wait until all connections are closed with timeout
      await Promise.race([
        closePromise,
        new Promise((ok) => setTimeout(ok, 5000)),
      ]);

      // Cleanup the MCP servers
      Object.values(this.servers).forEach((server) => {
        server[Symbol.dispose]();
      });

      // Clear the rest
      this.servers = {};
      this.transports = {};
      this.server = undefined;

      debugError("AskExperts HTTP server stopped");
      resolve();
    });
  }
}
