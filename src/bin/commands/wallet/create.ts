import { Command } from "commander";
import { debugError } from "../../../common/debug.js";
import { createWallet } from "nwc-enclaved-utils";
import { getDB } from "../../../db/utils.js";

/**
 * Options for the create wallet command
 */
interface CreateWalletOptions {
  default?: boolean;
}

/**
 * Execute the create wallet command
 * 
 * @param name The name of the wallet to create
 * @param options Command line options
 * @param dbPath Path to the database file
 */
export async function executeCreateWalletCommand(
  name: string,
  options: CreateWalletOptions
): Promise<void> {
  try {
    // Validate inputs
    if (!name) {
      throw new Error("Wallet name is required");
    }
    
    // Get the DB instance
    const db = getDB();
    
    // Check if wallet with this name already exists
    const existingWallet = db.getWalletByName(name);
    if (existingWallet) {
      throw new Error(`Wallet with name '${name}' already exists`);
    }
    
    // Create a new NWC wallet
    console.log("Creating new NWC wallet...");
    const wallet = await createWallet();
    const nwcString = wallet.nwcString;
    
    // Add the wallet to the database
    const walletId = db.insertWallet({
      name,
      nwc: nwcString,
      default: options.default || false
    });
    
    console.log(`Wallet '${name}' created successfully with ID ${walletId}`);
    console.log(`NWC connection string: ${nwcString}`);
    
    // If marked as default, inform the user
    if (options.default) {
      console.log(`Wallet '${name}' is now the default wallet`);
    }
    
  } catch (error) {
    debugError("Failed to create wallet:", error);
    throw error;
  }
}

/**
 * Register the create wallet command with the CLI
 *
 * @param program The commander program
 */
export function registerCreateCommand(program: Command): void {
  program
    .command("create")
    .description("Create a new NWC wallet")
    .argument("<name>", "Name of the wallet")
    .option("--default", "Set this wallet as the default")
    .action(async (name, options) => {
      try {
        await executeCreateWalletCommand(name, options);
      } catch (error) {
        console.error(`Error: ${error instanceof Error ? error.message : String(error)}`);
        process.exit(1);
      }
    });
}