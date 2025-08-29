import { debugExpert, debugError } from "../common/debug.js";
import { OpenaiProxyExpertBase } from "./OpenaiProxyExpertBase.js";
import { DBExpert } from "../db/interfaces.js";
import { str2arr } from "../common/utils.js";
import { Prompt } from "../common/types.js";
import { Prompts } from "./Prompts.js";

/**
 * SystemPromptExpert implementation for NIP-174
 * Provides expert access with a custom system prompt
 */
export class SystemPromptExpert {
  /**
   * OpenaiExpertBase instance
   */
  private openaiExpert: OpenaiProxyExpertBase;

  /** Expert info */
  private expert: DBExpert;

  /** Hashtags we're watching */
  private discovery_hashtags: string[] = [];

  /**
   * Creates a new SystemPromptExpert instance
   *
   * @param options - Configuration options
   */
  constructor(options: {
    openaiExpert: OpenaiProxyExpertBase;
    expert: DBExpert;
  }) {
    this.expert = options.expert;
    this.openaiExpert = options.openaiExpert;

    // Set our onAsk to the openaiExpert.server
    this.openaiExpert.server.onAsk = this.onAsk.bind(this);

    // Set onGetInvoiceDescription
    this.openaiExpert.onGetInvoiceDescription =
      this.onGetInvoiceDescription.bind(this);
  }

  /**
   * Starts the expert
   */
  async start(): Promise<void> {
    try {
      debugExpert(`Starting SystemPromptExpert`);

      // Parse hashtags
      this.discovery_hashtags = str2arr(this.expert.discovery_hashtags) || [];

      // Set hashtags to openaiExpert.server.hashtags
      this.openaiExpert.server.hashtags = [...this.discovery_hashtags];

      const system_prompt =
        this.expert.system_prompt || Prompts.defaultExpertPrompt();

      // Set onGetSystemPrompt to return the static systemPrompt
      this.openaiExpert.onGetSystemPrompt = (_: Prompt) =>
        Promise.resolve(system_prompt);

      // Set nickname and description to openaiExpert.server
      this.openaiExpert.server.nickname = this.expert.nickname || "";
      this.openaiExpert.server.description = this.expert.description || "";

      // Start the OpenAI expert
      await this.openaiExpert.start();

      debugExpert(`SystemPromptExpert started successfully`);
    } catch (error) {
      debugError("Error starting SystemPromptExpert:", error);
      throw error;
    }
  }

  /**
   * Handles ask events
   *
   * @param ask - The ask event
   * @returns Promise resolving to a bid if interested, or undefined to ignore
   */
  private async onAsk(ask: any): Promise<any | undefined> {
    try {
      const tags = ask.hashtags;

      // Check if the ask is relevant to this expert
      if (!tags.find((s: string) => this.discovery_hashtags.includes(s))) {
        return undefined;
      }

      debugExpert(`SystemPromptExpert received ask: ${ask.id}`);

      // Return a bid with our offer
      return {
        offer: this.expert.description || "I can answer your question",
      };
    } catch (error) {
      debugError("Error handling ask in SystemPromptExpert:", error);
      return undefined;
    }
  }

  private onGetInvoiceDescription(prompt: Prompt): Promise<string> {
    return Promise.resolve(`Payment to expert ${this.expert.pubkey}...`);
  }

  /**
   * Disposes of resources when the expert is no longer needed
   */
  async [Symbol.asyncDispose]() {
    debugExpert("Clearing SystemPromptExpert");
    // No specific resources to clean up
  }
}