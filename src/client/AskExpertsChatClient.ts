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
import { debugError, debugClient } from "../common/debug.js";
import { Expert, FetchExpertsParams } from "../common/types.js";
import { SimplePool } from "nostr-tools";
import { StreamFactory } from "../stream/interfaces.js";

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
  content: string;
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

  /**
   * Process a message and get a response from the expert
   *
   * @param message The message to send to the expert
   * @returns The expert's reply
   */
  public async processMessage(
    message: string,
    onStream?: (s: string) => void
  ): Promise<string> {
    if (!message) {
      return "";
    }

    if (!this.expert) {
      throw new Error("Expert not initialized. Call initialize() first.");
    }

    if (this.options.stream && !onStream) {
      throw new Error("Stream option requires onStream callback");
    }

    const start = Date.now();
    try {
      debugClient(
        `Sending message to expert ${this.expertPubkey} of ${message.length} chars...`
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

      // Process the replies
      let expertReply: string = "";

      // Iterate through the replies
      const container = this.options.stream ? "delta" : "message";
      for await (const reply of replies) {
        if (reply.done) {
          debugClient(`Received final reply from expert ${this.expertPubkey}`);

          // OpenAI format response
          let chunk = "";
          if (reply.content) {
            if (format === FORMAT_OPENAI) {
              chunk =
                reply.content.choices[0]?.[container].content;
            } else {
              chunk = reply.content;
            }
            if (this.options.stream) onStream!(chunk);
            expertReply += chunk;
          }
        } else {
          debugClient(`Received chunk from expert ${this.expertPubkey}`);
          if (!reply.content) continue;
          const chunk = reply.content.choices[0]?.[container].content;
          if (this.options.stream) onStream!(chunk);
          expertReply += chunk;
        }
      }

      // Add the full expert's response to the message history
      if (expertReply)
        this.messageHistory.push({
          role: "assistant",
          content: expertReply,
        });

      return expertReply;
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
