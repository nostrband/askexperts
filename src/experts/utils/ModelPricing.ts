/**
 * Pricing information in sats per million tokens
 */
export interface PricingResult {
  inputPricePPM: number;
  outputPricePPM: number;
}

/**
 * Interface for model pricing providers
 */
export interface ModelPricing {
  /**
   * Gets pricing information for a model in sats per million tokens
   * 
   * @param name - Model ID
   * @returns Promise resolving to pricing information
   */
  pricing(name: string): Promise<PricingResult>;
}