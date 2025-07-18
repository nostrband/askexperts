import { AskExpertsMCP } from '../../mcp/index.js';
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { enableAllDebug, enableErrorDebug, debugMCP, debugError } from '../../common/debug.js';
import { Command } from "commander";

/**
 * Options for the MCP server command
 */
export interface McpCommandOptions {
  nwc?: string;
  relays?: string[];
}

/**
 * Start the MCP server with the given options
 * 
 * @param options Command line options
 */
export async function startMcpServer(options: McpCommandOptions): Promise<void> {

  // Try to get NWC connection string from options or environment variables
  const nwcString = options.nwc || process.env.NWC_STRING;
  
  // Validate NWC connection string
  if (!nwcString) {
    throw new Error('NWC connection string is required. Use --nwc option or set NWC_STRING environment variable.');
  }
  
  // Try to get discovery relays from options or environment variables
  let discoveryRelays = options.relays;
  if (!discoveryRelays && process.env.DISCOVERY_RELAYS) {
    discoveryRelays = process.env.DISCOVERY_RELAYS.split(',').map(relay => relay.trim());
  }

  try {
    // Create the MCP server
    const server = new AskExpertsMCP(nwcString, discoveryRelays);
    
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
    
    debugMCP('MCP server started. Press Ctrl+C to exit.');
  } catch (error) {
    debugError('Failed to start MCP server:', error);
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
 * Register the MCP command with the CLI
 *
 * @param program The commander program
 */
export function registerMcpCommand(program: Command): void {
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
}