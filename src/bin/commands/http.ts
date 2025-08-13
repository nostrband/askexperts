import { AskExpertsHttp } from "../../mcp/index.js";
import {
  debugMCP,
  debugError,
  enableAllDebug,
  enableErrorDebug,
} from "../../common/debug.js";
import { Command } from "commander";

/**
 * Options for the HTTP server command
 */
export interface HttpCommandOptions {
  port: number;
  relays?: string[];
  basePath?: string;
  type?: "mcp" | "smart";
  openaiApiKey?: string;
  openaiBaseUrl?: string;
}

/**
 * Start the HTTP server with the given options
 *
 * @param options Command line options
 */
export async function startHttpServer(
  options: HttpCommandOptions
): Promise<void> {
  // Get server type (default to "mcp")
  const type = options.type || "mcp";

  // Try to get OpenAI API key from options or environment variables
  let openaiApiKey = options.openaiApiKey || process.env.OPENAI_API_KEY;
  // Try to get OpenAI base URL from options or environment variables
  let openaiBaseUrl = options.openaiBaseUrl || process.env.OPENAI_BASE_URL;

  // If type is "smart", validate OpenAI API key and base URL
  if (type === "smart") {
    if (!openaiBaseUrl) {
      // Override with a fake url that will trigger the use
      // of AE protocol to talk to our expert-based LLM
      openaiBaseUrl = "https://askexperts.io";
    } else {
      // Validate OpenAI API key
      if (!openaiApiKey) {
        throw new Error(
          "OpenAI API key is required for smart MCP. Use --openai-api-key option or set OPENAI_API_KEY environment variable."
        );
      }

      // Validate OpenAI base URL
      if (!openaiBaseUrl) {
        throw new Error(
          "OpenAI base URL is required for smart MCP. Use --openai-base-url option or set OPENAI_BASE_URL environment variable."
        );
      }
    }
  }

  // Try to get discovery relays from options or environment variables
  let discoveryRelays = options.relays;
  if (!discoveryRelays && process.env.DISCOVERY_RELAYS) {
    discoveryRelays = process.env.DISCOVERY_RELAYS.split(",").map((relay) =>
      relay.trim()
    );
  }

  try {
    // Create the HTTP server
    const server = new AskExpertsHttp({
      port: options.port,
      basePath: options.basePath,
      type,
      discoveryRelays,
      openaiApiKey,
      openaiBaseUrl,
    });

    // Handle SIGINT/SIGTERM (Ctrl+C)
    const sigHandler = async () => {
      debugMCP("\nReceived SIGINT. Shutting down...");

      try {
        // Stop the proxy server
        await server.stop();

        debugMCP("Proxy server shutdown complete.");
      } catch (error) {
        debugError("Error during shutdown:", error);
      } finally {
        // Exit the process
        process.exit(0);
      }
    };
    process.on("SIGINT", sigHandler);
    process.on("SIGTERM", sigHandler);

    // Start the server
    server.start();

    debugMCP("Press Ctrl+C to exit.");
  } catch (error) {
    debugError("Failed to start HTTP server:", error);
    throw error;
  }
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
 * Register the HTTP command with the CLI
 *
 * @param program The commander program
 */
export function registerHttpCommand(program: Command): void {
  program
    .command("http")
    .description("Launch an HTTP MCP server")
    .requiredOption(
      "-p, --port <number>",
      "Port to listen on (default: 3000)",
      parseInt
    )
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
      "OpenAI API key (required if -u is set)"
    )
    .option(
      "-u, --openai-base-url <string>",
      "OpenAI base URL (custom URL for 'smart' type)"
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
}
