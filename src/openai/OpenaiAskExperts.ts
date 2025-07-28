import { APIPromise, OpenAI } from "openai";
import {
  ChatCompletionCreateParams,
  ChatCompletion,
  ChatCompletionCreateParamsNonStreaming,
  ChatCompletionCreateParamsStreaming,
  ChatCompletionCreateParamsBase,
  ChatCompletionChunk,
} from "openai/resources/chat/completions";
import { OpenaiInterface } from "./index.js";
import { PricingResult } from "../experts/utils/ModelPricing.js";
import { Prompt, Quote, Proof, Replies, Reply } from "../common/types.js";
import { AskExpertsClient } from "../client/AskExpertsClient.js";
import { LightningPaymentManager } from "../payments/LightningPaymentManager.js";
import { SimplePool } from "nostr-tools";
import { Compression } from "../common/compression.js";
import { parseBolt11 } from "../common/bolt11.js";
import { METHOD_LIGHTNING, FORMAT_OPENAI } from "../common/constants.js";
import { debugError } from "../common/debug.js";

/**
 * OpenAI interface implementation that uses AskExperts
 * Provides a bridge between OpenAI API and AskExperts protocol
 */
export class OpenaiAskExperts implements OpenaiInterface {
  /**
   * The AskExpertsClient instance
   */
  private client: AskExpertsClient;

  /**
   * The LightningPaymentManager instance
   */
  private paymentManager: LightningPaymentManager;

  /**
   * Map of active quotes with their resolution callbacks and stream flags
   */
  private activeQuotes: Map<string, {
    resolveCallback: (value: boolean) => void,
    stream: boolean,
    repliesPromise: Promise<Replies>
  }> = new Map();

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
   * Creates a new OpenaiAskExperts instance
   * 
   * @param paymentManager - The LightningPaymentManager instance
   * @param options - Optional configuration
   * @param options.compression - Custom compression implementation
   * @param options.pool - SimplePool instance for relay operations
   * @param options.discoveryRelays - Array of discovery relay URLs to use as fallback
   */
  constructor(
    paymentManager: LightningPaymentManager,
    options?: {
      compression?: Compression;
      pool?: SimplePool;
      discoveryRelays?: string[];
    }
  ) {
    this.paymentManager = paymentManager;

    // Create the AskExpertsClient instance with the provided options
    this.client = new AskExpertsClient({
      compression: options?.compression,
      pool: options?.pool,
      discoveryRelays: options?.discoveryRelays,
      onPay: this.onPay.bind(this),
    });

    // Initialize the chat completions implementation
    // We need to use a proxy to match the OpenAI API structure
    this.chat = {
      completions: {
        create: ((body: ChatCompletionCreateParams, options?: any) => {
          // Create a promise that will be wrapped in an APIPromise-like object
          const promise = this.createChatCompletion(body, options);
          
          // Add properties to make it look like an APIPromise
          // This is a simplified version that mimics the structure
          const apiPromise = promise as any;
          
          // Return the enhanced promise
          return apiPromise;
        }) as any,
      },
    };
  }

  /**
   * Gets pricing information for a model in sats per million tokens
   * Always returns undefined as pricing is handled by AskExperts
   * 
   * @param model - Model ID
   * @returns Promise resolving to undefined
   */
  async pricing(model: string): Promise<PricingResult | undefined> {
    return undefined;
  }

  /**
   * Estimates the price of processing a prompt
   * Uses AskExpertsClient to get a quote from an expert
   * 
   * @param model - Model ID (used as expert pubkey)
   * @param content - The chat completion parameters
   * @returns Promise resolving to the estimated price object
   */
  async estimatePrice(
    model: string,
    content: ChatCompletionCreateParams
  ): Promise<{ amountSats: number, quoteId: string }> {
    // Create a promise that will be resolved when the quote is received
    return new Promise<{ amountSats: number, quoteId: string }>(async (resolve, reject) => {
      try {
        // First, fetch the expert using the model as the expert pubkey
        const experts = await this.client.fetchExperts({
          pubkeys: [model],
        });

        // Check if the expert was found
        if (experts.length === 0) {
          throw new Error(`Expert with pubkey ${model} not found`);
        }

        // Get the first expert from the results
        const expert = experts[0];

        // Check if the expert supports the FORMAT_OPENAI format
        if (!expert.formats.includes(FORMAT_OPENAI)) {
          throw new Error(`Expert with pubkey ${model} does not support the FORMAT_OPENAI format`);
        }

        // Call askExpert with the fetched expert and a custom onQuote callback
        const repliesPromise = this.client.askExpert({
          expert,
          content: content,
          format: FORMAT_OPENAI,
          onQuote: async (quote: Quote, promptObj: Prompt) => {
            // Find the lightning invoice
            const lightningInvoice = quote.invoices.find(
              (inv) => inv.method === METHOD_LIGHTNING && inv.invoice
            );

            if (!lightningInvoice || !lightningInvoice.invoice) {
              throw new Error("No lightning invoice found in quote");
            }

            // Parse the invoice to get the amount
            const parsedInvoice = parseBolt11(lightningInvoice.invoice);
            const amountSats = parsedInvoice.amount_sats;

            // Generate a unique quote ID
            const quoteId = quote.event.id;

            // Create a promise that will be resolved when the payment is approved
            const paymentPromise = new Promise<boolean>((resolvePayment) => {
              // Store the resolution callback, stream flag, and replies promise in the activeQuotes map
              this.activeQuotes.set(quoteId, {
                resolveCallback: resolvePayment,
                stream: !!content.stream,
                repliesPromise
              });
            });

            // Attach a rejection handler to the repliesPromise to clean up activeQuotes
            // if the promise is rejected and createChatCompletion is never called
            repliesPromise.catch(error => {
              debugError("repliesPromise rejected:", error);
              this.activeQuotes.delete(quoteId);
            });

            // Resolve the estimatePrice promise with the amount and quote ID
            resolve({
              amountSats,
              quoteId,
            });

            // Return the payment promise
            return paymentPromise;
          },
        });
      } catch (error) {
        debugError("Error estimating price:", error);
        reject(error);
      }
    });
  }

  /**
   * Creates a chat completion
   * Approves the payment for the quote and returns the result
   * 
   * @param body - Chat completion parameters
   * @param options - Optional parameters including quoteId
   * @returns Promise resolving to chat completion or chunks
   */
  private async createChatCompletion(
    body: ChatCompletionCreateParams,
    options?: any
  ): Promise<ChatCompletion | AsyncIterable<ChatCompletionChunk>> {
    try {
      // Get the quote ID from the options
      const quoteId = options?.quoteId;

      if (!quoteId) {
        throw new Error("quoteId is required in options");
      }

      // Find the quote data in the activeQuotes map
      const quoteData = this.activeQuotes.get(quoteId);

      if (!quoteData) {
        throw new Error(`No active quote found for ID: ${quoteId}. You may need to call estimatePrice first.`);
      }

      // Approve the payment
      quoteData.resolveCallback(true);

      // Store stream flag and model before potential deletion
      const isStream = quoteData.stream;
      const modelName = body.model as string;

      try {
        // Wait for the replies from the expert
        const replies = await quoteData.repliesPromise;

        // Remove the quote from the activeQuotes map
        this.activeQuotes.delete(quoteId);

        // Check if streaming is requested
        if (isStream) {
          // Return an AsyncIterable that yields ChatCompletionChunk objects
          return this.createStreamingResponse(replies);
        } else {
          // Read all replies and return a single ChatCompletion
          return this.createNonStreamingResponse(replies, modelName);
        }
      } catch (error) {
        // Make sure to delete the quote from activeQuotes even if the promise is rejected
        this.activeQuotes.delete(quoteId);
        throw error;
      }
    } catch (error) {
      debugError("Error in createChatCompletion:", error);
      throw error;
    }
  }

  /**
   * Creates a streaming response from replies
   * 
   * @param replies - The replies from the expert
   * @returns AsyncIterable of ChatCompletionChunk objects
   */
  private async *createStreamingResponse(replies: Replies): AsyncIterable<ChatCompletionChunk> {
    for await (const reply of replies) {
      // The content should be an array of ChatCompletionChunk objects
      if (Array.isArray(reply.content)) {
        for (const chunk of reply.content) {
          yield chunk as ChatCompletionChunk;
        }
      } else {
        // If it's not an array, yield it directly
        yield reply.content as ChatCompletionChunk;
      }
    }
  }

  /**
   * Creates a non-streaming response from replies
   * 
   * @param replies - The replies from the expert
   * @param model - The model name
   * @returns ChatCompletion object
   */
  private async createNonStreamingResponse(replies: Replies, model: string): Promise<ChatCompletion> {
    // Read all replies
    const allReplies: Reply[] = [];
    for await (const reply of replies) {
      allReplies.push(reply);
    }
    if (allReplies.length !== 1 || !allReplies[0].done) {
      throw new Error("No reply found in the responses");
    }

    // The content should be a ChatCompletion object
    return allReplies[0].content as ChatCompletion;
  }

  /**
   * Callback for handling payments
   * Called when a quote is accepted to process the payment
   * 
   * @param quote - The quote to pay
   * @param prompt - The prompt being processed
   * @returns Promise resolving to payment proof
   */
  private async onPay(quote: Quote, prompt: Prompt): Promise<Proof> {
    // Find the lightning invoice
    const lightningInvoice = quote.invoices.find(
      (inv) => inv.method === METHOD_LIGHTNING && inv.invoice
    );

    if (!lightningInvoice || !lightningInvoice.invoice) {
      throw new Error("No lightning invoice found in quote");
    }

    // Pay the invoice using the payment manager
    const preimage = await this.paymentManager.payInvoice(lightningInvoice.invoice);

    // Return the proof
    return {
      method: METHOD_LIGHTNING,
      preimage,
    };
  }

  /**
   * Disposes of resources when the instance is no longer needed
   */
  [Symbol.dispose](): void {
    // Dispose of the client
    this.client[Symbol.dispose]();
  }
}
