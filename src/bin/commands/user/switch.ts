import { Command } from "commander";
import { debugError } from "../../../common/debug.js";
import { DB } from "../../../db/DB.js";
import { APP_DB_PATH } from "../../../common/constants.js";
import { setCurrentUserId } from "../../../common/users.js";
import { addCommonOptions } from "./index.js";

/**
 * Options for the switch user command
 */
interface SwitchUserOptions {
  debug?: boolean;
}

/**
 * Execute the switch user command
 * 
 * @param pubkey Public key of the user to switch to
 * @param options Command line options
 */
export async function executeSwitchUserCommand(
  pubkey: string,
  options: SwitchUserOptions
): Promise<void> {
  try {
    // Validate inputs
    if (!pubkey) {
      throw new Error("Public key is required");
    }
    
    // Initialize the database
    const db = new DB(APP_DB_PATH);

    // Find the user by pubkey
    const user = await db.getUserByPubkey(pubkey);
    
    if (!user) {
      throw new Error(`User with pubkey ${pubkey} not found`);
    }

    // Set this user as the current user
    setCurrentUserId(user.id);
    
    console.log(`Switched to user:`);
    console.log(`ID: ${user.id}`);
    console.log(`Pubkey: ${user.pubkey}`);

  } catch (error) {
    debugError("Failed to switch user:", error);
    throw error;
  }
}

/**
 * Register the switch user command with the CLI
 *
 * @param program The commander program
 */
export function registerSwitchCommand(program: Command): void {
  const command = program
    .command("switch")
    .description("Switch to a different user by pubkey")
    .argument("<pubkey>", "Public key of the user to switch to")
    .action(async (pubkey, options) => {
      try {
        await executeSwitchUserCommand(pubkey, options);
      } catch (error) {
        console.error(`Error: ${error instanceof Error ? error.message : String(error)}`);
        process.exit(1);
      }
    });
    
  // Add common options (debug)
  addCommonOptions(command);
}