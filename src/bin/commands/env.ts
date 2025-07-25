/**
 * Implementation of the 'env' command that prints environment variables
 */
import { Command } from "commander";
import { debugError, enableAllDebug, enableErrorDebug } from "../../common/debug.js";
import fs from "fs";
import path from "path";
import { APP_DIR, APP_ENV_PATH } from "../../common/constants.js";

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
 * Migrate the .env file from the current directory to the app directory
 * @returns A promise that resolves when the migration is complete
 */
export async function migrateEnvFile(): Promise<void> {
  // Ensure the app directory exists
  if (!fs.existsSync(APP_DIR)) {
    fs.mkdirSync(APP_DIR, { recursive: true });
  }

  // Check if .env file exists in current directory
  const currentEnvPath = path.join(process.cwd(), '.env');
  if (!fs.existsSync(currentEnvPath)) {
    console.log(`No .env file found in current directory (${currentEnvPath})`);
    return;
  }

  // Check if .env file already exists in app directory
  if (fs.existsSync(APP_ENV_PATH)) {
    console.log(`Warning: .env file already exists at ${APP_ENV_PATH}`);
    console.log('To overwrite it, use the --force option');
    return;
  }

  // Copy the .env file
  try {
    fs.copyFileSync(currentEnvPath, APP_ENV_PATH);
    console.log(`Successfully migrated .env file to ${APP_ENV_PATH}`);
  } catch (error) {
    console.error(`Error migrating .env file: ${error}`);
    throw error;
  }
}

/**
 * Force migrate the .env file from the current directory to the app directory
 * @returns A promise that resolves when the migration is complete
 */
export async function forceMigrateEnvFile(): Promise<void> {
  // Ensure the app directory exists
  if (!fs.existsSync(APP_DIR)) {
    fs.mkdirSync(APP_DIR, { recursive: true });
  }

  // Check if .env file exists in current directory
  const currentEnvPath = path.join(process.cwd(), '.env');
  if (!fs.existsSync(currentEnvPath)) {
    console.log(`No .env file found in current directory (${currentEnvPath})`);
    return;
  }

  // Copy the .env file, overwriting if it exists
  try {
    fs.copyFileSync(currentEnvPath, APP_ENV_PATH);
    console.log(`Successfully migrated .env file to ${APP_ENV_PATH}`);
  } catch (error) {
    console.error(`Error migrating .env file: ${error}`);
    throw error;
  }
}

/**
 * Register the environment command with the CLI
 *
 * @param program The commander program
 */
export function registerEnvCommand(program: Command): void {
  const envCommand = program
    .command("env")
    .description("Manage environment variables");

  // Display environment variables
  envCommand
    .command("show")
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

  // Migrate .env file
  envCommand
    .command("migrate")
    .description("Migrate .env file from current directory to app directory")
    .option("-f, --force", "Force overwrite if .env file already exists in app directory")
    .option("-d, --debug", "Enable debug logging")
    .action(async (options) => {
      if (options.debug) enableAllDebug();
      else enableErrorDebug();
      try {
        if (options.force) {
          await forceMigrateEnvFile();
        } else {
          await migrateEnvFile();
        }
      } catch (error) {
        debugError("Error migrating .env file:", error);
        process.exit(1);
      }
    });

  // For backward compatibility, make 'env' without subcommand show environment variables
  envCommand.action(async (options) => {
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