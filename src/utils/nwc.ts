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

  // Process bids in batches to limit parallel payments
  for (let i = 0; i < bids.length; i += MAX_PARALLEL_PAYMENTS) {
    const batch = bids.slice(i, i + MAX_PARALLEL_PAYMENTS);
    
    // Process each batch in parallel
    const batchResults = await Promise.all(
      batch.map(async (bid) => {
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
      })
    );
    
    // Add batch results to overall results
    results.push(...batchResults);
  }
  
  return results;
}