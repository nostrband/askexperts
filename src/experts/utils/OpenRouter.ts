import { debugExpert, debugError } from "../../common/debug.js";
import { ModelPricing, PricingResult } from "./ModelPricing.js";

/**
 * Model information from OpenRouter API
 */
interface OpenRouterModel {
  id: string;
  name: string;
  pricing: {
    prompt: number;
    completion: number;
  };
  [key: string]: any;
}

/**
 * OpenRouter API client
 * Provides access to OpenRouter models and pricing
 * Implements ModelPricing interface
 */
export class OpenRouter implements ModelPricing {
  /**
   * Cached models from OpenRouter API
   */
  private models: OpenRouterModel[] = [];

  /**
   * Last time models were fetched
   */
  private lastFetchTime: number = 0;

  /**
   * Cache expiry time in milliseconds (1 hour)
   */
  private cacheExpiryTime: number = 60 * 60 * 1000;

  /**
   * Gets all available models
   * Updates the cache if it's older than the expiry time
   *
   * @returns Array of models
   */
  async list(): Promise<OpenRouterModel[]> {
    // Update cache if needed
    await this.updateCacheIfNeeded();
    
    // Return all models
    return [...this.models];
  }

  /**
   * BTC/USD exchange rate
   */
  private btcUsd?: number;

  /**
   * Creates a new OpenRouter instance
   */
  constructor() {
    // No parameters needed
  }

  /**
   * Gets a model by name (id)
   * Updates the cache if it's older than 1 hour
   * 
   * @param name - Model ID
   * @returns Model information or undefined if not found
   */
  async model(name: string): Promise<OpenRouterModel | undefined> {
    // Update cache if needed
    await this.updateCacheIfNeeded();

    // Find the model
    return this.models.find(m => m.id === name);
  }

  /**
   * Gets pricing information for a model in sats per million tokens
   * Implements ModelPricing interface
   *
   * @param name - Model ID
   * @returns Promise resolving to pricing information
   * @throws Error if pricing information cannot be retrieved
   */
  async pricing(name: string): Promise<PricingResult> {
    try {
      // Get the model
      const modelInfo = await this.model(name);
      if (!modelInfo) {
        debugError(`Model ${name} not found in OpenRouter API`);
        throw new Error(`Model ${name} not found in OpenRouter API`);
      }

      // Get the pricing
      const inputPriceUsd = modelInfo.pricing.prompt;
      const outputPriceUsd = modelInfo.pricing.completion;
      if (!inputPriceUsd || !outputPriceUsd) {
        debugError("Failed to get valid pricing");
        throw new Error("Failed to get valid pricing");
      }

      debugExpert(
        `Fetched USD prices from OpenRouter: input=${inputPriceUsd} usd/token, output=${outputPriceUsd} usd/token`
      );

      // If BTC/USD rate is not set, fetch it
      if (!this.btcUsd) {
        await this.fetchBtcUsdRate();
      }

      if (!this.btcUsd) {
        debugError("Failed to fetch BTC/USD rate");
        throw new Error("Failed to fetch BTC/USD rate");
      }

      // Convert USD prices per token to sats per million tokens
      // 1 BTC = 100,000,000 sats, so sats = usd * 100,000,000 / btcUsd * 1,000,000
      const inputTokenPPM = Math.ceil(
        (inputPriceUsd * 100000000) / this.btcUsd * 1000000
      );
      const outputTokenPPM = Math.ceil(
        (outputPriceUsd * 100000000) / this.btcUsd * 1000000
      );

      debugExpert(
        `Calculated prices: input=${inputTokenPPM} sats/M, output=${outputTokenPPM} sats/M`
      );

      return {
        inputPricePPM: inputTokenPPM,
        outputPricePPM: outputTokenPPM
      };
    } catch (error) {
      debugError("Error calculating pricing:", error);
      throw error;
    }
  }

  /**
   * Force a model cache update
   */
  async update() {
    await this.fetchModels();
  }

  /**
   * Updates the model cache if it's older than the expiry time
   */
  private async updateCacheIfNeeded(): Promise<void> {
    const now = Date.now();
    if (now - this.lastFetchTime > this.cacheExpiryTime || this.models.length === 0) {
      await this.fetchModels();
    }
  }

  /**
   * Fetches models from OpenRouter API
   */
  private async fetchModels(): Promise<void> {
    try {
      debugExpert("Fetching models from OpenRouter API");
      const response = await fetch("https://openrouter.ai/api/v1/models");
      if (!response.ok) {
        throw new Error(`Failed to fetch models: ${response.statusText}`);
      }

      const data = await response.json();
      this.models = data.data;
      this.lastFetchTime = Date.now();
      debugExpert(`Fetched ${this.models.length} models from OpenRouter API`);
    } catch (error) {
      debugError("Error fetching models:", error);
      throw error;
    }
  }

  /**
   * Fetches the current BTC/USD exchange rate from Binance
   */
  private async fetchBtcUsdRate(): Promise<void> {
    try {
      const response = await fetch(
        "https://api.binance.com/api/v3/avgPrice?symbol=BTCUSDT"
      );
      if (!response.ok) {
        throw new Error(`Failed to fetch BTC/USD rate: ${response.statusText}`);
      }

      const data = await response.json();
      this.btcUsd = parseFloat(data.price);
      debugExpert(`Fetched BTC/USD rate: ${this.btcUsd}`);
    } catch (error) {
      debugError("Error fetching BTC/USD rate:", error);
      throw error;
    }
  }
}