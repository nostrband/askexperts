import { Command } from "commander";
import { debugError } from "../../../common/debug.js";
import { RemoteClient } from "../../../remote/RemoteClient.js";

/**
 * Execute the pay command
 * 
 * @param invoice The invoice to pay
 */
export async function executePayCommand(invoice: string): Promise<void> {
  try {
    // Create a new RemoteClient instance
    const client = new RemoteClient();
    
    // Call the pay method
    await client.pay(invoice);
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
    .description("Pay an invoice using askexperts.io remote service")
    .argument("<invoice>", "Lightning invoice to pay")
    .action(async (invoice) => {
      try {
        if (!invoice || typeof invoice !== 'string') {
          console.error("Error: Invoice must be a valid string");
          process.exit(1);
        }
        
        await executePayCommand(invoice);
      } catch (error) {
        console.error(`Error: ${error instanceof Error ? error.message : String(error)}`);
        process.exit(1);
      }
    });
}