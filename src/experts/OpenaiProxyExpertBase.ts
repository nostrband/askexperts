import { AskExpertsServer } from "../server/AskExpertsServer.js";
import { FORMAT_OPENAI, FORMAT_TEXT } from "../common/constants.js";
import {
  ExpertQuote,
  ExpertReply,
  ExpertReplies,
  Prompt,
  ExpertPrice,
  PromptFormat,
} from "../common/types.js";
import { debugExpert, debugError } from "../common/debug.js";
import { encode } from "gpt-tokenizer";
import {
  ChatCompletionCreateParams,
  ChatCompletionMessageParam,
} from "openai/resources";
import { ChatCompletionChunk } from "openai/resources/chat/completions";
import { OpenaiInterface } from "../openai/index.js";

interface PromptContext {
  content?: ChatCompletionCreateParams;
  quoteId?: string;
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

  /**
   * Optional callback to get context for prompts
   */
  #onGetContext?: (prompt: Prompt) => Promise<string>;

  /**
   * Optional callback to get system prompt for prompts
   */
  #onGetSystemPrompt?: (prompt: Prompt) => Promise<string>;

  /**
   * Model id to use
   */
  #model: string;

  /**
   * Creates a new OpenaiExpert instance
   *
   * @param options - Configuration options
   */
  constructor(options: {
    server: AskExpertsServer;
    openai: OpenaiInterface;
    model: string;
    onGetContext?: (prompt: Prompt) => Promise<string>;
    onGetSystemPrompt?: (prompt: Prompt) => Promise<string>;
  }) {
    this.#model = options.model;
    this.#onGetContext = options.onGetContext;
    this.#onGetSystemPrompt = options.onGetSystemPrompt;

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

  get onGetContext(): ((prompt: Prompt) => Promise<string>) | undefined {
    return this.#onGetContext;
  }

  set onGetContext(value: ((prompt: Prompt) => Promise<string>) | undefined) {
    this.#onGetContext = value;
  }

  get onGetSystemPrompt(): ((prompt: Prompt) => Promise<string>) | undefined {
    return this.#onGetSystemPrompt;
  }

  set onGetSystemPrompt(
    value: ((prompt: Prompt) => Promise<string>) | undefined
  ) {
    this.#onGetSystemPrompt = value;
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
  /**
   * Creates ChatCompletionCreateParams from a prompt
   *
   * @param prompt - The prompt to create params for
   * @returns ChatCompletionCreateParams object
   */
  private async createChatCompletionCreateParams(
    prompt: Prompt
  ): Promise<ChatCompletionCreateParams> {
    let content: ChatCompletionCreateParams;
    let systemPrompt: string | undefined;
    let contextText: string | undefined;

    // Get system prompt if callback is provided
    if (this.onGetSystemPrompt) {
      systemPrompt = await this.onGetSystemPrompt(prompt);
      debugExpert(`Got system prompt of ${systemPrompt.length} chars`);
    }

    // Get context if callback is provided
    if (this.onGetContext) {
      contextText = await this.onGetContext(prompt);
      debugExpert(`Got prompt context of ${contextText.length} chars`);
    }

    // Process the prompt based on its format
    switch (prompt.format) {
      case FORMAT_OPENAI: {
        // For OpenAI format, we will pass the content directly to the OpenAI API
        content = prompt.content as ChatCompletionCreateParams;

        // Ensure proper model
        content.model = this.model;
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
    if (systemPrompt) {
      const messages = content.messages.map((msg) => {
        if (msg.role === "system") {
          return { ...msg, role: "user" as const };
        }
        return msg;
      }) as ChatCompletionMessageParam[];

      // Prepend system prompt
      messages.unshift({
        role: "system" as const,
        content: systemPrompt,
      });

      content.messages = messages;
    }

    // If context is provided, prepend it to the last message
    if (contextText && content.messages.length > 0) {
      const lastMessage = content.messages[content.messages.length - 1];
      if (typeof lastMessage.content === "string") {
        lastMessage.content = `
### Context
${contextText}

### User Message
${lastMessage.content}
`;
      }
    }

    return content;
  }

  public async onPromptPrice(prompt: Prompt): Promise<ExpertPrice> {
    try {
      debugExpert(`Received prompt: ${prompt.id}`);

      const context: PromptContext = {};
      prompt.context = context;

      // Create ChatCompletionCreateParams
      context.content = await this.createChatCompletionCreateParams(prompt);

      // Use the OpenAI interface to estimate the price
      const priceEstimate = await this.openai.getQuote(
        this.model,
        context.content
      );

      // Store quote id to use it in chat completions
      context.quoteId = priceEstimate.quoteId;

      debugExpert(
        `Estimated price: ${priceEstimate.amountSats} sats (quoteId: ${
          priceEstimate.quoteId || "none"
        })`
      );

      // Return the price information
      return {
        amountSats: priceEstimate.amountSats,
        description: `Payment for ${this.model} completion`,
      };
    } catch (error) {
      debugError("Error handling prompt:", error);
      throw error;
    }
  }

  private produceReplies(
    stream: AsyncIterable<ChatCompletionChunk>,
    format: PromptFormat
  ): ExpertReplies {
    // Create an async generator function
    const generator = (async function* (this: OpenaiProxyExpertBase) {
      // NOTE: sending each word as a separate nostr event creates
      // 5x overhead (vs inference on gpt-4.1), so we're batching
      // to make it go away
      const batch = [];
      let lastSendTime = Date.now();
      const BATCH_INTERVAL_MS = 3000; // 3 seconds
      const MAX_BATCH_LENGTH = 50000; // <64Kb

      for await (const chunk of stream) {
        batch.push(chunk);
        // Dumb estimate instead of JSON.stringify
        const length = batch.reduce(
          (c, d) => c + 100 + (d.choices[0]?.delta?.content?.length || 0),
          0
        );
        const done = chunk.choices[0]?.finish_reason !== null;
        const currentTime = Date.now();
        const timeElapsed = currentTime - lastSendTime;

        // Send batch if 3 seconds have passed or if this is the last chunk
        if (
          (timeElapsed >= BATCH_INTERVAL_MS && batch.length > 0) ||
          length > MAX_BATCH_LENGTH ||
          done
        ) {
          switch (format) {
            case FORMAT_OPENAI:
              // Return the full API response
              yield {
                content: batch.slice(), // Create a copy of the batch
                done: done,
              };
              break;
            case FORMAT_TEXT:
              // Return the text output only
              yield {
                content: batch
                  .map((b) => b.choices[0]?.delta.content)
                  .filter((s) => !!s)
                  .join(),
                done: done,
              };
              break;
            default:
              throw new Error("Unsupported format");
          }

          batch.length = 0;
          lastSendTime = currentTime;
        }
      }
    }).bind(this)();

    // Add the binary property to the generator
    const expertReplies = generator as unknown as ExpertReplies;
    expertReplies.binary = false;
    
    return expertReplies;
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
        const context = prompt.context as PromptContext | undefined;

        // Use the content that was created in onPromptPrice
        if (!context?.content) {
          throw new Error("Content not found in prompt context");
        }
        if (!context.quoteId) {
          throw new Error("quoteId not found in prompt context");
        }

        const content = context.content;

        // Call the OpenAI API
        if (content.stream) {
          const streamResult = await this.openai.execute(context.quoteId);

          // Check if the result is an AsyncIterable
          if (!("choices" in streamResult)) {
            const stream = streamResult as AsyncIterable<ChatCompletionChunk>;
            const replies = this.produceReplies(stream, prompt.format);
            return replies;
          } else {
            throw new Error(
              "Expected streaming response but got non-streaming response"
            );
          }
        } else {
          const completion = await this.openai.execute(context.quoteId);

          // Check if the result is a ChatCompletion
          if ("choices" in completion) {
            // Extract content in text format
            const output = completion.choices[0]?.message?.content || "";

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
          } else {
            throw new Error(
              "Expected non-streaming response but got streaming response"
            );
          }
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
  async [Symbol.asyncDispose]() {
    debugExpert("Clearing OpenaiProxyExpertBase");
    // Nothing to dispose here really
  }
}
