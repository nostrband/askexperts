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
  private server!: AskExpertsServer;

  /**
   * Server options stored for initialization in start()
   */
  private serverOptions: {
    privkey: Uint8Array;
    discoveryRelays: string[];
    promptRelays: string[];
    hashtags: string[];
    pool?: SimplePool;
  };

  /**
   * LightningPaymentManager instance
   */
  private paymentManager: LightningPaymentManager;

  /**
   * OpenAI client
   */
  private openai: OpenAI;

  /**
   * Optional callback to get context for prompts
   */
  private onPromptContext?: (prompt: Prompt) => Promise<string>;

  /**
   * Model id to use
   */
  private model: string;

  /**
   * Model vendor
   */
  private modelVendor: string;

  /**
   * Model name
   */
  private modelName: string;

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
   * Expert nickname
   */
  private nickname: string;

  /**
   * Callback for getting dynamic description
   */
  private onGetDescription?: () => Promise<string>;

  /**
   * Custom onAsk callback if provided
   */
  private onAskCallback?: (ask: Ask) => Promise<ExpertBid | undefined>;

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
    hashtags?: string[];
    onAsk?: (ask: Ask) => Promise<ExpertBid | undefined>;
    onPromptContext?: (prompt: Prompt) => Promise<string>;
    nickname?: string;
    onGetDescription?: () => Promise<string>;
  }) {
    this.model = options.model;
    this.modelVendor = this.model.split("/")[0];
    this.modelName = (this.model.split("/")?.[1] || this.model).split(
      /[\s\p{P}]+/u
    )[0];
    this.margin = options.margin;
    this.systemPrompt = options.systemPrompt;
    this.pricingProvider = options.pricingProvider;
    this.avgOutputCount = options.avgOutputTokens || 300;
    this.nickname = options.nickname || this.model;

    // Create the OpenAI client
    this.openai = new OpenAI({
      apiKey: options.openaiApiKey,
      baseURL: options.openaiBaseUrl,
    });

    // Create the payment manager
    this.paymentManager = new LightningPaymentManager(options.nwcString);

    // Store server options for later initialization
    this.serverOptions = {
      privkey: options.privkey,
      discoveryRelays: options.discoveryRelays || DEFAULT_DISCOVERY_RELAYS,
      promptRelays: options.promptRelays || DEFAULT_DISCOVERY_RELAYS,
      hashtags: options.hashtags || [
        this.model,
        this.modelVendor,
        this.modelName,
      ],
      pool: options.pool,
    };

    // Store the onPromptContext callback if provided
    if (options.onPromptContext) {
      this.onPromptContext = options.onPromptContext;
    }

    // Set nickname
    this.nickname = options.nickname || this.model;
    
    // Store callbacks if provided
    this.onAskCallback = options.onAsk;
    this.onGetDescription = options.onGetDescription;
  }

  /**
   * Starts the expert
   */
  async start(): Promise<void> {
    // Create the server
    this.server = new AskExpertsServer({
      ...this.serverOptions,
      formats: [FORMAT_TEXT, FORMAT_OPENAI],
      onAsk: this.onAskCallback || this.onAsk.bind(this),
      onPrompt: this.onPrompt.bind(this),
      onProof: this.onProof.bind(this),
      nickname: this.nickname,
      onGetDescription: this.onGetDescription || this.getDescription.bind(this),
    });

    // Start the server
    await this.server.start();
  }

  private async getDescription(): Promise<string> {
    // Get current pricing, it might change over time
    const pricing = await this.pricingProvider.pricing(this.model);
    return `I'm an expert providing direct access to LLM model ${this.model}. Input token price per million: ${pricing.inputPricePPM} sats, output token price per million ${pricing.outputPricePPM} sats. System prompt: ${this.systemPrompt ? "disallowed" : "allowed"}`;
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
      const description = await (this.onGetDescription || this.getDescription.bind(this))();
      
      return {
        offer: description,
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

      // If onPromptContext is provided, call it and set the result to prompt.context
      if (this.onPromptContext) {
        prompt.context = await this.onPromptContext(prompt);
        debugExpert(`Got prompt context of ${prompt.context.length} chars`);
      }

      // Calculate the number of tokens in the prompt
      let inputTokenCount = 0;
      if (this.systemPrompt)
        inputTokenCount += this.countTokens(this.systemPrompt);

      // Count tokens in the context if available
      if (prompt.context) {
        inputTokenCount += this.countTokens(prompt.context);
      }

      if (prompt.format === FORMAT_OPENAI) {
        // For OpenAI format, count tokens in each message
        inputTokenCount += this.countTokens(
          JSON.stringify(prompt.content.messages)
        );
      } else if (prompt.format === FORMAT_TEXT) {
        // For text format, count tokens in the content
        inputTokenCount += this.countTokens(prompt.content);
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
        `Calculated price: ${totalPrice} sats (input: ${inputTokenCount} tokens, output: ${outputTokenCount} tokens, context: ${
          prompt.context?.length || 0
        })`
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

        let content: ChatCompletionCreateParams | undefined;

        // Process the prompt based on its format
        switch (prompt.format) {
          case FORMAT_OPENAI: {
            // For OpenAI format, we will pass the content directly to the OpenAI API

            // We'll pass the content verbatim
            content = prompt.content as ChatCompletionCreateParams;

            // Ensure proper model
            content.model = this.model;

            // Check if streaming is requested
            if (content.stream) {
              throw new Error("Streaming is not supported yet");
            }
            break;
          }
          case FORMAT_TEXT: {
            // For text format, convert to a single user message
            content = {
              model: this.model,
              messages: [
                {
                  role: "user" as const,
                  content: prompt.content,
                },
              ],
            };
            break;
          }
          default:
            throw new Error(`Unsupported format: ${prompt.format}`);
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

        // If context is provided, prepend it to the last message
        if (prompt.context && content.messages.length > 0) {
          const lastMessage = content.messages[content.messages.length - 1];
          if (typeof lastMessage.content === "string") {
            lastMessage.content = `
### Context
${prompt.context}

### Message
${lastMessage.content}
`;
          }
        }

        // Call the OpenAI API
        const completion = await this.openai.chat.completions.create(content);

        // Extract content in text format
        const output = completion.choices[0]?.message?.content || "";

        // Update average output token count
        this.updateAverageOutputCount(output);

        switch (prompt.format) {
          case FORMAT_OPENAI:
            // Return the full API response
            return {
              content: completion,
              done: true,
            };
          case FORMAT_TEXT:
            // Return the output only
            return {
              content: output,
              done: true,
            };
          default:
            throw new Error("Unsupported format");
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
