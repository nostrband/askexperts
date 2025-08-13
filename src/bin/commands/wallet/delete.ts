import { Command } from "commander";
import { debugError } from "../../../common/debug.js";
import readline from "readline";
import { addCommonOptions } from "./index.js";
import { createDBClientForCommands } from "../utils.js";

/**
 * Options for the delete wallet command
 */
interface DeleteWalletOptions {
  remote?: boolean;
  url?: string;
  yes?: boolean;
}

/**
 * Execute the delete wallet command
 * 
 * @param name The name of the wallet to delete
 * @param options Command line options
 * @param dbPath Path to the database file
 */
export async function executeDeleteWalletCommand(
  name: string,
  options: DeleteWalletOptions
): Promise<void> {
  try {
    // Validate inputs
    if (!name) {
      throw new Error("Wallet name is required");
    }
    
    // Get the wallet client instance
    const db = await createDBClientForCommands(options);
    
    // Check if wallet with this name exists
    const existingWallet = await db.getWalletByName(name);
    if (!existingWallet) {
      throw new Error(`Wallet with name '${name}' does not exist`);
    }
    
    // If -y flag is not provided, confirm with the user
    if (!options.yes) {
      const rl = readline.createInterface({
        input: process.stdin,
        output: process.stdout
      });
      
      const answer = await new Promise<string>((resolve) => {
        rl.question(`Are you sure you want to delete wallet '${name}'? (y/N) `, resolve);
      });
      
      rl.close();
      
      if (answer.toLowerCase() !== 'y' && answer.toLowerCase() !== 'yes') {
        console.log("Deletion cancelled");
        return;
      }
    }
    
    // Delete the wallet
    try {
      const success = await db.deleteWallet(existingWallet.id);
      
      if (success) {
        console.log(`Wallet '${name}' deleted successfully`);
      } else {
        throw new Error(`Failed to delete wallet '${name}'`);
      }
    } catch (error) {
      if (error instanceof Error && error.message.includes("used by")) {
        console.error(`Cannot delete wallet '${name}' because it is used by experts. Please update or delete those experts first.`);
        process.exit(1);
      } else {
        throw error;
      }
    }
    
  } catch (error) {
    debugError("Failed to delete wallet:", error);
    throw error;
  }
}

/**
 * Register the delete wallet command with the CLI
 *
 * @param program The commander program
 */
export function registerDeleteCommand(program: Command): void {
  const command = program
    .command("delete")
    .description("Delete an existing wallet")
    .argument("<name>", "Name of the wallet to delete")
    .option("-y, --yes", "Skip confirmation prompt")
    .action(async (name, options) => {
      try {
        await executeDeleteWalletCommand(name, options);
      } catch (error) {
        console.error(`Error: ${error instanceof Error ? error.message : String(error)}`);
        process.exit(1);
      }
    });
    
  // Add common options (debug, remote, url)
  addCommonOptions(command);
}