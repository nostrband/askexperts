import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { AskExpertsMCP } from "./AskExpertsMCP.js";
import { DEFAULT_RELAYS } from "./nostr/constants.js";

// Create an instance of AskExpertsMCP
const server = new AskExpertsMCP(
  DEFAULT_RELAYS, // Use default relays
  process.env.NWC_CONNECTION_STRING // Use NWC connection string from env if available
);

// Start receiving messages on stdin and sending messages on stdout
const transport = new StdioServerTransport();
server
  .connect(transport)
  .then(() => {
    //console.log('AskExperts MCP server is running');
  })
  .catch((error: unknown) => {
    console.error("Failed to start AskExperts MCP server:", error);
  });
