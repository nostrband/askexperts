import { Command } from "commander";
import { debugError } from "../../../common/debug.js";
import { createDBRemoteClient } from "../../../db/utils.js";

/**
 * Execute the signup command
 *
 * @param url The URL of the server to sign up on
 */
export async function executeSignupCommand(url: string): Promise<void> {
  try {
    // Create a new DBRemoteClient instance
    const client = await createDBRemoteClient(url);
    
    // Call the signup method
    const userId = await client.signup();
    
    // Print the user ID
    console.log(`Successfully signed up! User ID: ${userId}`);
  } catch (error) {
    debugError("Failed to sign up:", error);
    throw error;
  }
}

/**
 * Register the signup command with the CLI
 *
 * @param program The commander program
 */
export function registerSignupCommand(program: Command): void {
  program
    .command("signup")
    .description("Sign up on askexperts.io remote service")
    .option("-u, --url <url>", "Server URL", "https://api.askexperts.io")
    .action(async (options) => {
      try {
        await executeSignupCommand(options.url);
      } catch (error) {
        console.error(`Error: ${error instanceof Error ? error.message : String(error)}`);
        process.exit(1);
      }
    });
}