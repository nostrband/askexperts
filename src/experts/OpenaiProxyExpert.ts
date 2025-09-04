import { AskExpertsServer } from "../server/AskExpertsServer.js";
import { Ask, ExpertBid } from "../common/types.js";
import { debugExpert, debugError } from "../common/debug.js";
import { OpenaiInterface } from "../openai/index.js";
import { OpenaiProxyExpertBase } from "./OpenaiProxyExpertBase.js";
import { DBExpert } from "../db/interfaces.js";
import { OpenRouter } from "./utils/OpenRouter.js";

/**
 * OpenAI Expert implementation for NIP-174
 * Provides direct access to OpenAI models with pricing based on token usage
 */
export class OpenaiProxyExpert extends OpenaiProxyExpertBase {
  /** Expert description */
  #expert: DBExpert;

  /**
   * OpenRouter API client
   */
  private openrouter: OpenRouter;

  /**
   * Model vendor
   */
  private modelVendor: string;

  /**
   * Model name
   */
  private modelName: string;

  /**
   * Current model info JSON string
   */
  private currentModelInfoJson: string | null = null;

  /**
   * Interval ID for description update checks
   */
  private descriptionCheckInterval: NodeJS.Timeout | null = null;

  /**
   * Interval ID for model info update checks
   */
  private modelInfoCheckInterval: NodeJS.Timeout | null = null;

  /**
   * Creates a new OpenaiExpert instance
   *
   * @param options - Configuration options
   */
  constructor(options: {
    server: AskExpertsServer;
    openai: OpenaiInterface;
    expert: DBExpert;
    openrouter: OpenRouter;
  }) {
    if (!options.expert.model) throw new Error("Model not specified");

    super({ ...options, model: options.expert.model });

    this.#expert = options.expert;
    this.openrouter = options.openrouter;
    this.modelVendor = this.model.split("/")[0];
    this.modelName = (this.model.split("/")?.[1] || this.model).split(
      /[\s\p{P}]+/u
    )[0];

    this.server.hashtags = this.#expert.discovery_hashtags
      ? this.#expert.discovery_hashtags
          .split(",")
          .map((s) => s.trim())
          .filter((s) => !!s)
      : [this.model, this.modelVendor, this.modelName];

    this.server.nickname = this.#expert.nickname || this.model;
    this.server.onAsk = this.onAsk.bind(this);
    if (this.#expert.system_prompt)
      this.onGetSystemPrompt = () =>
        Promise.resolve(this.#expert.system_prompt!);
  }

  get expert() {
    return this.#expert;
  }

  set expert(value: DBExpert) {
    this.#expert = value;
  }

  /**
   * Starts the expert
   */
  async start(): Promise<void> {
    // Set initial description
    this.server.description = await this.getDescription();

    // Get model info from OpenRouter
    try {
      if (this.#expert.model) {
        const modelInfo = await this.openrouter.model(this.#expert.model);
        if (modelInfo) {
          this.currentModelInfoJson = JSON.stringify(modelInfo);
          this.server.tags = [["openrouter", this.currentModelInfoJson]];
        }
      }
    } catch (error) {
      debugError("Error getting model info from OpenRouter:", error);
    }

    // Set up interval to check for description changes
    this.descriptionCheckInterval = setInterval(async () => {
      const newDescription = await this.getDescription();

      // Only update if description has changed
      if (newDescription !== this.server.description) {
        this.server.description = newDescription;
      }
    }, 60000); // Check every minute to react to pricing changes

    // Set up interval to update model info
    this.modelInfoCheckInterval = setInterval(async () => {
      try {
        if (this.#expert.model) {
          const modelInfo = await this.openrouter.model(this.#expert.model);
          if (modelInfo) {
            const newModelInfoJson = JSON.stringify(modelInfo);
            
            // Only update if model info has changed
            if (newModelInfoJson !== this.currentModelInfoJson) {
              this.currentModelInfoJson = newModelInfoJson;
              this.server.tags = [["openrouter", this.currentModelInfoJson]];
              debugExpert(`Updated model info for ${this.#expert.model}`);
            }
          }
        }
      } catch (error) {
        debugError("Error updating model info from OpenRouter:", error);
      }
    }, 60000); // Check every minute to react to model info changes

    // Start the server
    await super.start();
  }

  /**
   * Disposes of resources when the expert is no longer needed
   */
  async [Symbol.asyncDispose]() {
    // Call the parent's dispose method
    await super[Symbol.asyncDispose]();

    // Clear the intervals when disposing
    if (this.descriptionCheckInterval) {
      clearInterval(this.descriptionCheckInterval);
      this.descriptionCheckInterval = null;
    }

    if (this.modelInfoCheckInterval) {
      clearInterval(this.modelInfoCheckInterval);
      this.modelInfoCheckInterval = null;
    }
  }

  private async getDescription(): Promise<string> {
    if (this.#expert.description) return this.#expert.description;

    // Get current pricing, it might change over time
    const pricing = await this.openai.pricing(this.model);

    let description = `I'm an expert providing direct access to LLM model ${this.model}.`;

    // Add pricing information if available
    if (pricing) {
      description += ` Input token price per million: ${pricing.inputPricePPM} sats, output token price per million ${pricing.outputPricePPM} sats.`;
    }

    description += ` System prompt: ${
      this.#expert.system_prompt ? "disallowed" : "allowed"
    }`;

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
