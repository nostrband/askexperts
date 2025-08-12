import { Command } from "commander";
import { debugError } from "../../../common/debug.js";
import { nwc } from "@getalby/sdk";
import { parseBolt11 } from "../../../common/bolt11.js";
import { getWalletByNameOrDefault } from "./utils.js";
import { WalletCommandOptions } from "./client.js";

/**
 * Options for the pay command
 */
interface PayOptions extends WalletCommandOptions {
  wallet?: string;
  amount?: string;
}

/**
 * Execute the pay command
 * 
 * @param invoice The invoice to pay
 * @param options Command line options
 * @param dbPath Path to the database file
 */
export async function executePayCommand(
  invoice: string,
  options: PayOptions
): Promise<void> {
  try {
    // Validate invoice
    if (!invoice) {
      throw new Error("Invoice is required");
    }
    
    // Get the wallet to use
    const wallet = await getWalletByNameOrDefault(options);
    
    // Parse the invoice to get amount
    let amount: number | undefined;
    try {
      const parsedInvoice = parseBolt11(invoice);
      amount = parsedInvoice.amount_sats;
    } catch (error) {
      throw new Error(`Invalid invoice: ${error instanceof Error ? error.message : String(error)}`);
    }
    
    // Check if amount is specified in the invoice or options
    if (!amount && !options.amount) {
      throw new Error("Invoice does not specify an amount. Please provide an amount with --amount.");
    }
    
    // If amount is specified in options, use that
    if (options.amount) {
      const parsedAmount = parseInt(options.amount, 10);
      if (isNaN(parsedAmount) || parsedAmount <= 0) {
        throw new Error("Amount must be a positive number");
      }
      amount = parsedAmount;
    }
    
    // Create NWC client
    const client = new nwc.NWCClient({
      nostrWalletConnectUrl: wallet.nwc,
    });
    
    console.log(`Paying invoice using wallet '${wallet.name}'${wallet.default ? ' (default)' : ''}...`);
    console.log(`Amount: ${amount} sats`);
    
    try {
      const req: any = {
        invoice,
      };
      // Override invoice amount
      if (options.amount) req.amount = amount * 1000;

      // Pay the invoice
      const paymentResult = await client.payInvoice(req);
      
      const preimage = paymentResult.preimage;
    
      console.log("Payment successful!");
      console.log(`Preimage: ${preimage}`);
    } finally {
      // Close the client
      client.close();
    }
    
  } catch (error) {
    debugError("Failed to pay invoice:", error);
    throw error;
  }
}

/**
 * Register the pay command with the CLI
 *
 * @param program The commander program
 */
export function registerPayCommand(program: Command): void {
  program
    .command("pay")
    .description("Pay a lightning invoice")
    .argument("<invoice>", "Lightning invoice to pay")
    .option("--wallet <name>", "Wallet to use (default wallet if not specified)")
    .option("--amount <sats>", "Amount to pay in satoshis (required for zero-amount invoices)")
    .option("-r, --remote", "Use remote wallet client")
    .option("-u, --url <url>", "URL of remote wallet server (default: https://walletapi.askexperts.io)")
    .action(async (invoice, options) => {
      try {
        await executePayCommand(invoice, options);
      } catch (error) {
        console.error(`Error: ${error instanceof Error ? error.message : String(error)}`);
        process.exit(1);
      }
    });
}