import { AskExpertsMCP } from '../../mcp/index.js';
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { enableAllDebug, debugMCP, debugError } from '../../common/debug.js';

/**
 * Options for the MCP server command
 */
export interface McpCommandOptions {
  nwc?: string;
  relays?: string[];
  debug?: boolean;
}

/**
 * Start the MCP server with the given options
 * 
 * @param options Command line options
 */
export async function startMcpServer(options: McpCommandOptions): Promise<void> {
  // Enable debug logging if requested
  if (options.debug) {
    enableAllDebug();
  }

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