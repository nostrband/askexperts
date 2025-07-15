import { nwc } from "@getalby/sdk";
import { DEFAULT_MAX_PARALLEL_PAYMENTS } from "../common/constants.js";

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
  constructor(nwcString: string, maxParallelPayments: number = DEFAULT_MAX_PARALLEL_PAYMENTS) {
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
    if (this.paymentQueue.length > 0 && this.activePayments < this.maxParallelPayments) {
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
}