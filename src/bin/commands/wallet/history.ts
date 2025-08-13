import { Command } from "commander";
import { debugError } from "../../../common/debug.js";
import { nwc } from "@getalby/sdk";
import { getWalletByNameOrDefault } from "./utils.js";
import { addCommonOptions } from "./index.js";
import { createDBClientForCommands } from "../utils.js";

/**
 * Options for the history command
 */
interface HistoryOptions {
  remote?: boolean;
  url?: string;
  wallet?: string;
}

/**
 * Execute the history command
 * 
 * @param options Command line options
 * @param dbPath Path to the database file
 */
export async function executeHistoryCommand(
  options: HistoryOptions
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
      // Get transactions
      const { transactions } = await client.listTransactions({
        limit: 100,
      });
      
      console.log(`Transaction history for wallet '${wallet.name}'${wallet.default ? ' (default)' : ''}:`);
      console.log("------------------------------------------------------");
      
      if (!transactions || transactions.length === 0) {
        console.log("No transactions found");
        return;
      }
      
      // Display transactions
      transactions.forEach((tx: any, index: number) => {
        const date = tx.created_at ? new Date(tx.created_at * 1000).toLocaleString() : 'Unknown date';
        const amount = tx.amount ? Math.abs(tx.amount / 1000) : 0; // Convert msats to sats
        const fees = tx.fees_paid ? Math.abs(tx.fees_paid / 1000) : 0; // Convert msats to sats
        const type = tx.type === 'incoming' ? 'Received' : 'Sent';
        const status = tx.state || 'unknown';
        
        console.log(`[${index + 1}] ${date} | ${type}: ${amount} sats (${fees} fee) | State: ${status}`);
        
        if (tx.description) {
          console.log(`    Description: ${tx.description}`);
        }
        
        if (tx.payment_hash) {
          console.log(`    Payment Hash: ${tx.payment_hash}`);
        }
        
        if (tx.preimage) {
          console.log(`    Preimage: ${tx.preimage}`);
        }
        
        console.log("------------------------------------------------------");
      });
      
    } finally {
      // Close the client
      client.close();
    }
    
  } catch (error) {
    debugError("Failed to get transaction history:", error);
    throw error;
  }
}

/**
 * Register the history command with the CLI
 *
 * @param program The commander program
 */
export function registerHistoryCommand(program: Command): void {
  const command = program
    .command("history")
    .description("List transaction history")
    .option("--wallet <name>", "Wallet to use (default wallet if not specified)")
    .action(async (options) => {
      try {
        await executeHistoryCommand(options);
      } catch (error) {
        console.error(`Error: ${error instanceof Error ? error.message : String(error)}`);
        process.exit(1);
      }
    });
    
  // Add common options (debug, remote, url)
  addCommonOptions(command);
}