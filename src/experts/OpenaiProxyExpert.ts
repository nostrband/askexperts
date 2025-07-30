import { AskExpertsServer } from "../server/AskExpertsServer.js";
import { Ask, ExpertBid } from "../common/types.js";
import { debugExpert, debugError } from "../common/debug.js";
import { OpenaiInterface } from "../openai/index.js";
import { OpenaiProxyExpertBase } from "./OpenaiProxyExpertBase.js";

/**
 * OpenAI Expert implementation for NIP-174
 * Provides direct access to OpenAI models with pricing based on token usage
 */
export class OpenaiProxyExpert extends OpenaiProxyExpertBase {
  /**
   * Model vendor
   */
  private modelVendor: string;

  /**
   * Model name
   */
  private modelName: string;

  /**
   * System prompt to prepend to all conversations
   */
  private readonly systemPrompt?: string;

  /**
   * Interval ID for description update checks
   */
  private descriptionCheckInterval: NodeJS.Timeout | null = null;

  /**
   * Creates a new OpenaiExpert instance
   *
   * @param options - Configuration options
   */
  constructor(options: {
    server: AskExpertsServer;
    openai: OpenaiInterface;
    model: string;
    systemPrompt?: string;
  }) {
    super(options);
    this.modelVendor = this.model.split("/")[0];
    this.modelName = (this.model.split("/")?.[1] || this.model).split(
      /[\s\p{P}]+/u
    )[0];
    this.systemPrompt = options.systemPrompt;

    this.server.hashtags = [this.model, this.modelVendor, this.modelName];

    this.server.nickname = this.model;
    this.server.onAsk = this.onAsk.bind(this);
    if (this.systemPrompt)
      this.onGetSystemPrompt = () => Promise.resolve(this.systemPrompt!);
  }

  /**
   * Starts the expert
   */
  async start(): Promise<void> {
    // Set initial description
    this.server.description = await this.getDescription();

    // Set up interval to check for description changes
    this.descriptionCheckInterval = setInterval(async () => {
      const newDescription = await this.getDescription();
      
      // Only update if description has changed
      if (newDescription !== this.server.description) {
        this.server.description = newDescription;
      }
    }, 60000); // Check every minute to react to pricing changes

    // Start the server
    await super.start();
  }

  /**
   * Disposes of resources when the expert is no longer needed
   */
  async [Symbol.asyncDispose]() {
    // Call the parent's dispose method
    await super[Symbol.asyncDispose]();

    // Clear the interval when disposing
    if (this.descriptionCheckInterval) {
      clearInterval(this.descriptionCheckInterval);
      this.descriptionCheckInterval = null;
    }    
  }

  private async getDescription(): Promise<string> {
    // Get current pricing, it might change over time
    const pricing = await this.openai.pricing(this.model);
    
    let description = `I'm an expert providing direct access to LLM model ${this.model}.`;
    
    // Add pricing information if available
    if (pricing) {
      description += ` Input token price per million: ${pricing.inputPricePPM} sats, output token price per million ${pricing.outputPricePPM} sats.`;
    }
    
    description += ` System prompt: ${this.systemPrompt ? "disallowed" : "allowed"}`;
    
    return description;
  }

  /**
   * Handles ask events
   *
   * @param ask - The ask event
   * @returns Promise resolving to a bid if interested, or undefined to ignore
   */
  private async onAsk(ask: Ask): Promise<ExpertBid | undefined> {
    try {
      const tags = ask.hashtags;
      // if (!tags.includes("llm") && !tags.includes("model")) return;
      if (
        !tags.includes(this.model) &&
        !tags.includes(this.modelVendor) &&
        !tags.includes(this.modelName)
      )
        return;

      debugExpert(`Received ask: ${ask.id}`);

      // Return the bid with our description as the offer
      const description = await this.getDescription();

      return {
        offer: description,
      };
    } catch (error) {
      debugError("Error handling ask:", error);
      return undefined;
    }
  }
}
