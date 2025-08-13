import { Command } from "commander";
import { debugError } from "../../../common/debug.js";
import { WalletCommandOptions, createWalletClient } from "./client.js";
import { addCommonOptions } from "./index.js";

/**
 * Options for the update wallet command
 */
interface UpdateWalletOptions extends WalletCommandOptions {
  nwc?: string;
  default?: boolean;
}

/**
 * Execute the update wallet command
 * 
 * @param name The name of the wallet to update
 * @param options Command line options
 * @param dbPath Path to the database file
 */
export async function executeUpdateWalletCommand(
  name: string,
  options: UpdateWalletOptions
): Promise<void> {
  try {
    // Validate inputs
    if (!name) {
      throw new Error("Wallet name is required");
    }
    
    // Get the wallet client instance
    const walletClient = createWalletClient(options);
    
    // Check if wallet with this name exists
    const existingWallet = await walletClient.getWalletByName(name);
    if (!existingWallet) {
      throw new Error(`Wallet with name '${name}' does not exist`);
    }
    
    // Update the wallet
    const updatedWallet = {
      ...existingWallet,
      nwc: options.nwc || existingWallet.nwc,
      default: options.default !== undefined ? options.default : existingWallet.default
    };
    
    // Save the updated wallet
    const success = await walletClient.updateWallet(updatedWallet);
    
    if (success) {
      console.log(`Wallet '${name}' updated successfully`);
      
      // If NWC string was updated, inform the user
      if (options.nwc) {
        console.log(`NWC connection string updated`);
      }
      
      // If default status was updated, inform the user
      if (options.default) {
        console.log(`Wallet '${name}' is now the default wallet`);
      }
    } else {
      throw new Error(`Failed to update wallet '${name}'`);
    }
    
  } catch (error) {
    debugError("Failed to update wallet:", error);
    throw error;
  }
}

/**
 * Register the update wallet command with the CLI
 *
 * @param program The commander program
 */
export function registerUpdateCommand(program: Command): void {
  const command = program
    .command("update")
    .description("Update an existing wallet")
    .argument("<name>", "Name of the wallet to update")
    .option("-n, --nwc <string>", "New NWC connection string")
    .option("--default", "Set this wallet as the default")
    .action(async (name, options) => {
      try {
        await executeUpdateWalletCommand(name, options);
      } catch (error) {
        console.error(`Error: ${error instanceof Error ? error.message : String(error)}`);
        process.exit(1);
      }
    });
    
  // Add common options (debug, remote, url)
  addCommonOptions(command);
}