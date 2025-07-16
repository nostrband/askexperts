import { AskExpertsHttp } from '../../mcp/index.js';
import { debugMCP, debugError } from '../../common/debug.js';

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
export async function startHttpServer(options: HttpCommandOptions): Promise<void> {
  // Get server type (default to "mcp")
  const type = options.type || "mcp";
  
  // If type is "smart", validate OpenAI API key and base URL
  if (type === "smart") {
    // Try to get OpenAI API key from options or environment variables
    const openaiApiKey = options.openaiApiKey || process.env.OPENAI_API_KEY;
    
    // Validate OpenAI API key
    if (!openaiApiKey) {
      throw new Error('OpenAI API key is required for smart MCP. Use --openai-api-key option or set OPENAI_API_KEY environment variable.');
    }
    
    // Try to get OpenAI base URL from options or environment variables
    const openaiBaseUrl = options.openaiBaseUrl || process.env.OPENAI_BASE_URL;
    
    // Validate OpenAI base URL
    if (!openaiBaseUrl) {
      throw new Error('OpenAI base URL is required for smart MCP. Use --openai-base-url option or set OPENAI_BASE_URL environment variable.');
    }
  }
  
  // Try to get discovery relays from options or environment variables
  let discoveryRelays = options.relays;
  if (!discoveryRelays && process.env.DISCOVERY_RELAYS) {
    discoveryRelays = process.env.DISCOVERY_RELAYS.split(',').map(relay => relay.trim());
  }
  
  try {
    // Create the HTTP server
    const server = new AskExpertsHttp({
      port: options.port,
      basePath: options.basePath,
      type,
      discoveryRelays,
      openaiApiKey: options.openaiApiKey || process.env.OPENAI_API_KEY,
      openaiBaseUrl: options.openaiBaseUrl || process.env.OPENAI_BASE_URL
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
    debugError('Failed to start HTTP server:', error);
    throw error;
  }
}