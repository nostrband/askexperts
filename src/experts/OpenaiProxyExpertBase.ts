import { AskExpertsServer } from "../server/AskExpertsServer.js";
import {
  FORMAT_OPENAI,
  FORMAT_TEXT,
} from "../common/constants.js";
import {
  ExpertQuote,
  ExpertReply,
  ExpertReplies,
  Prompt,
  ExpertPrice,
} from "../common/types.js";
import { debugExpert, debugError } from "../common/debug.js";
import { encode } from "gpt-tokenizer";
import {
  ChatCompletionCreateParams,
  ChatCompletionMessageParam,
} from "openai/resources";
import { ModelPricing } from "./utils/ModelPricing.js";
import { OpenaiInterface } from "../openai/index.js";

interface PromptContext {
  context?: string;
  systemPrompt?: string;
}

/**
 * OpenAI Expert implementation for NIP-174
 * Provides direct access to OpenAI models with pricing based on token usage
 */
export class OpenaiProxyExpertBase {
  /**
   * AskExpertsServer instance
   */
  public readonly server: AskExpertsServer;

  /**
   * OpenAI client
   */
  public readonly openai: OpenaiInterface;

  // FIXME make these two private and add accessors

  /**
   * Optional callback to get context for prompts
   */
  onGetContext?: (prompt: Prompt) => Promise<string>;

    /**
   * Optional callback to get system prompt for prompts
   */
  onGetSystemPrompt?: (prompt: Prompt) => Promise<string>;

  /**
   * Model id to use
   */
  #model: string;

  /**
   * Profit margin (e.g., 0.1 for 10%)
   */
  #margin: number;

  /**
   * Model pricing provider
   */
  public readonly pricingProvider: ModelPricing;

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
    server: AskExpertsServer;
    openai: OpenaiInterface;
    model: string;
    margin: number;
    pricingProvider: ModelPricing;
    avgOutputTokens?: number;
    onGetContext?: (prompt: Prompt) => Promise<string>;
    onGetSystemPrompt?: (prompt: Prompt) => Promise<string>;
  }) {
    this.#model = options.model;
    this.#margin = options.margin;
    this.pricingProvider = options.pricingProvider;
    this.avgOutputCount = options.avgOutputTokens || 300;
    this.onGetContext = options.onGetContext;
    this.onGetSystemPrompt = options.onGetSystemPrompt;

    // Use the provided OpenAI client
    this.openai = options.openai;

    // Use provided server
    this.server = options.server;
  }

  /**
   * Starts the expert
   */
  async start(): Promise<void> {
    // Ensure our callbacks, unless overridden by the client
    if (!this.server.onPromptPrice)
      this.server.onPromptPrice = this.onPromptPrice.bind(this);
    if (!this.server.onPromptPaid)
      this.server.onPromptPaid = this.onPromptPaid.bind(this);
    if (!this.server.formats.includes(FORMAT_OPENAI))
      this.server.formats.push(FORMAT_OPENAI);

    // Start the server
    await this.server.start();
  }

  /**
   * Gets the model ID used by this expert
   *
   * @returns The model ID
   */
  get model(): string {
    return this.#model;
  }

  /**
   * Gets the margin
   *
   * @returns Margin
   */
  get margin(): number {
    return this.#margin;
  }

  set margin(value: number) {
    this.#margin = value;
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

  /**
   * Callback that fetches the system prompt and context for
   * this prompt and estimates it's price. Made public to be 
   * reusable.
   * @param prompt - prompt
   * @returns - expert price
   */
  public async onPromptPrice(prompt: Prompt): Promise<ExpertPrice> {
    try {
      debugExpert(`Received prompt: ${prompt.id}`);

      const context: PromptContext = {};
      prompt.context = context;

      // If onGetContext is provided, call it and set the result to prompt.context
      if (this.onGetSystemPrompt) {
        context.systemPrompt = await this.onGetSystemPrompt(prompt);
        debugExpert(`Got system prompt of ${context.systemPrompt.length} chars`);
      }

      // If onGetContext is provided, call it and set the result to prompt.context
      if (this.onGetContext) {
        context.context = await this.onGetContext(prompt);
        debugExpert(`Got prompt context of ${context.context.length} chars`);
      }

      // Calculate the number of tokens in the prompt
      let inputTokenCount = 0;
      if (context.systemPrompt)
        inputTokenCount += this.countTokens(context.systemPrompt);

      // Count tokens in the context if available
      if (context.context) {
        inputTokenCount += this.countTokens(context.context);
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
          context.context?.length || 0
        })`
      );

      // Return the price information
      return {
        amountSats: totalPrice,
        description: `Payment for ${this.model} completion`
      };
    } catch (error) {
      debugError("Error handling prompt:", error);
      throw error;
    }
  }

  /**
   * Executes prompts after the quote was paid
   *
   * @param prompt - The prompt event
   * @param quote - The quote
   * @returns Promise resolving to the expert's reply
   */
  public async onPromptPaid(
    prompt: Prompt,
    quote: ExpertQuote
  ): Promise<ExpertReply | ExpertReplies> {
    try {
      debugExpert(`Processing paid prompt: ${prompt.id}`);

      try {
        let content: ChatCompletionCreateParams;

        const context = prompt.context as PromptContext | undefined;

        // Process the prompt based on its format
        switch (prompt.format) {
          case FORMAT_OPENAI: {
            // For OpenAI format, we will pass the content directly to the OpenAI API
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
        if (context?.systemPrompt) {
          const messages = content.messages.map((msg) => {
            if (msg.role === "system") {
              return { ...msg, role: "user" as const };
            }
            return msg;
          }) as ChatCompletionMessageParam[];

          // Prepend system prompt
          messages.unshift({
            role: "system" as const,
            content: context.systemPrompt,
          });

          content.messages = messages;
        }

        // If context is provided, prepend it to the last message
        if (context?.context && content.messages.length > 0) {
          const lastMessage = content.messages[content.messages.length - 1];
          if (typeof lastMessage.content === "string") {
            lastMessage.content = `
### Context
${context.context}

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
      debugError("Error handling paid prompt:", error);
      throw error;
    }
  }

  /**
   * Disposes of resources when the expert is no longer needed
   */
  [Symbol.dispose](): void {
    // Nothing to dispose here really
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
