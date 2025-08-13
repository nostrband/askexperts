import { Command } from "commander";
import { debugError, enableAllDebug, enableErrorDebug } from "../../../common/debug.js";
import readline from "readline";
import { ExpertCommandOptions, addRemoteOptions } from "./index.js";
import { createDBClientForCommands } from "../utils.js";

/**
 * Options for the delete expert command
 */
interface DeleteExpertCommandOptions extends ExpertCommandOptions {
  yes?: boolean;
  debug?: boolean;
}

/**
 * Create a readline interface for user input
 */
function createReadlineInterface() {
  return readline.createInterface({
    input: process.stdin,
    output: process.stdout
  });
}

/**
 * Delete an expert from the database
 * 
 * @param pubkey Public key of the expert to delete
 * @param options Command options
 */
export async function deleteExpert(
  pubkey: string,
  options: DeleteExpertCommandOptions
): Promise<void> {
  try {
    if (options.debug) enableAllDebug();
    else enableErrorDebug();

    // Get expert client
    const db = await createDBClientForCommands(options);
    
    // Get the expert
    const expert = await db.getExpert(pubkey);
    if (!expert) {
      throw new Error(`Expert with pubkey ${pubkey} not found`);
    }

    // If -y/--yes is not provided, ask for confirmation
    if (!options.yes) {
      const rl = createReadlineInterface();
      
      console.log(`About to delete expert:`);
      console.log(`  Pubkey: ${expert.pubkey}`);
      console.log(`  Type: ${expert.type}`);
      console.log(`  Nickname: ${expert.nickname}`);
      
      const answer = await new Promise<string>((resolve) => {
        rl.question('Are you sure you want to delete this expert? (y/N): ', resolve);
      });
      
      rl.close();
      
      if (answer.toLowerCase() !== 'y' && answer.toLowerCase() !== 'yes') {
        console.log('Deletion cancelled.');
        return;
      }
    }

    // Delete expert from database
    const success = await db.deleteExpert(pubkey);
    if (!success) {
      throw new Error("Failed to delete expert from database");
    }

    console.log(`Expert with pubkey ${pubkey} deleted successfully.`);

  } catch (error) {
    debugError("Error deleting expert:", error);
    throw error;
  }
}

/**
 * Register the delete expert command with the CLI
 *
 * @param program The commander program or parent command
 */
export function registerDeleteCommand(program: Command): void {
  const command = program
    .command("delete")
    .description("Delete an expert from the database")
    .argument("<pubkey>", "Public key of the expert to delete")
    .option("-y, --yes", "Skip confirmation prompt")
    .option("-d, --debug", "Enable debug logging")
    .action(async (pubkey, options: DeleteExpertCommandOptions) => {
      try {
        await deleteExpert(pubkey, options);
      } catch (error) {
        debugError("Error deleting expert:", error);
        process.exit(1);
      }
    });
    
  // Add remote options
  addRemoteOptions(command);
}