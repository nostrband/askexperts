import { Command } from "commander";
import { debugError } from "../../../common/debug.js";
import { nwc } from "@getalby/sdk";
import { getWalletByNameOrDefault } from "./utils.js";
import { WalletCommandOptions } from "./client.js";
import { addCommonOptions } from "./index.js";

/**
 * Options for the invoice command
 */
interface InvoiceOptions extends WalletCommandOptions {
  wallet?: string;
  desc?: string;
  hash?: string;
}

/**
 * Execute the invoice command
 * 
 * @param amount The amount in satoshis
 * @param options Command line options
 * @param dbPath Path to the database file
 */
export async function executeInvoiceCommand(
  amount: string,
  options: InvoiceOptions
): Promise<void> {
  try {
    // Validate amount
    const amountSats = parseInt(amount, 10);
    if (isNaN(amountSats) || amountSats <= 0) {
      throw new Error("Amount must be a positive number");
    }
    
    // Validate description or hash
    if (!options.desc && !options.hash) {
      throw new Error("Either description (--desc) or description hash (--hash) must be provided");
    }
    
    // Get the wallet to use
    const wallet = await getWalletByNameOrDefault(options);
    
    // Create NWC client
    const client = new nwc.NWCClient({
      nostrWalletConnectUrl: wallet.nwc,
    });
    
    console.log(`Creating invoice using wallet '${wallet.name}'${wallet.default ? ' (default)' : ''}...`);
    console.log(`Amount: ${amountSats} sats`);
    
    try {
      // Create the invoice
      let description = options.desc || `Payment of ${amountSats} sats`;
      
      // Convert amount to millisatoshis
      const amountMsat = amountSats * 1000;
      
      // Create invoice options
      const invoiceOptions: any = {
        amount: amountMsat,
      };
      
      // If hash is provided, use it as description_hash
      if (options.hash) {
        invoiceOptions.description_hash = options.hash;
        console.log(`Using description hash: ${options.hash}`);
      } else {
        // Otherwise use description
        invoiceOptions.description = description;
      }
      
      // Create the invoice
      const invoiceResponse = await client.makeInvoice(invoiceOptions);
      
      const invoiceResult = {
        invoice: invoiceResponse.invoice,
        paymentHash: invoiceResponse.payment_hash,
      };
    
      console.log("Invoice created successfully!");
      console.log(`Invoice: ${invoiceResult.invoice}`);
      console.log(`Payment Hash: ${invoiceResult.paymentHash}`);
    } finally {
      // Close the client
      client.close();
    }
    
  } catch (error) {
    debugError("Failed to create invoice:", error);
    throw error;
  }
}

/**
 * Register the invoice command with the CLI
 *
 * @param program The commander program
 */
export function registerInvoiceCommand(program: Command): void {
  const command = program
    .command("invoice")
    .description("Create a lightning invoice")
    .argument("<amount_sats>", "Amount in satoshis")
    .option("--wallet <name>", "Wallet to use (default wallet if not specified)")
    .option("--desc <description>", "Invoice description")
    .option("--hash <hash>", "Description hash")
    .action(async (amount, options) => {
      try {
        await executeInvoiceCommand(amount, options);
      } catch (error) {
        console.error(`Error: ${error instanceof Error ? error.message : String(error)}`);
        process.exit(1);
      }
    });
    
  // Add common options (debug, remote, url)
  addCommonOptions(command);
}