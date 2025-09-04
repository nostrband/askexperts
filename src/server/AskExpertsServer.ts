/**
 * Expert implementation for NIP-174 with payment handling
 * Extends the base server with payment functionality
 */

import { SimplePool } from "nostr-tools";
import { AskExpertsServerBase } from "./AskExpertsServerBase.js";
import { ExpertPaymentManager } from "../payments/ExpertPaymentManager.js";
import {
  Prompt,
  ExpertQuote,
  Proof,
  ExpertReplies,
  ExpertReply,
  OnPromptPriceCallback,
  OnPromptPaidCallback,
  AskExpertsServerLogger,
} from "../common/types.js";
import { debugError } from "../common/debug.js";
import { StreamFactory } from "../stream/index.js";

/**
 * Expert server with payment handling
 * Extends the base server with payment functionality
 */
import { AskExpertsServerInterface } from "./AskExpertsServerInterface.js";

export class AskExpertsServer
  extends AskExpertsServerBase
  implements AskExpertsServerInterface
{
  /**
   * Payment manager for handling expert payments
   */
  private paymentManager: ExpertPaymentManager;

  /**
   * Callback for determining prompt prices
   */
  #onPromptPrice?: OnPromptPriceCallback;

  /**
   * Callback for handling paid prompts
   */
  #onPromptPaid?: OnPromptPaidCallback;

  /**
   * Default expiry time for invoices in seconds
   */
  private readonly DEFAULT_EXPIRY_SEC = 120; // 2 min

  /**
   * Creates a new AskExpertsServer instance
   *
   * @param options - Configuration options
   * @param options.privkey - Expert's private key (required)
   * @param options.paymentManager - Payment manager for handling expert payments (required)
   * @param options.discoveryRelays - Relays for discovery phase
   * @param options.promptRelays - Relays for prompt phase
   * @param options.hashtags - Hashtags the expert is interested in
   * @param options.formats - Formats supported by the expert
   * @param options.streamFactory - StreamFactory for creating stream readers and writers
   * @param options.paymentMethods - Payment methods supported by the expert
   * @param options.onAsk - Callback for handling asks
   * @param options.onPromptPrice - Callback for determining prompt prices
   * @param options.onPromptPaid - Callback for handling paid prompts
   * @param options.pool - SimplePool instance for relay operations
   * @param options.streamFactory - Custom StreamFactory implementation
   */
  constructor(options: {
    privkey: Uint8Array;
    paymentManager: ExpertPaymentManager;
    discoveryRelays?: string[];
    promptRelays?: string[];
    hashtags?: string[];
    formats?: string[];
    onAsk?: (ask: any) => Promise<any>;
    onPromptPrice?: OnPromptPriceCallback;
    onPromptPaid?: OnPromptPaidCallback;
    paymentMethods?: string[];
    pool: SimplePool;
    streamFactory?: StreamFactory;
    logger?: AskExpertsServerLogger;
    nickname?: string;
    description?: string;
    profileHashtags?: string[];
    picture?: string;
    tags?: string[][];
  }) {
    // Initialize the base class with all options except paymentManager
    super({
      privkey: options.privkey,
      discoveryRelays: options.discoveryRelays,
      promptRelays: options.promptRelays,
      hashtags: options.hashtags,
      formats: options.formats,
      onAsk: options.onAsk,
      // We'll provide our own onPrompt and onProof callbacks
      onPrompt: undefined,
      onProof: undefined,
      paymentMethods: options.paymentMethods,
      pool: options.pool,
      streamFactory: options.streamFactory,
      logger: options.logger,
      nickname: options.nickname,
      description: options.description,
      profileHashtags: options.profileHashtags,
      picture: options.picture,
      tags: options.tags,
    });

    // Store the payment manager
    this.paymentManager = options.paymentManager;

    // Store the callbacks
    this.#onPromptPrice = options.onPromptPrice;
    this.#onPromptPaid = options.onPromptPaid;

    // Set our custom onPrompt and onProof callbacks
    this.onPrompt = this.handlePrompt.bind(this);
    this.onProof = this.handleProof.bind(this);
  }

  /**
   * Gets the callback for determining prompt prices
   */
  get onPromptPrice(): OnPromptPriceCallback | undefined {
    return this.#onPromptPrice;
  }

  /**
   * Sets the callback for determining prompt prices
   */
  set onPromptPrice(value: OnPromptPriceCallback | undefined) {
    this.#onPromptPrice = value;
  }

  /**
   * Gets the callback for handling paid prompts
   */
  get onPromptPaid(): OnPromptPaidCallback | undefined {
    return this.#onPromptPaid;
  }

  /**
   * Sets the callback for handling paid prompts
   */
  set onPromptPaid(value: OnPromptPaidCallback | undefined) {
    this.#onPromptPaid = value;
  }

  /**
   * Custom prompt handler that determines price and creates invoices
   *
   * @param prompt - The prompt to handle
   * @returns Promise resolving to an ExpertQuote
   */
  private async handlePrompt(prompt: Prompt): Promise<ExpertQuote> {
    try {
      // Check if we have a price callback
      if (!this.#onPromptPrice) {
        throw new Error("No prompt price handler configured");
      }

      // Get the price from the callback
      const price = await this.#onPromptPrice(prompt);

      // Create invoices using the payment manager
      const invoices = await this.paymentManager.makeInvoices(
        price.amountSats,
        price.description,
        this.DEFAULT_EXPIRY_SEC
      );

      // Return the quote with invoices
      return { invoices };
    } catch (error) {
      debugError("Error handling prompt:", error);
      throw error;
    }
  }

  /**
   * Custom proof handler that verifies payment and processes the prompt
   *
   * @param prompt - The prompt to handle
   * @param quote - The expert quote containing invoices
   * @param proof - The payment proof
   * @returns Promise resolving to ExpertReplies or ExpertReply
   */
  private async handleProof(
    prompt: Prompt,
    quote: ExpertQuote,
    proof: Proof
  ): Promise<ExpertReplies | ExpertReply> {
    try {
      // Check if we have a paid prompt callback
      if (!this.#onPromptPaid) {
        throw new Error("No prompt paid handler configured");
      }

      // Verify the payment using the payment manager
      await this.paymentManager.verifyPayment(quote, proof);

      // Process the paid prompt
      return await this.#onPromptPaid(prompt, quote);
    } catch (error) {
      debugError("Error handling proof:", error);
      throw error;
    }
  }
}
