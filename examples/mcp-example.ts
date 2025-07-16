/**
 * Example usage of the AskExpertsMCP class
 */

import { AskExpertsMCP } from "../src/mcp/index.js";
import dotenv from "dotenv";

// Load environment variables from .env file
dotenv.config();

// Use NWC_STRING from .env file or fallback to default
const NWC_STRING = process.env.NWC_STRING || "";
if (!NWC_STRING) throw new Error("NWC_STRING required");

async function main() {
  try {
    // Create a new AskExpertsMCP instance
    const askExpertsMCP = new AskExpertsMCP(NWC_STRING);

    console.log("Finding experts...");

    // Find experts on a subject
    const bids = await askExpertsMCP.findExperts(
      "How to implement a Lightning Network wallet?",
      ["bitcoin", "lightning", "wallet", "test"]
    );

    console.log(`Found ${bids.length} experts:`);
    bids.forEach((bid, index) => {
      console.log(
        `${index + 1}. Expert: ${bid.expert_pubkey.substring(0, 8)}...`
      );
      console.log(`   Offer: ${bid.offer}`);
    });

    if (bids.length === 0) {
      console.log("No experts found. Exiting.");
      return;
    }

    // Select the first expert
    const selectedBid = bids[0];

    console.log(
      `\nAsking expert ${selectedBid.expert_pubkey.substring(0, 8)}...`
    );

    // Ask the expert a question
    const reply = await askExpertsMCP.askExpert(
      "I want to implement a Lightning Network wallet in my Node.js application. What libraries should I use and what are the key steps?",
      selectedBid.expert_pubkey,
      10000 // Maximum 10,000 sats
    );

    console.log("\nExpert reply:");
    console.log(`Expert: ${reply.expert_pubkey.substring(0, 8)}...`);

    if (reply.error) {
      console.log(`Error: ${reply.error}`);
    } else {
      console.log(`Amount paid: ${reply.amount_sats ?? 0} sats`);
      console.log(`Content: ${reply.content ?? ""}`);
    }

    // Ask multiple experts
    if (bids.length > 1) {
      console.log("\nAsking multiple experts...");

      // Select the first 2 experts (or all if less than 2)
      const selectedBids = bids.slice(0, Math.min(2, bids.length));

      // Ask all selected experts
      const replies = await askExpertsMCP.askExperts(
        "What are the security considerations when implementing a Lightning Network wallet?",
        selectedBids,
        10000 // Maximum 10,000 sats per expert
      );

      console.log(`\nReceived ${replies.length} replies:`);
      replies.forEach((reply, index) => {
        console.log(
          `${index + 1}. Expert: ${reply.expert_pubkey.substring(0, 8)}...`
        );

        if (reply.error) {
          console.log(`   Error: ${reply.error}`);
        } else {
          console.log(`   Amount paid: ${reply.amount_sats ?? 0} sats`);
          console.log(
            `   Content: ${
              reply.content ? reply.content.substring(0, 100) + "..." : ""
            }`
          );
        }
      });
    }

    // Dispose of the AskExpertsMCP instance
    askExpertsMCP[Symbol.dispose]();

    console.log("\nDone!");
  } catch (error) {
    console.error("Error:", error);
  }
}

main();
