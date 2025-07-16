import * as bolt11 from "bolt11";

/**
 * Parses a BOLT11 invoice and extracts bid amount and payment hash
 *
 * @param invoice - The BOLT11 invoice string to parse
 * @returns Object containing amount_sats and payment_hash
 * @throws Error if decoding fails or if either output field is empty
 */
export function parseBolt11(invoice: string): { amount_sats: number; payment_hash: string } {
  try {
    const decodedInvoice = bolt11.decode(invoice);
    const amountSats = decodedInvoice.satoshis || 0;
    const paymentHash = decodedInvoice.tagsObject.payment_hash || '';

    if (!amountSats) {
      throw new Error("Bad invoice with 0 amount");
    }

    if (!paymentHash) {
      throw new Error("Bad invoice without payment_hash");
    }

    return {
      amount_sats: amountSats,
      payment_hash: paymentHash
    };
  } catch (error) {
    throw new Error(`Failed to parse invoice: ${error instanceof Error ? error.message : String(error)}`);
  }
}
