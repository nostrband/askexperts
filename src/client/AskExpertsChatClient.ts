/**
 * AskExpertsChatClient implementation
 * Handles chat interactions with experts
 */

import {
  AskExpertsPayingClient,
  OnPaidCallback,
  OnMaxAmountExceededCallback,
} from "./AskExpertsPayingClient.js";
import { LightningPaymentManager } from "../payments/LightningPaymentManager.js";
import { FORMAT_OPENAI, FORMAT_TEXT } from "../common/constants.js";
import { debugError, debugClient, debugExpert } from "../common/debug.js";
import { Expert, FetchExpertsParams } from "../common/types.js";
import { SimplePool } from "nostr-tools";
import { StreamFactory } from "../stream/interfaces.js";
import { ChatCompletion, ChatCompletionChunk } from "openai/resources";

/**
 * Options for the chat client
 */
export interface ChatClientOptions {
  nwcString: string;
  discoveryRelays?: string[];
  streamFactory?: StreamFactory;
  pool?: SimplePool;
  maxAmount?: string;
  stream?: boolean;
  onPaid?: OnPaidCallback;
  onMaxAmountExceeded?: OnMaxAmountExceededCallback;
}

/**
 * Message in OpenAI chat format
 */
export interface ChatMessage {
  role: "user" | "assistant";
  content:
    | string
    | Array<{
        type: "text" | "image_url";
        text?: string;
        image_url?: {
          url: string;
        };
      }>;
}

export interface ChatReply {
  text: string;
  images?: string[];
}

/**
 * Client for chatting with experts
 */
export class AskExpertsChatClient {
  private messageHistory: ChatMessage[] = [];
  private expert: Expert | null = null;
  private options: ChatClientOptions;
  private client!: AskExpertsPayingClient; // Using definite assignment assertion
  private maxAmountSats: number = 100; // Default value

  /**
   * Creates a new AskExpertsChatClient
   *
   * @param expertPubkey The pubkey of the expert to chat with
   * @param options Options for the chat client
   */
  constructor(private expertPubkey: string, options: ChatClientOptions) {
    this.options = options;

    // Initialize properties
    this.initializeProperties(options);

    // Create the payment manager with the provided NWC string
    const paymentManager = new LightningPaymentManager(options.nwcString);

    // Initialize the paying client
    this.client = new AskExpertsPayingClient(paymentManager, {
      maxAmountSats: this.maxAmountSats,
      discoveryRelays: options.discoveryRelays,
      pool: options.pool,
      streamFactory: options.streamFactory,
      onPaid: options.onPaid,
      onMaxAmountExceeded: options.onMaxAmountExceeded,
    });
  }

  /**
   * Initialize properties that don't depend on the wallet
   * @param options Client options
   */
  private initializeProperties(options: ChatClientOptions): void {
    // Parse max amount
    this.maxAmountSats = options.maxAmount
      ? parseInt(options.maxAmount, 10)
      : 100;
    if (isNaN(this.maxAmountSats) || this.maxAmountSats <= 0) {
      throw new Error("Maximum amount must be a positive number.");
    }
  }

  /**
   * Initialize the chat client by fetching the expert profile
   */
  public async initialize(): Promise<Expert> {
    debugClient(`Starting chat with expert ${this.expertPubkey}`);
    debugClient(`Maximum payment per message: ${this.maxAmountSats} sats`);

    // Fetch the expert's profile once at the beginning
    debugClient(`Fetching expert profile for ${this.expertPubkey}...`);
    const experts = await this.client.fetchExperts({
      pubkeys: [this.expertPubkey],
    });

    if (experts.length === 0) {
      throw new Error(
        `Expert ${this.expertPubkey} not found. Make sure they have published an expert profile.`
      );
    }

    this.expert = experts[0];
    debugClient(`Found expert: ${this.expert?.description || "Unknown"}`);

    // Verify that the expert supports FORMAT_OPENAI
    if (!this.expert || !this.expert.formats.includes(FORMAT_OPENAI)) {
      throw new Error(
        `Expert ${
          this.expertPubkey
        } doesn't support OpenAI format. Supported formats: ${
          this.expert?.formats.join(", ") || "none"
        }`
      );
    }

    return this.expert as Expert;
  }

  async fetchExperts(params: FetchExpertsParams): Promise<Expert[]> {
    return this.client.fetchExperts(params);
  }

  public async processMessage(
    message: string,
    onStream?: (s: string) => void
  ): Promise<string> {
    return (await this.processMessageExt(message, (r) => onStream?.(r.text)))
      .text;
  }

  /**
   * Process a message and get a response from the expert
   *
   * @param message The message to send to the expert (string or multi-part array)
   * @returns The expert's reply
   */
  public async processMessageExt(
    message:
      | string
      | Array<{
          type: "text" | "image_url";
          text?: string;
          image_url?: {
            url: string;
          };
        }>,
    onStream?: (r: ChatReply) => void
  ): Promise<ChatReply> {
    if (!message || (Array.isArray(message) && message.length === 0)) {
      return { text: "" };
    }

    if (!this.expert) {
      throw new Error("Expert not initialized. Call initialize() first.");
    }

    if (this.options.stream && !onStream) {
      throw new Error("Stream option requires onStream callback");
    }

    const start = Date.now();
    try {
      const messageLength = Array.isArray(message)
        ? `${message.length} parts`
        : `${message.length} chars`;
      debugClient(
        `Sending message to expert ${this.expertPubkey} of ${messageLength}...`
      );

      // Add user message to history
      this.messageHistory.push({
        role: "user",
        content: message,
      });

      // Create OpenAI format request with message history
      const openaiRequest = {
        model: this.expertPubkey,
        messages: this.messageHistory,
        modalities: ["text", "image"], // hmm may some of models break due to 'image'?
        stream: !!this.options.stream,
      };

      debugClient(
        `Sending message with history (${this.messageHistory.length} messages) to expert ${this.expertPubkey}`
      );

      // Data format to use
      const format = this.expert.formats.includes(FORMAT_OPENAI)
        ? FORMAT_OPENAI
        : FORMAT_TEXT;

      // Ask the expert using OpenAI format
      const replies = await this.client.askExpert({
        expert: this.expert,
        content: openaiRequest,
        format,
      });

      const extractImage = (message: any) => {
        const images = message?.images as {
          type: "image_url";
          image_url: { url: string };
        }[];
        if (images?.[0]?.image_url.url) return images?.[0]?.image_url.url;
        return undefined;
      };

      // Final reply to be placed into history,
      // and to be returned for non-streamed requests
      const chatReply: ChatReply = { text: "" };

      // For streamed replies,
      // chunks might be delta lines (one or several),
      // or big lines split into several chunks,
      // we will buffer such split lines here,
      // non-streamed openai replies are also buffered here.
      let lineBuffer = '';

      // Iterate through the replies
      for await (const reply of replies) {
        if (reply.done) {
          debugClient(`Received final reply from expert ${this.expertPubkey} length ${reply.content.length}`);
        } else {
          debugClient(`Received chunk from expert ${this.expertPubkey} length ${reply.content.length}`);
        }
        if (!reply.content) continue;

        const chunk =
          typeof reply.content === "string"
            ? reply.content
            : new TextDecoder().decode(reply.content);

        if (format === FORMAT_OPENAI) {
          if (this.options.stream) {

            // Append to buffered json, if any
            lineBuffer += chunk;

            // Split buffered stuff into lines
            const lines = lineBuffer.split("\n");

            // Do we have full line?
            const isFullLastLine = !lines[lines.length - 1].trim().length;
            debugExpert(`chunk lines ${lines.length} isFullLastLine ${isFullLastLine}`);

            // If last line is complete, clear the buffer,
            // otherwise append last line's head to the buffer
            // to process when tail arrives in further chunks
            if (isFullLastLine) {
              lineBuffer = "";
            } else {
              // Put last incomplete line to buffer,
              // which might be a single line with full buffer
              lineBuffer = lines[lines.length - 1];

              // Cut the last incomplete line, we'll process it with
              // further chunks
              lines.length -= 1;
            }

            // No full lines in this chunk?
            // Wait for further chunks to get a least 1 full line
            if (!isFullLastLine && !lines.length) continue;

            for (const line of lines) {
              if (!line.trim()) continue;

              let completionChunk: ChatCompletionChunk;
              try {
                completionChunk = JSON.parse(line) as ChatCompletionChunk;
              } catch (e) {
                debugError(`Failed to parse chunk line: ${e} '${line.substring(0, 20)}...${line.substring(line.length - 20)}'`);
                throw e;
              }

              // Prepare delta reply from chunk
              const delta = completionChunk.choices[0]?.delta;
              const content = delta?.content;
              const deltaReply: ChatReply = { text: "" };
              if (typeof content === "string") deltaReply.text = content;
              const image = extractImage(delta);
              if (image) deltaReply.images = [image];
              onStream!(deltaReply);

              // Append to full final reply for history
              chatReply.text += deltaReply.text;
              if (image) {
                if (!chatReply.images) chatReply.images = [];
                chatReply.images.push(image);
              }
            }
          } else {
            // Chunks are simply big json split into many parts,
            // put them all to our buffer
            lineBuffer += chunk;
          }
        } else if (format === FORMAT_TEXT) {
          // Notify about streamed chunk
          if (this.options.stream)
            onStream!({ text: chunk });

          // Append to final reply for history,
          // since text replies don't need parsing
          // we don't use lineBuffer and append directly
          // to final reply.
          chatReply.text += chunk;
        } else {
          throw new Error(`Unsupported format ${format}`);
        }
      }

      // Parse openai reply if we're not streaming
      if (lineBuffer && format === FORMAT_OPENAI && !this.options.stream) {
        const content = JSON.parse(lineBuffer) as ChatCompletion;
        chatReply.text = content.choices[0].message.content || "";

        const image = extractImage(content.choices[0].message);
        if (image) {
          if (!chatReply.images) chatReply.images = [];
          chatReply.images.push(image);
        }
      }

      // Add the full expert's response to the message history
      if (chatReply.text || chatReply.images)
        this.messageHistory.push({
          role: "assistant",
          content: chatReply.text,
        });

      return chatReply;
    } catch (error) {
      debugError(
        "Error in chat:",
        error instanceof Error ? error.message : String(error)
      );
      throw error;
    } finally {
      debugClient(`Message processed in ${Date.now() - start} ms`);
    }
  }

  /**
   * Clean up resources
   */
  public [Symbol.dispose](): void {
    // Dispose of the paying client
    this.client[Symbol.dispose]();
  }
}
