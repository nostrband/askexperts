import { AskExpertsSmartMCP } from '../../mcp/index.js';
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { debugMCP, debugError, enableAllDebug, enableErrorDebug } from '../../common/debug.js';
import { Command } from "commander";

/**
 * Options for the Smart MCP server command
 */
export interface SmartMcpCommandOptions {
  nwc?: string;
  relays?: string[];
  openaiApiKey?: string;
  openaiBaseUrl?: string;
}

/**
 * Start the Smart MCP server with the given options
 * 
 * @param options Command line options
 */
export async function startSmartMcpServer(options: SmartMcpCommandOptions): Promise<void> {
  // Try to get NWC connection string from options or environment variables
  const nwcString = options.nwc || process.env.NWC_STRING;
  
  // Validate NWC connection string
  if (!nwcString) {
    throw new Error('NWC connection string is required. Use --nwc option or set NWC_STRING environment variable.');
  }
  
  // Try to get OpenAI API key from options or environment variables
  const openaiApiKey = options.openaiApiKey || process.env.OPENAI_API_KEY;
  
  // Validate OpenAI API key
  if (!openaiApiKey) {
    throw new Error('OpenAI API key is required. Use --openai-api-key option or set OPENAI_API_KEY environment variable.');
  }
  
  // Try to get OpenAI base URL from options or environment variables
  const openaiBaseUrl = options.openaiBaseUrl || process.env.OPENAI_BASE_URL || 'https://api.openai.com/v1';
  
  // Try to get discovery relays from options or environment variables
  let discoveryRelays = options.relays;
  if (!discoveryRelays && process.env.DISCOVERY_RELAYS) {
    discoveryRelays = process.env.DISCOVERY_RELAYS.split(',').map(relay => relay.trim());
  }

  try {
    // Create the Smart MCP server
    const server = new AskExpertsSmartMCP(nwcString, openaiApiKey, openaiBaseUrl, discoveryRelays);
    
    // Create the transport
    const transport = new StdioServerTransport();
    
    // Handle SIGINT (Ctrl+C)
    process.on('SIGINT', async () => {
      debugMCP('\nReceived SIGINT. Shutting down...');
      
      try {
        // Close the server connection
        await server.close();
        
        // Dispose of the server resources
        if (typeof server[Symbol.dispose] === 'function') {
          server[Symbol.dispose]();
        }
        
        debugMCP('Server shutdown complete.');
      } catch (error) {
        debugError('Error during shutdown:', error);
      }
      
      // Exit the process
      process.exit(0);
    });
    
    // Connect the server to the transport
    await server.connect(transport);
    
    debugMCP('Smart MCP server started. Press Ctrl+C to exit.');
  } catch (error) {
    debugError('Failed to start Smart MCP server:', error);
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
 * Register the Smart MCP command with the CLI
 *
 * @param program The commander program
 */
export function registerSmartMcpCommand(program: Command): void {
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
}