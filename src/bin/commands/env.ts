/**
 * Implementation of the 'env' command that prints environment variables
 */
import { Command } from "commander";
import { debugError, enableAllDebug, enableErrorDebug } from "../../common/debug.js";

/**
 * Start the environment variables display
 * @returns A promise that resolves when the environment is displayed
 */
export async function displayEnvironment(): Promise<void> {
  console.log("Environment Variables:");
  console.log("======================");
  
  // Get all environment variables and sort them alphabetically
  const envVars = Object.entries(process.env)
    .sort(([keyA], [keyB]) => keyA.localeCompare(keyB));
  
  // Print each environment variable
  for (const [key, value] of envVars) {
    console.log(`${key}=${value}`);
  }
  
  console.log("======================");
}

/**
 * Register the environment command with the CLI
 *
 * @param program The commander program
 */
export function registerEnvCommand(program: Command): void {
  program
    .command("env")
    .description("Display all environment variables from process.env")
    .option("-d, --debug", "Enable debug logging")
    .action(async (options) => {
      if (options.debug) enableAllDebug();
      else enableErrorDebug();
      try {
        await displayEnvironment();
      } catch (error) {
        debugError("Error displaying environment variables:", error);
        process.exit(1);
      }
    });
}