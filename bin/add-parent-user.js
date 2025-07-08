#!/usr/bin/env node

import { ParentDB } from "../dist/src/db/parentDb.js";
import readline from "readline";
import { generateSecretKey, getPublicKey, nip19 } from "nostr-tools";
import { bytesToHex } from "@noble/hashes/utils";
import { randomBytes } from "@noble/hashes/utils";

// Check if required arguments are provided
if (process.argv.length < 6) {
  console.error('Usage: node add-parent-user.js <mcp-server-id> <pubkey> <nsec> <nwc>');
  process.exit(1);
}

const mcp_server_id = process.argv[2];
const pubkey = process.argv[3];
const nsec = process.argv[4];
const nwc = process.argv[5];


// Create a new instance of ParentDB
const db = new ParentDB();

async function main() {
  try {
    const mcpServerId = parseInt(mcp_server_id);
    if (isNaN(mcpServerId) || mcpServerId <= 0) {
      console.error("Invalid MCP server ID. Must be a positive number.");
      return;
    }
    
    // Add the user to the database
    const user = await db.addUser({
      pubkey,
      nsec,
      nwc,
      mcp_server_id: mcpServerId
    });
    
    console.log("\nUser added successfully to parent database:");
    console.log("Public Key:", user.pubkey);
    console.log("Token:", user.token);
    console.log("MCP Server ID:", user.mcp_server_id);
    console.log("Timestamp:", new Date(user.timestamp * 1000).toISOString());
  } catch (error) {
    console.error("Error adding user:", error);
  } finally {
    // Close the database connection and readline interface
    await db.close();
  }
}

main();