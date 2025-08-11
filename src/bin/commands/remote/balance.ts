import { Command } from "commander";
import { debugError } from "../../../common/debug.js";
import { RemoteClient } from "../../../remote/RemoteClient.js";

/**
 * Execute the balance command
 */
export async function executeBalanceCommand(): Promise<void> {
  try {
    // Create a new RemoteClient instance
    const client = new RemoteClient();
    
    // Call the balance method
    await client.balance();
  } catch (error) {
    debugError("Failed to get balance:", error);
    throw error;
  }
}

/**
 * Register the balance command with the CLI
 *
 * @param program The commander program
 */
export function registerBalanceCommand(program: Command): void {
  program
    .command("balance")
    .description("Check your balance on askexperts.io remote service")
    .action(async () => {
      try {
        await executeBalanceCommand();
      } catch (error) {
        console.error(`Error: ${error instanceof Error ? error.message : String(error)}`);
        process.exit(1);
      }
    });
}