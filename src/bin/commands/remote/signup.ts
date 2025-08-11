import { Command } from "commander";
import { debugError } from "../../../common/debug.js";
import { RemoteClient } from "../../../remote/RemoteClient.js";

/**
 * Execute the signup command
 */
export async function executeSignupCommand(): Promise<void> {
  try {
    // Create a new RemoteClient instance
    const client = new RemoteClient();
    
    // Call the signup method
    await client.signup();
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
    .action(async () => {
      try {
        await executeSignupCommand();
      } catch (error) {
        console.error(`Error: ${error instanceof Error ? error.message : String(error)}`);
        process.exit(1);
      }
    });
}