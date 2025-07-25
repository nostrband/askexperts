import { Command } from "commander";
import { debugError } from "../../../common/debug.js";
import { getDB } from "../../../db/utils.js";

/**
 * Execute the list wallets command
 * 
 * @param dbPath Path to the database file
 */
export async function executeListWalletsCommand(): Promise<void> {
  try {
    // Get the DB instance
    const db = getDB();
    
    // Get all wallets
    const wallets = db.listWallets();
    
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
    .action(async () => {
      try {
        await executeListWalletsCommand();
      } catch (error) {
        console.error(`Error: ${error instanceof Error ? error.message : String(error)}`);
        process.exit(1);
      }
    });
}