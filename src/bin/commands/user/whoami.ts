import { Command } from "commander";
import { debugError } from "../../../common/debug.js";
import { DB } from "../../../db/DB.js";
import { APP_DB_PATH } from "../../../common/constants.js";
import { getCurrentUserId } from "../../../common/users.js";
import { addCommonOptions } from "./index.js";

/**
 * Options for the whoami command
 */
interface WhoamiOptions {
  debug?: boolean;
}


/**
 * Execute the whoami command
 * 
 * @param options Command line options
 */
export async function executeWhoamiCommand(
  options: WhoamiOptions
): Promise<void> {
  try {
    // Get the current user ID
    const userId = getCurrentUserId();
    
    // Initialize the database
    const db = new DB(APP_DB_PATH);

    // Get the user
    const user = await db.getUser(userId);
    
    if (!user) {
      throw new Error(`Current user with ID ${userId} not found in database`);
    }

    console.log(`Current user:`);
    console.log(`ID: ${user.id}`);
    console.log(`Pubkey: ${user.pubkey}`);

  } catch (error) {
    debugError("Failed to get current user:", error);
    throw error;
  }
}

/**
 * Register the whoami command with the CLI
 *
 * @param program The commander program
 */
export function registerWhoamiCommand(program: Command): void {
  const command = program
    .command("whoami")
    .description("Show the current user")
    .action(async (options) => {
      try {
        await executeWhoamiCommand(options);
      } catch (error) {
        console.error(`Error: ${error instanceof Error ? error.message : String(error)}`);
        process.exit(1);
      }
    });
    
  // Add common options (debug)
  addCommonOptions(command);
}