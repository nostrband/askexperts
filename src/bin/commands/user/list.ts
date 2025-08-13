import { Command } from "commander";
import { debugError } from "../../../common/debug.js";
import { DB } from "../../../db/DB.js";
import { APP_DB_PATH } from "../../../common/constants.js";
import { addCommonOptions } from "./index.js";

/**
 * Options for the list users command
 */
interface ListUsersOptions {
  debug?: boolean;
}

/**
 * Execute the list users command
 * 
 * @param options Command line options
 */
export async function executeListUsersCommand(
  options: ListUsersOptions
): Promise<void> {
  try {
    // Initialize the database
    const db = new DB(APP_DB_PATH);

    // Get all users
    const users = await db.listUsers();

    if (users.length === 0) {
      console.log("No users found.");
      return;
    }

    console.log(`Found ${users.length} user(s):`);
    
    // Print user ID and pubkey for each user
    users.forEach(user => {
      console.log(`ID: ${user.id}, Pubkey: ${user.pubkey}`);
    });

  } catch (error) {
    debugError("Failed to list users:", error);
    throw error;
  }
}

/**
 * Register the list users command with the CLI
 *
 * @param program The commander program
 */
export function registerListCommand(program: Command): void {
  const command = program
    .command("list")
    .description("List all users")
    .action(async (options) => {
      try {
        await executeListUsersCommand(options);
      } catch (error) {
        console.error(`Error: ${error instanceof Error ? error.message : String(error)}`);
        process.exit(1);
      }
    });
    
  // Add common options (debug)
  addCommonOptions(command);
}