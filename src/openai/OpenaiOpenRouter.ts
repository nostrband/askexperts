import { encode } from "gpt-tokenizer";
import { APIPromise } from "openai";
import {
  ChatCompletionCreateParams,
  ChatCompletion,
  ChatCompletionCreateParamsNonStreaming,
  ChatCompletionCreateParamsStreaming,
  ChatCompletionCreateParamsBase,
  ChatCompletionChunk,
} from "openai/resources/chat/completions";
import { OpenaiInterface } from "./index.js";
import { OpenRouter } from "../experts/utils/OpenRouter.js";
import { PricingResult } from "../experts/utils/ModelPricing.js";

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
  private openai: OpenaiInterface;

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
   * Chat completions implementation
   */
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
   * Creates a new OpenaiOpenRouter instance
   *
   * @param openai - The underlying OpenAI client
   * @param openRouter - The OpenRouter instance for pricing
   * @param margin - Profit margin (default: 0)
   */
  constructor(
    openai: OpenaiInterface,
    openRouter: OpenRouter,
    margin: number = 0
  ) {
    this.openai = openai;
    this.openRouter = openRouter;
    this.margin = margin;

    // Initialize the chat completions implementation
    this.chat = {
      completions: {
        create: ((body: ChatCompletionCreateParams, options?: any) => {
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
            });
          } else {
            // Handle non-streaming responses (existing code)
            const result = this.openai.chat.completions.create(body, options);
            
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
        }) as any,
      },
    };
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
  async estimatePrice(
    model: string,
    content: ChatCompletionCreateParams
  ): Promise<{ amountSats: number, quoteId?: string }> {
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
        return { amountSats: 0 };
      }

      // Calculate the price in sats
      const inputPrice = (inputTokenCount * pricing.inputPricePPM) / 1000000;
      const outputPrice = (outputTokenCount * pricing.outputPricePPM) / 1000000;
      const totalPrice = Math.ceil(
        (inputPrice + outputPrice) * (1 + this.margin)
      );

      return { 
        amountSats: totalPrice,
        quoteId: undefined  // OpenRouter doesn't provide quote IDs
      };
    } catch (error) {
      console.error("Error estimating price:", error);
      return { amountSats: 0 };
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

    console.log(
      `Updated average output token count: ${this.avgOutputCount} (based on ${this.outputCount} outputs)`
    );
  }
}