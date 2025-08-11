import { Command } from "commander";
import { debugError } from "../../../common/debug.js";
import { RemoteClient } from "../../../remote/RemoteClient.js";

/**
 * Execute the invoice command
 * 
 * @param amount The amount in satoshis
 */
export async function executeInvoiceCommand(amount: number): Promise<void> {
  try {
    // Create a new RemoteClient instance
    const client = new RemoteClient();
    
    // Call the invoice method
    await client.invoice(amount);
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
  program
    .command("invoice")
    .description("Create a new invoice on askexperts.io remote service")
    .argument("<amount>", "Amount in satoshis")
    .action(async (amountStr) => {
      try {
        const amount = parseInt(amountStr, 10);
        if (isNaN(amount) || amount <= 0) {
          console.error("Error: Amount must be a positive number");
          process.exit(1);
        }
        
        await executeInvoiceCommand(amount);
      } catch (error) {
        console.error(`Error: ${error instanceof Error ? error.message : String(error)}`);
        process.exit(1);
      }
    });
}