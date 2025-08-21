import { decode } from "light-bolt11-decoder";

/**
 * Parses a BOLT11 invoice and extracts bid amount and payment hash
 *
 * @param invoice - The BOLT11 invoice string to parse
 * @returns Object containing amount_sats and payment_hash
 * @throws Error if decoding fails or if either output field is empty
 */
export function parseBolt11(invoice: string): {
  amount_sats: number;
  payment_hash: string;
} {
  try {
    const decodedInvoice = decode(invoice);
    const amountSats = Math.floor(
      parseInt(
        decodedInvoice.sections.find((s) => s.name === "amount")?.value || "0"
      ) / 1000
    );
    const paymentHash =
      decodedInvoice.sections.find((s) => s.name === "payment_hash")?.value ||
      "";

    if (!amountSats) {
      throw new Error("Bad invoice with 0 amount");
    }

    if (!paymentHash) {
      throw new Error("Bad invoice without payment_hash");
    }

    return {
      amount_sats: amountSats,
      payment_hash: paymentHash,
    };
  } catch (error) {
    throw new Error(
      `Failed to parse invoice: ${
        error instanceof Error ? error.message : String(error)
      }`
    );
  }
}
