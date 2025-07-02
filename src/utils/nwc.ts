import { nwc } from '@getalby/sdk';
import { BidStructure } from '../tools/askExperts.js';

// Maximum number of parallel payments
export const MAX_PARALLEL_PAYMENTS = 5;

/**
 * Interface for a bid with invoice
 */
interface BidWithInvoice extends BidStructure {
  invoice: string;
}

/**
 * Interface for payment result
 */
interface PaymentResult {
  bid: BidStructure;
  preimage: string;
  success: boolean;
  error?: string;
}

/**
 * Pays invoices for bids without preimages using NWC
 * @param bids Array of bids without preimages
 * @param nwcConnectionString NWC connection string
 * @returns Array of payment results with preimages
 */
export async function payExperts(
  bids: BidWithInvoice[],
  nwcConnectionString: string
): Promise<PaymentResult[]> {
  // Create NWC client
  const nwcClient = new nwc.NWCClient({
    nostrWalletConnectUrl: nwcConnectionString,
  });

  // Results array
  const results: PaymentResult[] = [];
  
  // If no bids, return empty results
  if (bids.length === 0) {
    return results;
  }

  // Create a queue of bids to process
  const queue = [...bids];
  
  // Function to process a single payment
  async function processPayment(bid: BidWithInvoice): Promise<PaymentResult> {
    try {
      // Pay the invoice
      const paymentResult = await nwcClient.payInvoice({
        invoice: bid.invoice,
      });
      
      // Return the payment result with preimage
      return {
        bid,
        preimage: paymentResult.preimage,
        success: true
      };
    } catch (error) {
      // Return error result
      return {
        bid,
        preimage: '',
        success: false,
        error: error instanceof Error ? error.message : String(error)
      };
    }
  }

  // Create a pool of promises to track active payments
  const activePayments: Promise<void>[] = [];
  
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
        
        // Create and track the payment promise
        const paymentPromise = processPayment(bid).then((result) => {
          // Add result to results array
          results.push(result);
          
          // Remove this payment from active payments
          const index = activePayments.indexOf(paymentPromise);
          if (index !== -1) {
            activePayments.splice(index, 1);
          }
          
          // Start next payment
          startNextPayment();
        });
        
        // Add to active payments
        activePayments.push(paymentPromise);
        
        // If we can start more payments, do so
        if (activePayments.length < MAX_PARALLEL_PAYMENTS && queue.length > 0) {
          startNextPayment();
        }
      }
    }
    
    // Start initial batch of payments
    for (let i = 0; i < Math.min(MAX_PARALLEL_PAYMENTS, queue.length); i++) {
      startNextPayment();
    }
  });
}