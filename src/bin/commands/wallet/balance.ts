import { Command } from "commander";
import { debugError } from "../../../common/debug.js";
import { nwc } from "@getalby/sdk";
import { getWalletByNameOrDefault } from "./utils.js";
import { WalletCommandOptions } from "./client.js";

/**
 * Options for the balance command
 */
interface BalanceOptions extends WalletCommandOptions {
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
    // Get the wallet to use
    const wallet = await getWalletByNameOrDefault(options);
    
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
  program
    .command("balance")
    .description("Check wallet balance")
    .option("--wallet <name>", "Wallet to use (default wallet if not specified)")
    .option("-r, --remote", "Use remote wallet client")
    .option("-u, --url <url>", "URL of remote wallet server (default: https://walletapi.askexperts.io)")
    .action(async (options) => {
      try {
        await executeBalanceCommand(options);
      } catch (error) {
        console.error(`Error: ${error instanceof Error ? error.message : String(error)}`);
        process.exit(1);
      }
    });
}