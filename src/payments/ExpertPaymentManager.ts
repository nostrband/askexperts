import { ExpertQuote, Invoice, Proof } from "../common/types.js";

/**
 * Interface for payment managers that handle expert payments
 */
export interface ExpertPaymentManager {
  /**
   * Symbol.dispose method for resource cleanup
   */
  [Symbol.dispose](): void;
  /**
   * Creates invoices for payment
   * 
   * @param amountSats - Amount in satoshis
   * @param description - Invoice description
   * @param expirySec - Expiry time in seconds
   * @returns Promise resolving to an array of invoices
   */
  makeInvoices(amountSats: number, description: string, expirySec: number): Promise<Invoice[]>;

  /**
   * Verifies a payment
   * 
   * @param quote - The expert quote containing invoices
   * @param proof - The payment proof
   * @throws Error if verification fails
   */
  verifyPayment(quote: ExpertQuote, proof: Proof): Promise<void>;
}