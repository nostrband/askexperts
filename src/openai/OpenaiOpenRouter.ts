import { encode } from "gpt-tokenizer";
import OpenAI, { APIPromise } from "openai";
import {
  ChatCompletionCreateParams,
  ChatCompletion,
  ChatCompletionChunk,
} from "openai/resources/chat/completions";
import { OpenaiInterface } from "./index.js";
import { OpenRouter } from "../experts/utils/OpenRouter.js";
import { PricingResult } from "../experts/utils/ModelPricing.js";
import { debugExpert } from "../common/debug.js";

/**
 * Helper function to process an AsyncIterable with a side effect
 * while passing through the original items unchanged
 */
async function* tapAsyncIterable<T>(
  source: AsyncIterable<T>,
  inspect: (item: T) => void | Promise<void>
): AsyncIterable<T> {
  for await (const item of source) {
    await inspect(item);  // run your side-effect or inspection
    yield item;           // pass the item through unchanged
  }
}

/**
 * OpenAI interface implementation that uses OpenRouter
 * Provides pricing and estimation functions
 */
export class OpenaiOpenRouter implements OpenaiInterface {
  /**
   * The underlying OpenAI client
   */
  private openai: OpenAI;

  /**
   * The OpenRouter instance for pricing
   */
  private openRouter: OpenRouter;

  /**
   * Profit margin (e.g., 0.1 for 10%)
   */
  private margin: number;

  /**
   * Average output token count for pricing estimates
   */
  private avgOutputCount: number = 300;

  /**
   * Number of outputs processed (for averaging)
   */
  private outputCount: number = 1;

  /**
   * Map of active quotes with their model and content
   */
  private activeQuotes: Map<string, {
    model: string,
    content: ChatCompletionCreateParams
  }> = new Map();

  /**
   * Creates a new OpenaiOpenRouter instance
   *
   * @param openai - The underlying OpenAI client
   * @param openRouter - The OpenRouter instance for pricing
   * @param margin - Profit margin (default: 0)
   */
  constructor(
    openai: OpenAI,
    openRouter: OpenRouter,
    margin: number = 0
  ) {
    this.openai = openai;
    this.openRouter = openRouter;
    this.margin = margin;
  }

  /**
   * Gets pricing information for a model in sats per million tokens
   * Delegates to the OpenRouter instance
   * 
   * @param model - Model ID
   * @returns Promise resolving to pricing information or undefined if not available
   */
  async pricing(model: string): Promise<PricingResult | undefined> {
    try {
      return await this.openRouter.pricing(model);
    } catch (error) {
      console.error("Error getting pricing:", error);
      return undefined;
    }
  }

  /**
   * Count tokens using gpt-tokenizer
   *
   * @param text - Text to count tokens for
   * @returns Token count
   */
  private countTokens(text: string): number {
    return encode(text).length;
  }

  /**
   * Estimates the price of processing a prompt
   * Implements the logic from OpenaiProxyExpertBase.onPromptPrice
   * 
   * @param model - Model ID
   * @param content - The chat completion parameters
   * @returns Promise resolving to the estimated price object
   */
  async getQuote(
    model: string,
    content: ChatCompletionCreateParams
  ): Promise<{ amountSats: number, quoteId: string }> {
    try {
      // Calculate the number of tokens in the content
      let inputTokenCount = 0;
      
      // For OpenAI format, count tokens in each message
      inputTokenCount = this.countTokens(
        JSON.stringify(content.messages)
      );

      // Use the average output count for pricing
      const outputTokenCount = this.avgOutputCount;

      // Get current pricing
      const pricing = await this.pricing(model);
      if (!pricing) {
        // Generate a unique quote ID even for error cases
        const quoteId = `openrouter-error-${Date.now()}-${Math.random().toString(36).substring(2, 15)}`;
        return { amountSats: 0, quoteId };
      }

      // Calculate the price in sats
      const inputPrice = (inputTokenCount * pricing.inputPricePPM) / 1000000;
      const outputPrice = (outputTokenCount * pricing.outputPricePPM) / 1000000;
      const totalPrice = Math.ceil(
        (inputPrice + outputPrice) * (1 + this.margin)
      );

      // Generate a unique quote ID
      const quoteId = `openrouter-${Date.now()}-${Math.random().toString(36).substring(2, 15)}`;
      
      // Store the model and content in the activeQuotes map
      this.activeQuotes.set(quoteId, {
        model,
        content
      });

      return {
        amountSats: totalPrice,
        quoteId
      };
    } catch (error) {
      console.error("Error estimating price:", error);
      // Generate a unique quote ID for error cases
      const quoteId = `openrouter-error-${Date.now()}-${Math.random().toString(36).substring(2, 15)}`;
      return { amountSats: 0, quoteId };
    }
  }

  /**
   * Execute a chat completion request
   * Implementation of the interface method
   *
   * @param quoteId - Quote ID for the request
   * @param options - Additional options for the request
   * @returns Promise resolving to chat completion or chunks
   */
  execute(
    quoteId: string,
    options?: any
  ): APIPromise<ChatCompletion> | APIPromise<AsyncIterable<ChatCompletionChunk>> {
    // Get the stored model and content from the activeQuotes map
    const quoteData = this.activeQuotes.get(quoteId);
    
    if (!quoteData) {
      throw new Error(`No active quote found for ID: ${quoteId}`);
    }
    
    // Use the stored content
    const body = quoteData.content;
    
    // Handle streaming responses
    if (body.stream === true) {
      // Call the underlying OpenAI client to get the stream
      const resultPromise = this.openai.chat.completions.create(body, options) as APIPromise<AsyncIterable<ChatCompletionChunk>>;
      
      // Return a new promise that will resolve to a wrapped AsyncIterable
      return resultPromise.then(stream => {
        let accumulatedContent = "";
        
        // Use tapAsyncIterable to process each chunk while passing it through
        return tapAsyncIterable(stream, async (chunk) => {
          // Accumulate the content from each chunk
          accumulatedContent += chunk.choices[0]?.delta?.content || "";
          
          // When we receive the last chunk, update the average output count
          if (chunk.choices[0]?.finish_reason !== null) {
            this.updateAverageOutputCount(accumulatedContent);
          }
        });
      }) as APIPromise<AsyncIterable<ChatCompletionChunk>>;
    } else {
      // Handle non-streaming responses
      const result = this.openai.chat.completions.create(body, options) as APIPromise<ChatCompletion>;
      
      // Update the average output token count when the result is available
      result.then(response => {
        if ('choices' in response) {
          const output = response.choices[0]?.message?.content || "";
          this.updateAverageOutputCount(output);
        }
      }).catch(error => {
        console.error("Error processing completion result:", error);
      });
      
      return result;
    }
  }

  /**
   * Updates the average output token count based on new output
   *
   * @param outputContent - The content to count tokens for
   */
  private updateAverageOutputCount(outputContent: string): void {
    const outputTokenCount = this.countTokens(outputContent);

    // Update the average using the formula: avgOutputTokens = (avgOutputTokens * outputCount + newOutputCount) / (outputCount + 1)
    this.avgOutputCount =
      (this.avgOutputCount * this.outputCount + outputTokenCount) /
      (this.outputCount + 1);
    this.outputCount++;

    debugExpert(
      `Updated average output token count: ${this.avgOutputCount} (based on ${this.outputCount} outputs)`
    );
  }
}