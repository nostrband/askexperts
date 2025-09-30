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
import { DefaultStreamFactory } from "../stream/DefaultStreamFactory.js";

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
   * Optional callback to get custom invoice description
   */
  #onGetInvoiceDescription?: (prompt: Prompt) => Promise<string>;

  /**
   * Model id to use
   */
  #model: string;

  /**
   * Temperature for model responses (0-2)
   */
  #temperature?: number;

  /**
   * Creates a new OpenaiExpert instance
   *
   * @param options - Configuration options
   */
  constructor(options: {
    server: AskExpertsServer;
    openai: OpenaiInterface;
    model: string;
    temperature?: number;
    onGetContext?: (prompt: Prompt) => Promise<string>;
    onGetSystemPrompt?: (prompt: Prompt) => Promise<string>;
    onGetInvoiceDescription?: (prompt: Prompt) => Promise<string>;
  }) {
    this.#model = options.model;
    this.#temperature = options.temperature;
    this.#onGetContext = options.onGetContext;
    this.#onGetSystemPrompt = options.onGetSystemPrompt;
    this.#onGetInvoiceDescription = options.onGetInvoiceDescription;

    // Use the provided OpenAI client
    this.openai = options.openai;

    // Use provided server
    this.server = options.server;

    // Custom stream factory to make real-time delta streaming
    // work as we need it to
    const streamFactory = new DefaultStreamFactory();
    streamFactory.writerConfig = {
      minChunkInterval: 1000, // Send a delta every second
      minChunkSize: 256, // Some batching for deltas
    };
    this.server.streamFactory = streamFactory;
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

  get onGetInvoiceDescription():
    | ((prompt: Prompt) => Promise<string>)
    | undefined {
    return this.#onGetInvoiceDescription;
  }

  set onGetInvoiceDescription(
    value: ((prompt: Prompt) => Promise<string>) | undefined
  ) {
    this.#onGetInvoiceDescription = value;
  }

  /**
   * Gets the temperature setting for model responses
   *
   * @returns The temperature value or undefined if not set
   */
  get temperature(): number | undefined {
    return this.#temperature;
  }

  /**
   * Sets the temperature for model responses
   *
   * @param value - Temperature value between 0 and 2, or undefined to use model default
   */
  set temperature(value: number | undefined) {
    this.#temperature = value;
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
        break;
      }
      case FORMAT_TEXT: {
        // For text format, convert to a single user message
        content = {
          model: this.model, // Include model property to satisfy TypeScript
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

    // Ensure proper model
    content.model = this.model;

    // Set temperature if defined
    if (this.#temperature !== undefined) {
      content.temperature = this.#temperature;
    }

    // If system prompt is set, replace all system/developer roles with user
    // and prepend our system prompt
    if (systemPrompt) {
      const messages = content.messages.map((msg) => {
        if (msg.role === "system" || msg.role === "developer") {
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
**User Message**
${lastMessage.content}

**Context**
${contextText}
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

      // Client doesn't support streaming but requests it att app layer
      if (!prompt.stream && context.content.stream) {
        throw new Error("Streaming requested without client side support");
      }

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

      // Get custom invoice description if callback is provided
      let description = `Payment for ${this.model} completion`;
      if (this.onGetInvoiceDescription) {
        const customDescription = await this.onGetInvoiceDescription(prompt);
        if (customDescription) {
          description = customDescription;
        }
      }

      // Return the price information
      return {
        amountSats: priceEstimate.amountSats,
        description,
      };
    } catch (error) {
      debugError("Error handling prompt:", error);
      throw error;
    }
  }

  private produceStreamReplies(
    stream: AsyncIterable<ChatCompletionChunk>,
    format: PromptFormat
  ): ExpertReplies {
    // Create an async generator function
    const generator = async function* (this: OpenaiProxyExpertBase) {
      for await (const chunk of stream) {
        // console.error("stream chunk", JSON.stringify(chunk));
        switch (format) {
          case FORMAT_OPENAI:
            // Return the full API response in jsonl format
            yield {
              content: JSON.stringify(chunk) + "\n",
            };
            break;
          case FORMAT_TEXT:
            // FIXME how to send images using text? tool calls?
            if (!chunk.choices[0].delta.content
              // !chunk.choices[0].delta.content &&
              // // @ts-ignore
              // !chunk.choices[0].delta.images?.length &&
              // // @ts-ignore
              // !chunk.choices[0].delta.reasoning &&
              // !chunk.choices[0].delta.tool_calls?.length
            )
              continue;
            // Return the text output only
            yield {
              content: chunk.choices[0].delta.content,
            };
            break;
          default:
            throw new Error("Unsupported format");
        }
      }
    }.bind(this)();

    return generator;
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
            const replies = this.produceStreamReplies(stream, prompt.format);
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
            switch (prompt.format) {
              case FORMAT_OPENAI:
                // Return the full API response
                return {
                  content: JSON.stringify(completion),
                };
              case FORMAT_TEXT:
                // Return the output only
                return {
                  content: completion.choices[0]?.message?.content || "",
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
