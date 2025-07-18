import { nwc } from "@getalby/sdk";
import { DEFAULT_MAX_PARALLEL_PAYMENTS } from "../common/constants.js";
import { sha256 } from "@noble/hashes/sha2";
import { bytesToHex, hexToBytes } from "@noble/hashes/utils";
import { parseBolt11 } from "../common/bolt11.js";

/**
 * LightningPaymentManager handles lightning payments using NWC
 * with a limit on parallel payment operations
 */
export class LightningPaymentManager {
  private nwcClient: nwc.NWCClient;
  private maxParallelPayments: number;
  private activePayments: number = 0;
  private paymentQueue: Array<() => Promise<void>> = [];

  /**
   * Creates a new LightningPaymentManager
   *
   * @param nwcString - NWC connection string
   * @param maxParallelPayments - Maximum number of parallel payments (default: 5)
   */
  constructor(
    nwcString: string,
    maxParallelPayments: number = DEFAULT_MAX_PARALLEL_PAYMENTS
  ) {
    if (!nwcString) {
      throw new Error("NWC connection string is required");
    }

    this.nwcClient = new nwc.NWCClient({
      nostrWalletConnectUrl: nwcString,
    });

    this.maxParallelPayments = maxParallelPayments;
  }

  /**
   * Pays a lightning invoice
   *
   * @param invoice - Lightning invoice to pay
   * @returns Promise resolving to payment preimage
   */
  async payInvoice(invoice: string): Promise<string> {
    // Create a promise that will be resolved when the payment is processed
    return new Promise<string>((resolve, reject) => {
      // Create a function to process the payment
      const processPayment = async () => {
        this.activePayments++;

        try {
          // Pay the invoice
          const paymentResult = await this.nwcClient.payInvoice({
            invoice,
          });

          // Resolve with the preimage
          resolve(paymentResult.preimage);
        } catch (error) {
          // Reject with the error
          reject(error instanceof Error ? error : new Error(String(error)));
        } finally {
          // Decrement the active payments counter
          this.activePayments--;

          // Process the next payment in the queue if any
          this.processNextPayment();
        }
      };

      // If we can process the payment immediately, do so
      if (this.activePayments < this.maxParallelPayments) {
        processPayment();
      } else {
        // Otherwise, add it to the queue
        this.paymentQueue.push(processPayment);
      }
    });
  }

  /**
   * Processes the next payment in the queue if any
   * @private
   */
  private processNextPayment(): void {
    if (
      this.paymentQueue.length > 0 &&
      this.activePayments < this.maxParallelPayments
    ) {
      const nextPayment = this.paymentQueue.shift();
      if (nextPayment) {
        nextPayment();
      }
    }
  }

  /**
   * Disposes of resources when the manager is no longer needed
   */
  [Symbol.dispose](): void {
    // Close the NWC client
    this.nwcClient.close();
  }

  /**
   * Creates a lightning invoice
   *
   * @param amount - Amount in satoshis
   * @param description - Invoice description
   * @param expiry - Expiry time in seconds (optional)
   * @returns Promise resolving to an object containing the invoice and payment hash
   */
  async makeInvoice(
    amount: number,
    description: string,
    expiry?: number
  ): Promise<{ invoice: string; paymentHash: string }> {
    // Convert amount to millisatoshis
    const amountMsat = amount * 1000;

    // Create invoice options
    const invoiceOptions: nwc.MakeInvoiceArgs = {
      amount: amountMsat,
      description,
    };

    // Add expiry if provided
    if (expiry) {
      invoiceOptions.expiry = expiry;
    }

    // Create the invoice
    const invoiceResponse = await this.nwcClient.makeInvoice(invoiceOptions);

    return {
      invoice: invoiceResponse.invoice,
      paymentHash: invoiceResponse.payment_hash,
    };
  }

  /**
   * Verifies a payment using the preimage
   *
   * @param paymentHash - Payment hash to verify
   * @param preimage - Payment preimage
   * @throws Error if verification fails
   */
  async verifyPayment({
    invoice,
    payment_hash,
    preimage,
  }: {
    invoice?: string;
    payment_hash?: string;
    preimage: string;
  }): Promise<void> {
    if (!invoice && !payment_hash)
      throw new Error("Either invoice or paymentHash must be provided");

    if (!payment_hash) {
      payment_hash = parseBolt11(invoice!).payment_hash;
    }

    // Verify that sha256(preimage) === paymentHash
    const preimageBytes = hexToBytes(preimage);
    const calculatedHash = bytesToHex(sha256(preimageBytes));

    if (calculatedHash !== payment_hash) {
      throw new Error("Invalid preimage: hash does not match payment hash");
    }

    // Lookup the invoice to verify it's settled
    const tx = await this.nwcClient.lookupInvoice({
      payment_hash,
    });
    if (!tx) {
      throw new Error("Invoice not found");
    }

    if (!tx.settled_at || tx.settled_at === 0) {
      throw new Error("Invoice not settled");
    }
  }
}
