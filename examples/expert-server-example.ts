#!/usr/bin/env node

import { ExpertServer, ExpertRemoteClient } from "../src/experts/index.js";
import type { DBExpert } from "../src/db/interfaces.js";
import dotenv from "dotenv";

// Load environment variables from .env file
dotenv.config();

// Default server port
const SERVER_PORT = parseInt(process.env.EXPERT_SERVER_PORT || "3001", 10);
const SERVER_BASE_PATH = process.env.EXPERT_SERVER_BASE_PATH || "/api";
const SERVER_URL =
  process.env.EXPERT_SERVER_URL ||
  `http://localhost:${SERVER_PORT}${SERVER_BASE_PATH}`;

// Sample expert data for testing
const sampleExpert: DBExpert = {
  pubkey: "sample-pubkey-" + Date.now(),
  wallet_id: 1, // Make sure this wallet ID exists in your database
  type: "sample",
  nickname: "Sample Expert",
  env: "{}",
  docstores: "[]",
};

async function main() {
  console.log("Starting Expert Server example...");

  // Create and start the server
  const server = new ExpertServer({
    port: SERVER_PORT,
    basePath: SERVER_BASE_PATH,
  });
  await server.start();
  console.log(`Expert Server running at ${SERVER_URL}`);

  try {
    // Create a remote client that connects to the server
    console.log(`Creating remote client connecting to ${SERVER_URL}`);
    const client = new ExpertRemoteClient(SERVER_URL);

    // Test listing experts
    console.log("\nListing experts...");
    const experts = await client.listExperts();
    console.log(`Found ${experts.length} experts`);

    // Test inserting an expert
    console.log("\nInserting sample expert...");
    const insertResult = await client.insertExpert(sampleExpert);
    console.log(`Insert result: ${insertResult}`);

    if (insertResult) {
      // Test getting the expert
      console.log("\nGetting the inserted expert...");
      const expert = await client.getExpert(sampleExpert.pubkey);
      console.log("Retrieved expert:", expert);

      // Test updating the expert
      console.log("\nUpdating the expert...");
      const updatedExpert = {
        ...sampleExpert,
        nickname: "Updated Sample Expert",
      };
      const updateResult = await client.updateExpert(updatedExpert);
      console.log(`Update result: ${updateResult}`);

      // Test setting disabled status
      console.log("\nSetting expert disabled status...");
      const disableResult = await client.setExpertDisabled(
        sampleExpert.pubkey,
        true
      );
      console.log(`Disable result: ${disableResult}`);

      // Test getting the updated expert
      console.log("\nGetting the updated expert...");
      const updatedExpertResult = await client.getExpert(sampleExpert.pubkey);
      console.log("Updated expert:", updatedExpertResult);

      // Test deleting the expert
      console.log("\nDeleting the expert...");
      const deleteResult = await client.deleteExpert(sampleExpert.pubkey);
      console.log(`Delete result: ${deleteResult}`);

      // Verify the expert was deleted
      console.log("\nVerifying expert was deleted...");
      const deletedExpert = await client.getExpert(sampleExpert.pubkey);
      console.log(`Expert exists: ${deletedExpert !== null}`);
    }
  } catch (error) {
    console.error("Error:", error);
  } finally {
    // Stop the server
    console.log("\nStopping the server...");
    await server.stop();
    console.log("Server stopped");
  }
}

main().catch(console.error);
