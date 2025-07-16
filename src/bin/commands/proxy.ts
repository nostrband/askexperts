import { OpenAIProxy } from "../../proxy/index.js";
import { debugClient, debugError } from "../../common/debug.js";

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
    const proxy = new OpenAIProxy(options.port, options.basePath, discoveryRelays);

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
