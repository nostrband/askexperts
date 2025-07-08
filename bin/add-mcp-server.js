#!/usr/bin/env node

import { ParentDB } from "../dist/src/db/parentDb.js";
import readline from "readline";

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout
});

// Create a new instance of ParentDB
const db = new ParentDB();

// Prompt for MCP server URL
rl.question("Enter MCP server URL: ", async (url) => {
  try {
    // Add the MCP server to the database
    const mcpServer = await db.addMcpServer(url);
    
    console.log("\nMCP Server added successfully:");
    console.log("ID:", mcpServer.id);
    console.log("URL:", mcpServer.url);
    console.log("Token:", mcpServer.token);
    console.log("\nUse this token to authenticate the MCP server with the parent server.");
    console.log("Set the following environment variables in your MCP server:");
    console.log(`PARENT_URL=http://localhost:3001`);
    console.log(`PARENT_TOKEN=${mcpServer.token}`);
    console.log(`MCP_SERVER_ID=${mcpServer.id}`);
  } catch (error) {
    console.error("Error adding MCP server:", error);
  } finally {
    // Close the database connection and readline interface
    await db.close();
    rl.close();
  }
});