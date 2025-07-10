#!/usr/bin/env node

// This is the entry point for the npx askexperts-smart command
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { AskExpertsSmartMCP } from "../dist/src/AskExpertsSmartMCP.js";
import { DEFAULT_RELAYS } from "../dist/src/nostr/constants.js";

// Check for required environment variables
if (!process.env.OPENAI_API_KEY) {
  console.error("Error: OPENAI_API_KEY environment variable is required");
  process.exit(1);
}

if (!process.env.NWC_CONNECTION_STRING) {
  console.error("Error: NWC_CONNECTION_STRING environment variable is required");
  process.exit(1);
}

// Create an instance of AskExpertsSmartMCP
const server = new AskExpertsSmartMCP(
  DEFAULT_RELAYS, // Use default relays
  process.env.OPENAI_BASE_URL || "https://api.openai.com/v1", // Use OpenAI base URL from env or default
  process.env.OPENAI_API_KEY, // OpenAI API key (required)
  process.env.NWC_CONNECTION_STRING // NWC connection string (required)
);

// Start receiving messages on stdin and sending messages on stdout
const transport = new StdioServerTransport();
server
  .connect(transport)
  .then(() => {
    //console.log('AskExperts Smart MCP server is running');
  })
  .catch((error) => {
    console.error("Failed to start AskExperts Smart MCP server:", error);
  });