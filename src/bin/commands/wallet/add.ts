import { Command } from "commander";
import { debugError } from "../../../common/debug.js";
import { addCommonOptions } from "./index.js";
import { getCurrentUserId } from "../../../common/users.js";
import { createDBClientForCommands } from "../utils.js";

/**
 * Options for the add wallet command
 */
interface AddWalletOptions {
  remote?: boolean;
  url?: string;
  nwc: string;
  default?: boolean;
}

/**
 * Execute the add wallet command
 * 
 * @param name The name of the wallet to add
 * @param options Command line options
 * @param dbPath Path to the database file
 */
export async function executeAddWalletCommand(
  name: string,
  options: AddWalletOptions
): Promise<void> {
  try {
    // Validate inputs
    if (!name) {
      throw new Error("Wallet name is required");
    }
    
    if (!options.nwc) {
      throw new Error("NWC connection string is required. Use -n or --nwc option.");
    }

    // Get the wallet client instance
    const db = await createDBClientForCommands(options);
    
    // Check if wallet with this name already exists
    const existingWallet = await db.getWalletByName(name);
    if (existingWallet) {
      throw new Error(`Wallet with name '${name}' already exists`);
    }
    
    // Add the wallet to the database
    const walletId = await db.insertWallet({
      user_id: getCurrentUserId(),
      name,
      nwc: options.nwc,
      default: options.default || false
    });
    
    console.log(`Wallet '${name}' added successfully with ID ${walletId}`);
    
    // If marked as default, inform the user
    if (options.default) {
      console.log(`Wallet '${name}' is now the default wallet`);
    }
    
  } catch (error) {
    debugError("Failed to add wallet:", error);
    throw error;
  }
}

/**
 * Register the add wallet command with the CLI
 *
 * @param program The commander program
 */
export function registerAddCommand(program: Command): void {
  const command = program
    .command("add")
    .description("Add a new wallet with an existing NWC connection string")
    .argument("<name>", "Name of the wallet")
    .requiredOption("-n, --nwc <string>", "NWC connection string")
    .option("--default", "Set this wallet as the default")
    .action(async (name, options) => {
      try {
        await executeAddWalletCommand(name, options);
      } catch (error) {
        console.error(`Error: ${error instanceof Error ? error.message : String(error)}`);
        process.exit(1);
      }
    });
    
  // Add common options (debug, remote, url)
  addCommonOptions(command);
}