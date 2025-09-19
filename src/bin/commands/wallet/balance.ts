import { Command } from "commander";
import { debugError } from "../../../common/debug.js";
import { nwc } from "@getalby/sdk";
import { getWalletByNameOrDefault } from "./utils.js";
import { addCommonOptions } from "./index.js";
import { createDBClientForCommands } from "../utils.js";

/**
 * Options for the balance command
 */
interface BalanceOptions {
  remote?: boolean;
  url?: string;
  wallet?: string;
}

/**
 * Execute the balance command
 *
 * @param options Command line options
 */
export async function executeBalanceCommand(
  options: BalanceOptions
): Promise<void> {
  try {
    const db = await createDBClientForCommands(options);

    // Get the wallet to use
    const wallet = await getWalletByNameOrDefault(db, options.wallet);
    
    // Create NWC client
    const client = new nwc.NWCClient({
      nostrWalletConnectUrl: wallet.nwc,
    });
    
    try {
      // Get balance
      const { balance } = await client.getBalance();

      // Display balance
      console.log(`Wallet: ${wallet.name}${wallet.default ? ' (default)' : ''}`);
      console.log(`Balance: ${Math.floor(balance / 1000)} sats`); // ms to sats
    } finally {
      // Close the client
      client.close();
    }
    
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
  const command = program
    .command("balance")
    .description("Check wallet balance")
    .option("--wallet <name>", "Wallet to use (default wallet if not specified)")
    .action(async (options) => {
      try {
        await executeBalanceCommand(options);
      } catch (error) {
        console.error(`Error: ${error instanceof Error ? error.message : String(error)}`);
        process.exit(1);
      }
    });
    
  // Add common options (debug, remote, url)
  addCommonOptions(command);
}