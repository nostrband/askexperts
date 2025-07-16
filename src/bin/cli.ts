import { Command } from "commander";
import { fileURLToPath } from "url";
import { dirname, resolve } from "path";
import fs from "fs";
import dotenv from "dotenv";
import { startMcpServer } from "./commands/mcp.js";
import { startSmartMcpServer } from "./commands/smart-mcp.js";
import { startProxyServer } from "./commands/proxy.js";
import { startHttpServer } from "./commands/http.js";
import {
  debugError,
  enableAllDebug,
  enableErrorDebug,
} from "../common/debug.js";

// Load environment variables from .env file without debug logs
dotenv.config({ debug: false });

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
 * Helper function to parse comma-separated lists
 * @param value The comma-separated string
 * @returns Array of trimmed strings
 */
function commaSeparatedList(value: string): string[] {
  return value.split(",").map((item) => item.trim());
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

  // MCP command
  program
    .command("mcp")
    .description("Launch the stdio MCP server")
    .option("-n, --nwc <string>", "NWC connection string for payments")
    .option(
      "-r, --relays <items>",
      "Comma-separated list of discovery relays",
      commaSeparatedList
    )
    .option("-d, --debug", "Enable debug logging")
    .action(async (options) => {
      if (options.debug) enableAllDebug();
      else enableErrorDebug();
      try {
        await startMcpServer(options);
      } catch (error) {
        debugError("Error starting MCP server:", error);
        process.exit(1);
      }
    });

  // Smart MCP command
  program
    .command("smart")
    .description("Launch the stdio Smart MCP server with LLM capabilities")
    .option("-n, --nwc <string>", "NWC connection string for payments")
    .option(
      "-r, --relays <items>",
      "Comma-separated list of discovery relays",
      commaSeparatedList
    )
    .option(
      "-k, --openai-api-key <string>",
      "OpenAI API key"
    )
    .option(
      "-u, --openai-base-url <string>",
      "OpenAI base URL"
    )
    .option("-d, --debug", "Enable debug logging")
    .action(async (options) => {
      if (options.debug) enableAllDebug();
      else enableErrorDebug();
      try {
        await startSmartMcpServer(options);
      } catch (error) {
        debugError("Error starting Smart MCP server:", error);
        process.exit(1);
      }
    });

  // Proxy command
  program
    .command("proxy")
    .description("Launch an OpenAI-compatible proxy server for NIP-174")
    .requiredOption("-p, --port <number>", "Port to listen on")
    .option("-b, --base-path <string>", "Base path for the API", "/")
    .option(
      "-r, --relays <items>",
      "Comma-separated list of discovery relays",
      commaSeparatedList
    )
    .option("-d, --debug", "Enable debug logging")
    .action(async (options) => {
      if (options.debug) enableAllDebug();
      else enableErrorDebug();
      try {
        await startProxyServer(options);
      } catch (error) {
        debugError("Error starting OpenAI Proxy server:", error);
        process.exit(1);
      }
    });

  // HTTP command
  program
    .command("http")
    .description("Launch an HTTP MCP server")
    .requiredOption("-p, --port <number>", "Port to listen on (default: 3000)")
    .option(
      "-r, --relays <items>",
      "Comma-separated list of discovery relays",
      commaSeparatedList
    )
    .option("-b, --base-path <string>", "Base path for the server")
    .option(
      "-t, --type <string>",
      "Server type: 'mcp' or 'smart' (default: 'mcp')",
      (value) => {
        if (value !== "mcp" && value !== "smart") {
          throw new Error("Type must be either 'mcp' or 'smart'");
        }
        return value;
      }
    )
    .option(
      "-k, --openai-api-key <string>",
      "OpenAI API key (required for 'smart' type)"
    )
    .option(
      "-u, --openai-base-url <string>",
      "OpenAI base URL (required for 'smart' type)"
    )
    .option("-d, --debug", "Enable debug logging")
    .action(async (options) => {
      if (options.debug) enableAllDebug();
      else enableErrorDebug();
      try {
        await startHttpServer(options);
      } catch (error) {
        debugError("Error starting HTTP server:", error);
        process.exit(1);
      }
    });

  // Parse command line arguments
  program.parse();

  // If no arguments provided, show help
  if (process.argv.length === 2) {
    program.help();
  }
}

// Run the CLI when this file is executed directly
runCli();
