import { SimplePool } from "nostr-tools";
import { AskExpertsServer } from "../server/AskExpertsServer.js";
import { LightningPaymentManager } from "../lightning/LightningPaymentManager.js";
import {
  DEFAULT_DISCOVERY_RELAYS,
  FORMAT_OPENAI,
  FORMAT_TEXT,
} from "../common/constants.js";
import {
  Ask,
  ExpertBid,
  ExpertQuote,
  ExpertReply,
  ExpertReplies,
  Prompt,
  Proof,
} from "../common/types.js";
import { debugExpert, debugError } from "../common/debug.js";
import OpenAI from "openai";
import { encode } from "gpt-tokenizer";
import {
  ChatCompletionCreateParams,
  ChatCompletionMessageParam,
} from "openai/resources";
import { ModelPricing } from "./utils/ModelPricing.js";

/**
 * OpenAI Expert implementation for NIP-174
 * Provides direct access to OpenAI models with pricing based on token usage
 */
export class OpenaiExpert {
  /**
   * AskExpertsServer instance
   */
  private server: AskExpertsServer;

  /**
   * LightningPaymentManager instance
   */
  private paymentManager: LightningPaymentManager;

  /**
   * OpenAI client
   */
  private openai: OpenAI;

  /**
   * OpenAI model to use
   */
  private model: string;

  /**
   * Profit margin (e.g., 0.1 for 10%)
   */
  private margin: number;

  /**
   * System prompt to prepend to all conversations
   */
  private systemPrompt?: string;

  /**
   * Model pricing provider
   */
  private pricingProvider: ModelPricing;

  /**
   * Average output token count for pricing estimates
   */
  private avgOutputCount: number;

  /**
   * Number of outputs processed (for averaging)
   */
  private outputCount: number = 1;

  /**
   * Creates a new OpenaiExpert instance
   *
   * @param options - Configuration options
   */
  constructor(options: {
    privkey: Uint8Array;
    openaiBaseUrl: string;
    openaiApiKey: string;
    model: string;
    nwcString: string;
    margin: number;
    systemPrompt?: string;
    pricingProvider: ModelPricing;
    discoveryRelays?: string[];
    promptRelays?: string[];
    pool?: SimplePool;
    avgOutputTokens?: number;
  }) {
    this.model = options.model;
    this.margin = options.margin;
    this.systemPrompt = options.systemPrompt;
    this.pricingProvider = options.pricingProvider;
    this.avgOutputCount = options.avgOutputTokens || 300;

    // Create the OpenAI client
    this.openai = new OpenAI({
      apiKey: options.openaiApiKey,
      baseURL: options.openaiBaseUrl,
    });

    // Create the payment manager
    this.paymentManager = new LightningPaymentManager(options.nwcString);

    // Create the server
    this.server = new AskExpertsServer({
      privkey: options.privkey,
      discoveryRelays: options.discoveryRelays || DEFAULT_DISCOVERY_RELAYS,
      promptRelays: options.promptRelays || DEFAULT_DISCOVERY_RELAYS,
      hashtags: ["llm", "model", this.model],
      formats: [FORMAT_TEXT, FORMAT_OPENAI],
      onAsk: this.onAsk.bind(this),
      onPrompt: this.onPrompt.bind(this),
      onProof: this.onProof.bind(this),
      pool: options.pool,
    });
  }

  /**
   * Starts the expert
   */
  async start(): Promise<void> {
    // Start the server
    await this.server.start();
  }

  /**
   * Gets the model ID used by this expert
   *
   * @returns The model ID
   */
  getModel(): string {
    return this.model;
  }

  /**
   * Handles ask events
   *
   * @param ask - The ask event
   * @returns Promise resolving to a bid if interested, or undefined to ignore
   */
  private async onAsk(ask: Ask): Promise<ExpertBid | undefined> {
    try {
      debugExpert(`Received ask: ${ask.id}`);

      // Get current pricing
      const pricing = await this.pricingProvider.pricing(this.model);

      // Create a bid with our offer
      const offer = `I provide direct access to '${
        this.model
      }' LLM. Input token price per million: ${
        pricing.inputPricePPM
      } sats, output token price per million ${
        pricing.outputPricePPM
      } sats. System prompt: ${this.systemPrompt ? "disallowed" : "allowed"}`;

      return {
        offer,
      };
    } catch (error) {
      debugError("Error handling ask:", error);
      return undefined;
    }
  }

  /**
   * Handles prompt events
   *
   * @param prompt - The prompt event
   * @returns Promise resolving to a quote
   */
  /**
   * Count tokens using gpt-tokenizer
   *
   * @param text - Text to count tokens for
   * @returns Token count
   */
  private countTokens(text: string): number {
    return encode(text).length;
  }

  private async onPrompt(prompt: Prompt): Promise<ExpertQuote> {
    try {
      debugExpert(`Received prompt: ${prompt.id}`);

      // Calculate the number of tokens in the prompt
      let inputTokenCount = 0;
      if (this.systemPrompt)
        inputTokenCount += this.countTokens(this.systemPrompt);

      if (prompt.format === FORMAT_OPENAI) {
        // For OpenAI format, count tokens in each message
        inputTokenCount += this.countTokens(
          JSON.stringify(prompt.content.messages)
        );
      } else if (prompt.format === FORMAT_TEXT) {
        // For text format, count tokens in the content
        inputTokenCount = this.countTokens(prompt.content);
      } else {
        throw new Error(`Unsupported format: ${prompt.format}`);
      }

      // Use the average output count for pricing
      const outputTokenCount = this.avgOutputCount;

      // Get current pricing
      const pricing = await this.pricingProvider.pricing(this.model);

      // Calculate the price in sats
      const inputPrice = (inputTokenCount * pricing.inputPricePPM) / 1000000;
      const outputPrice = (outputTokenCount * pricing.outputPricePPM) / 1000000;
      const totalPrice = Math.ceil(
        (inputPrice + outputPrice) * (1 + this.margin)
      );

      debugExpert(
        `Calculated price: ${totalPrice} sats (input: ${inputTokenCount} tokens, output: ${outputTokenCount} tokens)`
      );

      // Create an invoice
      const { invoice } = await this.paymentManager.makeInvoice(
        totalPrice,
        `Payment for ${this.model} completion`,
        60 // 1 minute expiry
      );

      // Return the quote
      return {
        invoices: [
          {
            method: "lightning",
            unit: "sat",
            amount: totalPrice,
            invoice,
          },
        ],
      };
    } catch (error) {
      debugError("Error handling prompt:", error);
      throw error;
    }
  }

  /**
   * Handles proof events and executes prompts
   *
   * @param prompt - The prompt event
   * @param quote - The quote
   * @param proof - The payment proof
   * @returns Promise resolving to the expert's reply
   */
  private async onProof(
    prompt: Prompt,
    quote: ExpertQuote,
    proof: Proof
  ): Promise<ExpertReply | ExpertReplies> {
    try {
      debugExpert(`Received proof for prompt: ${prompt.id}`);

      // Find the lightning invoice
      const lightningInvoice = quote.invoices.find(
        (inv) => inv.method === "lightning"
      );
      if (!lightningInvoice || !lightningInvoice.invoice) {
        throw new Error("No lightning invoice found in quote");
      }

      try {
        // Verify the payment
        this.paymentManager.verifyPayment({
          invoice: lightningInvoice.invoice,
          preimage: proof.preimage,
        });

        // Process the prompt based on its format
        if (prompt.format === FORMAT_OPENAI) {
          // For OpenAI format, we will pass the content directly to the OpenAI API

          // Ensure model
          const content = prompt.content as ChatCompletionCreateParams;
          content.model = this.model;

          // Check if streaming is requested
          if (content.stream) {
            throw new Error("Streaming is not supported yet");
          }

          // If system prompt is set, replace all system/developer roles with user
          // and prepend our system prompt
          if (this.systemPrompt) {
            const messages = content.messages.map((msg) => {
              if (msg.role === "system") {
                return { ...msg, role: "user" as const };
              }
              return msg;
            }) as ChatCompletionMessageParam[];

            // Prepend system prompt
            messages.unshift({
              role: "system" as const,
              content: this.systemPrompt,
            });

            content.messages = messages;
          }

          // Call the OpenAI API
          const completion = await this.openai.chat.completions.create(content);

          // Update average output token count
          this.updateAverageOutputCount(
            completion.choices[0]?.message?.content || ""
          );

          // Return the response
          return {
            content: completion,
            done: true,
          };
        } else if (prompt.format === FORMAT_TEXT) {
          // For text format, convert to a single user message
          const messages: ChatCompletionMessageParam[] = [
            {
              role: "user" as const,
              content: prompt.content,
            },
          ];

          // If system prompt is set, prepend it
          if (this.systemPrompt) {
            messages.unshift({
              role: "system" as const,
              content: this.systemPrompt,
            });
          }

          // Call the OpenAI API
          const completion = await this.openai.chat.completions.create({
            model: this.model,
            messages,
          });

          // Extract content in text format
          const content = completion.choices[0]?.message?.content || "";

          // Update average output token count
          this.updateAverageOutputCount(content);

          // Return the response
          return {
            content,
            done: true,
          };
        } else {
          throw new Error(`Unsupported format: ${prompt.format}`);
        }
      } catch (error) {
        debugError("Error processing prompt:", error);
        throw error;
      }
    } catch (error) {
      debugError("Error handling proof:", error);
      throw error;
    }
  }

  /**
   * Disposes of resources when the expert is no longer needed
   */
  [Symbol.dispose](): void {
    // Dispose of the server
    this.server[Symbol.dispose]();

    // Dispose of the payment manager
    this.paymentManager[Symbol.dispose]();
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
