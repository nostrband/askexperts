import { OpenaiProxy } from "../../proxy/index.js";
import { debugClient, debugError, enableAllDebug, enableErrorDebug } from "../../common/debug.js";
import { Command } from "commander";

/**
 * Options for the proxy command
 */
export interface ProxyCommandOptions {
  port: number;
  basePath?: string;
  relays?: string[];
}

/**
 * Start the OpenAI proxy server with the given options
 *
 * @param options Command line options
 */
export async function startProxyServer(
  options: ProxyCommandOptions
): Promise<void> {
  // Try to get discovery relays from options or environment variables
  let discoveryRelays = options.relays;
  if (!discoveryRelays && process.env.DISCOVERY_RELAYS) {
    discoveryRelays = process.env.DISCOVERY_RELAYS.split(",").map((relay) =>
      relay.trim()
    );
  }

  try {
    // Create the OpenAI proxy server
    const proxy = new OpenaiProxy(options.port, options.basePath, discoveryRelays);

    // Handle SIGINT/SIGTERM (Ctrl+C)
    const sigHandler = async () => {
      debugClient("\nReceived SIGINT. Shutting down...");

      try {
        // Stop the proxy server
        await proxy.stop();

        debugClient("Proxy server shutdown complete.");
      } catch (error) {
        debugError("Error during shutdown:", error);
      } finally {
        // Exit the process
        process.exit(0);
      }
    };
    process.on("SIGINT", sigHandler);
    process.on("SIGTERM", sigHandler);

    // Start the proxy server
    await proxy.start();

    debugClient("Press Ctrl+C to exit.");
  } catch (error) {
    debugError("Failed to start OpenAI Proxy server:", error);
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
 * Register the proxy command with the CLI
 *
 * @param program The commander program
 */
export function registerProxyCommand(program: Command): void {
  program
    .command("proxy")
    .description("Launch an OpenAI-compatible proxy server for NIP-174")
    .requiredOption("-p, --port <number>", "Port to listen on", parseInt)
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
}
