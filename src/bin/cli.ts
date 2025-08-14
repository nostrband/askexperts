import { Command } from "commander";
import { fileURLToPath } from "url";
import { dirname, resolve } from "path";
import fs from "fs";
import dotenv from "dotenv";
import { APP_DIR, APP_ENV_PATH } from "../common/constants.js";
import { registerMcpCommand } from "./commands/mcp.js";
import { registerSmartMcpCommand } from "./commands/smart-mcp.js";
import { registerProxyCommand } from "./commands/proxy.js";
import { registerHttpCommand } from "./commands/http.js";
import { registerEnvCommand } from "./commands/env.js";
import { registerExpertCommand } from "./commands/expert/index.js";
import { registerClientCommand } from "./commands/client.js";
import { registerChatCommand } from "./commands/chat.js";
import { registerDocstoreCommand } from "./commands/docstore/index.js";
import { registerWalletCommands } from "./commands/wallet/index.js";
import { registerStreamCommand } from "./commands/stream/index.js";
import { registerUserCommands } from "./commands/user/index.js";

// Ensure the app directory exists
if (!fs.existsSync(APP_DIR)) {
  fs.mkdirSync(APP_DIR, { recursive: true });
}

// Load environment variables from .env file in the app directory
dotenv.config({ path: APP_ENV_PATH, debug: false });

/**
 * Get the package version from package.json
 * @returns The package version
 */
function getPackageVersion(): string {
  const __filename = fileURLToPath(import.meta.url);
  const __dirname = dirname(__filename);

  // First try to find package.json in the project root
  let packageJsonPath = resolve(__dirname, "../../../package.json");

  // If that doesn't exist (when running from dist), try one level up
  if (!fs.existsSync(packageJsonPath)) {
    packageJsonPath = resolve(__dirname, "../../package.json");
  }

  const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, "utf8"));
  return packageJson.version;
}


/**
 * Main CLI function that sets up the commander program and parses arguments
 */
export function runCli(): void {
  const program = new Command();

  program
    .name("askexperts")
    .description("CLI utility for AskExperts")
    .version(getPackageVersion());

  // Register all commands
  registerMcpCommand(program);
  registerSmartMcpCommand(program);
  registerProxyCommand(program);
  registerHttpCommand(program);
  registerEnvCommand(program);
  registerExpertCommand(program);
  registerClientCommand(program);
  registerChatCommand(program);
  registerDocstoreCommand(program);
  registerWalletCommands(program);
  registerStreamCommand(program);
  registerUserCommands(program);

  // Parse command line arguments
  program.parse();

  // If no arguments provided, show help
  if (process.argv.length === 2) {
    program.help();
  }
}

// Run the CLI when this file is executed directly
runCli();
