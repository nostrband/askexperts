import { Command } from "commander";
import { debugError } from "../../../common/debug.js";
import { WalletCommandOptions, createWalletClient } from "./client.js";

/**
 * Execute the list wallets command
 *
 * @param options Command options
 */
export async function executeListWalletsCommand(options: WalletCommandOptions = {}): Promise<void> {
  try {
    // Get the wallet client instance
    const walletClient = createWalletClient(options);
    
    // Get all wallets
    const wallets = await walletClient.listWallets();
    
    if (wallets.length === 0) {
      console.log("No wallets found");
      return;
    }
    
    // Display wallets
    console.log("Wallets:");
    console.log("--------");
    
    wallets.forEach(wallet => {
      const defaultMark = wallet.default ? "* " : "  ";
      console.log(`${defaultMark}${wallet.name}`);
    });
    
    console.log("\n* = default wallet");
    
  } catch (error) {
    debugError("Failed to list wallets:", error);
    throw error;
  }
}

/**
 * Register the list wallets command with the CLI
 *
 * @param program The commander program
 */
export function registerListCommand(program: Command): void {
  program
    .command("list")
    .description("List all wallets")
    .option("-r, --remote", "Use remote wallet client")
    .option("-u, --url <url>", "URL of remote wallet server (default: https://walletapi.askexperts.io)")
    .action(async (options) => {
      try {
        await executeListWalletsCommand(options);
      } catch (error) {
        console.error(`Error: ${error instanceof Error ? error.message : String(error)}`);
        process.exit(1);
      }
    });
}