/**
 * AskExpertsChatClient implementation
 * Handles chat interactions with experts
 */

import { AskExpertsPayingClient } from "./AskExpertsPayingClient.js";
import { LightningPaymentManager } from "../payments/LightningPaymentManager.js";
import { FORMAT_OPENAI, FORMAT_TEXT } from "../common/constants.js";
import { debugError, debugClient } from "../common/debug.js";
import { Expert } from "../common/types.js";
import { getWalletByNameOrDefault } from "../bin/commands/wallet/utils.js";

/**
 * Options for the chat client
 */
export interface ChatClientOptions {
  wallet?: string;
  relays?: string[];
  maxAmount?: string;
  debug?: boolean;
  stream?: boolean;
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
  private client: AskExpertsPayingClient;
  private maxAmountSats: number;

  /**
   * Creates a new AskExpertsChatClient
   *
   * @param expertPubkey The pubkey of the expert to chat with
   * @param options Options for the chat client
   */
  constructor(private expertPubkey: string, options: ChatClientOptions) {
    this.options = options;
    
    // Get wallet from database using the provided wallet name or default
    const wallet = getWalletByNameOrDefault(options.wallet);
    const nwcString = wallet.nwc;

    // Try to get discovery relays from options or environment variables
    let discoveryRelays: string[] | undefined = options.relays;
    if (!discoveryRelays && process.env.DISCOVERY_RELAYS) {
      discoveryRelays = process.env.DISCOVERY_RELAYS.split(",").map((relay) =>
        relay.trim()
      );
    }

    // Parse max amount
    this.maxAmountSats = options.maxAmount
      ? parseInt(options.maxAmount, 10)
      : 100;
    if (isNaN(this.maxAmountSats) || this.maxAmountSats <= 0) {
      throw new Error("Maximum amount must be a positive number.");
    }

    // Create the payment manager
    const paymentManager = new LightningPaymentManager(nwcString);

    // Initialize the paying client
    this.client = new AskExpertsPayingClient(paymentManager, {
      maxAmountSats: this.maxAmountSats,
      discoveryRelays,
    });
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
        `Expert ${this.expertPubkey} doesn't support OpenAI format. Supported formats: ${this.expert?.formats.join(
          ", "
        ) || "none"}`
      );
    }

    return this.expert as Expert;
  }


  /**
   * Process a message and get a response from the expert
   * 
   * @param message The message to send to the expert
   * @returns The expert's reply
   */
  public async processMessage(message: string): Promise<string> {
    if (!message) {
      return "";
    }

    if (!this.expert) {
      throw new Error("Expert not initialized. Call initialize() first.");
    }

    const start = Date.now();
    try {
      debugClient(`Sending message to expert ${this.expertPubkey} of ${message.length} chars...`);

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
      for await (const reply of replies) {
        if (reply.done) {
          debugClient(`Received final reply from expert ${this.expertPubkey}`);

          // OpenAI format response
          let chunk = "";
          if (reply.content) {
            if (format === FORMAT_OPENAI) {
              chunk =
                reply.content.choices[0]?.[
                  this.options.stream ? "delta" : "message"
                ].content;
            } else {
              chunk = reply.content;
            }
            expertReply += chunk;
          }
        } else {
          debugClient(`Received chunk from expert ${this.expertPubkey}`);
          if (!reply.content) continue;
          const chunk = reply.content.choices[0]?.delta.content;
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