import { AskExpertsClient } from "./AskExpertsClient.js";
import { LightningPaymentManager } from "../payments/LightningPaymentManager.js";
import { ExpertPaymentManager } from "../payments/ExpertPaymentManager.js";
import { parseBolt11 } from "../common/bolt11.js";
import { debugError } from "../common/debug.js";
import { Proof, Quote, Prompt } from "../common/types.js";

/**
 * AskExpertsPayingClient class that extends AskExpertsClient with payment capabilities
 * This class abstracts payment handling logic that was duplicated in AskExpertsSmartClient and AskExpertsChatClient
 */
export class AskExpertsPayingClient extends AskExpertsClient {
  #paymentManager: ExpertPaymentManager;
  #maxAmountSats: number = 100; // Default max amount
  #onPaid?: (prompt: Prompt, quote: Quote, proof: Proof) => Promise<void>;

  /**
   * Creates a new AskExpertsPayingClient instance
   *
   * @param paymentManager - Payment manager for handling payments
   * @param options - Optional configuration
   * @param options.maxAmountSats - Maximum amount to pay in satoshis
   * @param options.discoveryRelays - Array of discovery relay URLs to use as fallback
   */
  constructor(
    paymentManager: ExpertPaymentManager,
    options?: {
      maxAmountSats?: number;
      discoveryRelays?: string[];
      onPaid?: (prompt: Prompt, quote: Quote, proof: Proof) => Promise<void>;
    }
  ) {
    // Create the client with callbacks for quotes and payments
    super({
      discoveryRelays: options?.discoveryRelays,
      onQuote: (quote, prompt) => this.handleQuote(quote, prompt),
      onPay: (quote, prompt) => this.handlePayment(quote, prompt),
    });

    if (!paymentManager) {
      throw new Error("Payment manager is required");
    }

    this.#paymentManager = paymentManager;

    // Set max amount if provided
    if (options?.maxAmountSats) {
      this.#maxAmountSats = options.maxAmountSats;
    }

    // Set onPaid callback if provided
    if (options?.onPaid) {
      this.#onPaid = options.onPaid;
    }
  }

  /**
   * Sets the maximum amount to pay in satoshis
   * 
   * @param maxAmountSats - Maximum amount to pay in satoshis
   */
  /**
   * Gets the maximum amount to pay in satoshis
   */
  get maxAmountSats(): number {
    return this.#maxAmountSats;
  }

  /**
   * Sets the maximum amount to pay in satoshis
   */
  set maxAmountSats(value: number) {
    if (value <= 0) {
      throw new Error("Maximum amount must be greater than zero");
    }
    this.#maxAmountSats = value;
  }

  /**
   * Gets the current onPaid callback function
   */
  get onPaid(): ((prompt: Prompt, quote: Quote, proof: Proof) => Promise<void>) | undefined {
    return this.#onPaid;
  }

  /**
   * Sets the onPaid callback function
   */
  set onPaid(callback: (prompt: Prompt, quote: Quote, proof: Proof) => Promise<void>) {
    this.#onPaid = callback;
  }

  /**
   * Handles quote events from experts
   *
   * @param quote - Quote from expert
   * @param prompt - Prompt sent to expert
   * @returns Promise resolving to boolean indicating whether to proceed with payment
   * @protected
   */
  protected async handleQuote(
    quote: Quote,
    prompt: Prompt
  ): Promise<boolean> {
    // Check if there's a lightning invoice
    const lightningInvoice = quote.invoices.find(
      (inv) => inv.method === "lightning"
    );

    if (!lightningInvoice || !lightningInvoice.invoice) {
      debugError("No lightning invoice found in quote");
      return false;
    }

    // Parse the invoice to get the amount
    try {
      const { amount_sats } = parseBolt11(lightningInvoice.invoice);

      // Check if the amount is within the max amount
      if (amount_sats <= this.#maxAmountSats) {
        return true;
      } else {
        debugError(
          `Invoice amount (${amount_sats}) exceeds max amount (${this.#maxAmountSats})`
        );
        return false;
      }
    } catch (error) {
      debugError("Failed to parse invoice:", error);
      return false;
    }
  }

  /**
   * Handles payment for quotes
   *
   * @param quote - Quote from expert
   * @param prompt - Prompt sent to expert
   * @returns Promise resolving to Proof object
   * @protected
   */
  protected async handlePayment(quote: Quote, prompt: Prompt): Promise<Proof> {
    // Find the lightning invoice
    const lightningInvoice = quote.invoices.find(
      (inv) => inv.method === "lightning"
    );

    if (!lightningInvoice || !lightningInvoice.invoice) {
      throw new Error("No lightning invoice found in quote");
    }

    try {
      // Pay the invoice using the payment manager
      const preimage = await (this.#paymentManager as LightningPaymentManager).payInvoice(
        lightningInvoice.invoice
      );

      // Create the proof object
      const proof: Proof = {
        method: "lightning",
        preimage,
      };

      // Call the onPaid callback if it exists
      if (this.#onPaid) {
        await this.#onPaid(prompt, quote, proof);
      }

      // Return the proof
      return proof;
    } catch (error) {
      throw new Error(
        `Payment failed: ${
          error instanceof Error ? error.message : String(error)
        }`
      );
    }
  }

  /**
   * Disposes of resources when the client is no longer needed
   */
  [Symbol.dispose](): void {
    // Dispose of the base client
    super[Symbol.dispose]();

    // Dispose of the payment manager
    this.#paymentManager[Symbol.dispose]();
  }
}