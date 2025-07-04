import { nwc } from "@getalby/sdk";
import * as bolt11 from "bolt11";
import { ExpertSessionWithContext } from "../AskExpertsMCP.js";

/**
 * Parses a BOLT11 invoice and extracts bid amount and payment hash
 *
 * @param invoice - The BOLT11 invoice string to parse
 * @returns Object containing bid_sats and payment_hash
 * @throws Error if decoding fails or if either output field is empty
 */
export function parseBolt11(invoice: string): { bid_sats: number; payment_hash: string } {
  try {
    const decodedInvoice = bolt11.decode(invoice);
    const bidAmount = decodedInvoice.satoshis || 0;
    const paymentHash = decodedInvoice.tagsObject.payment_hash || '';

    if (!bidAmount) {
      throw new Error("Bad invoice with 0 amount");
    }

    if (!paymentHash) {
      throw new Error("Bad invoice without payment_hash");
    }

    return {
      bid_sats: bidAmount,
      payment_hash: paymentHash
    };
  } catch (error) {
    throw new Error(`Failed to parse invoice: ${error instanceof Error ? error.message : String(error)}`);
  }
}

// Maximum number of parallel payments
export const MAX_PARALLEL_PAYMENTS = 5;

/**
 * Interface for payment result
 */
interface PaymentResult {
  expert: ExpertSessionWithContext;
  preimage: string;
  success: boolean;
  error?: string;
}

/**
 * Pays invoices for expert sessions without preimages using NWC
 * @param experts Array of experts without preimages
 * @param nwcConnectionString NWC connection string
 * @returns Array of payment results with preimages
 */
export async function payExperts(
  experts: ExpertSessionWithContext[],
  nwcConnectionString: string
): Promise<PaymentResult[]> {
  // Create NWC client
  const nwcClient = new nwc.NWCClient({
    nostrWalletConnectUrl: nwcConnectionString,
  });

  // Results array
  const results: PaymentResult[] = [];

  // If no bids, return empty results
  if (experts.length === 0) {
    return results;
  }

  // Create a queue of bids to process
  const queue = [...experts];

  // Function to process a single payment
  async function processPayment(
    expert: ExpertSessionWithContext
  ): Promise<PaymentResult> {
    try {
      // Pay the invoice
      const paymentResult = await nwcClient.payInvoice({
        invoice: expert.context.invoice,
      });

      // Return the payment result with preimage
      return {
        expert,
        preimage: paymentResult.preimage,
        success: true,
      };
    } catch (error) {
      console.error("Failed to pay invoice", error);
      // Return error result
      return {
        expert,
        preimage: "",
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  // Create a pool to track active payments
  const activePayments: { promise: Promise<PaymentResult>; index: number }[] =
    [];
  let nextIndex = 0;

  // Process payments maintaining MAX_PARALLEL_PAYMENTS concurrency
  return new Promise((resolve) => {
    // Function to start a new payment from the queue
    function startNextPayment() {
      // If queue is empty and no active payments, we're done
      if (queue.length === 0 && activePayments.length === 0) {
        resolve(results);
        return;
      }

      // If queue has items and we have room for more parallel payments
      if (queue.length > 0 && activePayments.length < MAX_PARALLEL_PAYMENTS) {
        const bid = queue.shift()!;
        const currentIndex = nextIndex++;

        // Create the payment promise
        const paymentPromise = processPayment(bid);

        // Track the promise with its index
        activePayments.push({
          promise: paymentPromise,
          index: currentIndex,
        });

        // Handle promise completion
        paymentPromise
          .then((result) => {
            // Add result to results array
            results.push(result);

            // Remove this payment from active payments
            const indexInArray = activePayments.findIndex(
              (p) => p.index === currentIndex
            );
            if (indexInArray !== -1) {
              activePayments.splice(indexInArray, 1);
            }

            // Start next payment
            startNextPayment();
          })
          .catch((error) => {
            console.assert(false, "Payment promise assert failure:", error);
          });

        // If we can start more payments, do so
        if (activePayments.length < MAX_PARALLEL_PAYMENTS && queue.length > 0) {
          startNextPayment();
        }
      }
    }

    // Start the first payment
    startNextPayment();
  });
}
