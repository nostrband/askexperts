import { Command } from "commander";
import { debugError } from "../../../common/debug.js";
import { addCommonOptions } from "./index.js";
import { createDBClientForCommands } from "../utils.js";

interface WalletCommandOptions {
  remote?: boolean;
  url?: string;
}

/**
 * Execute the list wallets command
 *
 * @param options Command options
 */
export async function executeListWalletsCommand(options: WalletCommandOptions = {}): Promise<void> {
  try {
    // Get the wallet client instance
    const db = await createDBClientForCommands(options);
    
    // Get all wallets
    const wallets = await db.listWallets();
    
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
  const command = program
    .command("list")
    .description("List all wallets")
    .action(async (options) => {
      try {
        await executeListWalletsCommand(options);
      } catch (error) {
        console.error(`Error: ${error instanceof Error ? error.message : String(error)}`);
        process.exit(1);
      }
    });
    
  // Add common options (debug, remote, url)
  addCommonOptions(command);
}