import { APIPromise, OpenAI } from "openai";
import {
  ChatCompletionCreateParams,
  ChatCompletion,
  ChatCompletionChunk,
} from "openai/resources/chat/completions";
import { PricingResult } from "../experts/utils/ModelPricing.js";
import { getOpenRouter, OpenRouter } from "../experts/utils/OpenRouter.js";
import { OpenaiOpenRouter } from "./OpenaiOpenRouter.js";
import { OpenaiAskExperts } from "./OpenaiAskExperts.js";
import { LightningPaymentManager } from "../payments/LightningPaymentManager.js";
import { Compression } from "../stream/compression.js";
import { SimplePool } from "nostr-tools";

export * from "./OpenaiOpenRouter.js";
export * from "./OpenaiAskExperts.js";

/**
 * Interface that matches the OpenAI chat completions API
 * This allows for dependency injection and easier testing
 */
export interface OpenaiInterface {
  /**
   * Execute a chat completion request
   *
   * @param quoteId - Quote ID for the request
   * @param options - Additional options for the request
   * @returns Promise resolving to chat completion or chunks
   */
  execute(
    quoteId: string,
    options?: any
  ): APIPromise<ChatCompletion> | APIPromise<AsyncIterable<ChatCompletionChunk>>;

  /**
   * Gets pricing information for a model in sats per million tokens
   *
   * @param model - Model ID
   * @returns Promise resolving to pricing information or undefined if not available
   */
  pricing(model: string): Promise<PricingResult | undefined>;

  /**
   * Estimates the price of processing a prompt
   *
   * @param model - Model ID
   * @param content - The chat completion parameters
   * @returns Promise resolving to the estimated price object
   */
  getQuote(
    model: string,
    content: ChatCompletionCreateParams
  ): Promise<{ amountSats: number; quoteId: string }>;
}

/**
 * Creates an OpenAI instance that implements OpenaiInterface
 *
 * @param apiKey - OpenAI API key
 * @param baseURL - OpenAI base URL
 * @param defaultHeaders - Optional default headers
 * @returns OpenAI instance implementing OpenaiInterface
 */
export function createOpenAI(options?: {
  apiKey?: string;
  baseURL?: string;
  defaultHeaders?: Record<string, string>;
  paymentManager?: LightningPaymentManager;
  compression?: Compression;
  pool?: SimplePool;
  discoveryRelays?: string[];
  margin?: number;
  openRouter?: OpenRouter;
}): OpenaiInterface {
  // Parse the baseURL to check the hostname
  const url = new URL(options?.baseURL || "https://askexperts.io");

  // If the hostname is openrouter.ai, return an OpenaiOpenRouter instance
  if (url.hostname === "openrouter.ai") {
    // Check the options
    if (!options?.apiKey) throw new Error("Option apiKey is required");

    // Create the base OpenAI client
    const openai = new OpenAI({
      apiKey: options.apiKey,
      baseURL: options.baseURL,
      defaultHeaders: options.defaultHeaders || {
        "HTTP-Referer": "https://askexperts.io", // Site URL for rankings on openrouter.ai
        "X-Title": "AskExperts", // Site title for rankings on openrouter.ai
      },
    });

    // Return an OpenaiOpenRouter instance
    return new OpenaiOpenRouter(openai, options.openRouter || getOpenRouter(), options.margin);
  }
  // If the hostname is askexperts.ai, return an OpenaiAskExperts instance
  else if (url.hostname === "askexperts.io") {
    // This is required to work with expert-llm proxies
    if (!options?.paymentManager)
      throw new Error("Option paymentManager is required");

    // Return an OpenaiAskExperts instance
    return new OpenaiAskExperts(options.paymentManager, {
      compression: options.compression,
      pool: options.pool,
      discoveryRelays: options.discoveryRelays,
      margin: options.margin,
    });
  } else {
    // For other hostnames, throw an exception
    throw new Error(
      `Unsupported baseURL: '${options?.baseURL}'. Only openrouter.ai and askexperts.ai are supported.`
    );
  }
}
