import { APIPromise, OpenAI } from "openai";
import {
  ChatCompletionCreateParams,
  ChatCompletion,
  ChatCompletionCreateParamsNonStreaming,
  ChatCompletionCreateParamsStreaming,
  ChatCompletionCreateParamsBase,
  ChatCompletionChunk,
} from "openai/resources/chat/completions";
import { PricingResult } from "../experts/utils/ModelPricing.js";
import { Prompt } from "../common/types.js";
import { OpenRouter } from "../experts/utils/OpenRouter.js";
import { OpenaiOpenRouter } from "./OpenaiOpenRouter.js";
import { OpenaiAskExperts } from "./OpenaiAskExperts.js";
import { LightningPaymentManager } from "../payments/LightningPaymentManager.js";
import { Compression } from "../common/compression.js";
import { SimplePool } from "nostr-tools";

export * from "./OpenaiOpenRouter.js";
export * from "./OpenaiAskExperts.js";

/**
 * Interface that matches the OpenAI chat completions API
 * This allows for dependency injection and easier testing
 */
export interface OpenaiInterface {
  chat: {
    completions: {
      create(
        body: ChatCompletionCreateParamsNonStreaming,
        options?: any
      ): APIPromise<ChatCompletion>;
      create(
        body: ChatCompletionCreateParamsStreaming,
        options?: any
      ): APIPromise<AsyncIterable<ChatCompletionChunk>>;
      create(
        body: ChatCompletionCreateParamsBase,
        options?: any
      ): APIPromise<AsyncIterable<ChatCompletionChunk> | ChatCompletion>;
      create(
        body: ChatCompletionCreateParams,
        options?: any
      ):
        | APIPromise<ChatCompletion>
        | APIPromise<AsyncIterable<ChatCompletionChunk>>;
    };
  };

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
  estimatePrice(model: string, content: ChatCompletionCreateParams): Promise<{ amountSats: number, quoteId?: string }>;
}

/**
 * Creates an OpenAI instance that implements OpenaiInterface
 *
 * @param apiKey - OpenAI API key
 * @param baseURL - OpenAI base URL
 * @param defaultHeaders - Optional default headers
 * @returns OpenAI instance implementing OpenaiInterface
 */
export function createOpenAI(
  apiKey: string,
  baseURL: string,
  defaultHeaders?: Record<string, string>,
  options?: {
    paymentManager?: LightningPaymentManager;
    compression?: Compression;
    pool?: SimplePool;
    discoveryRelays?: string[];
  }
): OpenaiInterface {
  try {
    // Parse the baseURL to check the hostname
    const url = new URL(baseURL);
    
    // If the hostname is openrouter.ai, return an OpenaiOpenRouter instance
    if (url.hostname === 'openrouter.ai') {
      // Create the base OpenAI client
      const openai = new OpenAI({
        apiKey,
        baseURL,
        defaultHeaders,
      });
      
      // Create an OpenRouter instance
      const openRouter = new OpenRouter();
      
      // Return an OpenaiOpenRouter instance
      return new OpenaiOpenRouter(
        // Pass the base client with chat implementation
        {
          chat: openai.chat,
          async pricing(model: string): Promise<PricingResult | undefined> {
            return undefined;
          },
          async estimatePrice(model: string, content: ChatCompletionCreateParams): Promise<{ amountSats: number, quoteId?: string }> {
            return { amountSats: 0 };
          }
        },
        openRouter
      );
    }
    // If the hostname is askexperts.ai, return an OpenaiAskExperts instance
    else if (url.hostname === 'askexperts.ai' && options?.paymentManager) {
      // Return an OpenaiAskExperts instance
      return new OpenaiAskExperts(
        options.paymentManager,
        {
          compression: options.compression,
          pool: options.pool,
          discoveryRelays: options.discoveryRelays,
        }
      );
    } else {
      // For other hostnames, throw an exception
      throw new Error(`Unsupported baseURL: ${baseURL}. Only openrouter.ai and askexperts.ai (with paymentManager) are supported.`);
    }
  } catch (error) {
    if (error instanceof Error && error.message.includes('Unsupported baseURL')) {
      throw error;
    }
    throw new Error(`Invalid baseURL: ${baseURL}. Please provide a valid URL.`);
  }
}
