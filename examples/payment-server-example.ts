/**
 * Example of using AskExpertsServer with payment handling
 */

import { SimplePool } from "nostr-tools";
import { AskExpertsServer } from "../src/server/index.js";
import { LightningPaymentManager } from "../src/payments/LightningPaymentManager.js";
import { Prompt, ExpertQuote, ExpertReply, ExpertPrice } from "../src/common/types.js";
import { generateRandomKeyPair } from "../src/common/crypto.js";

// Create a SimplePool instance for relay operations
const pool = new SimplePool();

// Generate a random key pair for the expert
// In a real application, you would use a persistent private key
const { privateKey: privkey } = generateRandomKeyPair();

// Create a Lightning payment manager
// In a real application, you would configure this with your Lightning node
// The LightningPaymentManager requires an NWC connection string
const nwcConnectionString = "nostr+walletconnect://..."; // Replace with your actual NWC connection string
const paymentManager = new LightningPaymentManager(nwcConnectionString);

// Create an AskExpertsServer instance with payment handling
const server = new AskExpertsServer({
  privkey,
  paymentManager,
  pool,
  // Configure with your expert details
  nickname: "Payment Expert",
  description: "Expert that charges for responses",
  hashtags: ["ai", "payment", "example"],
  
  // Handle asks - decide whether to respond with a bid
  onAsk: async (ask) => {
    console.log(`Received ask: ${ask.summary}`);
    
    // Return a bid if you want to respond
    return {
      offer: "I can help with that for a small fee.",
    };
  },
  
  // Handle prompt pricing - determine how much to charge
  onPromptPrice: async (prompt: Prompt): Promise<ExpertPrice> => {
    console.log(`Pricing prompt: ${prompt.id}`);
    
    // Determine the price based on the prompt
    // This is a simple example - you would implement your own pricing logic
    const price: ExpertPrice = {
      amountSats: 100, // 100 satoshis
      description: "Payment for expert response",
    };
    
    return price;
  },
  
  // Handle paid prompts - generate the response after payment is verified
  onPromptPaid: async (prompt: Prompt, quote: ExpertQuote): Promise<ExpertReply> => {
    console.log(`Processing paid prompt: ${prompt.id}`);
    
    // Generate a response based on the prompt
    // This is a simple example - you would implement your own response logic
    const reply: ExpertReply = {
      content: `Thank you for your payment! Here's your response to: ${JSON.stringify(prompt.content)}`,
      done: true,
    };
    
    return reply;
  },
});

// Start the server
async function main() {
  try {
    console.log("Starting payment-enabled expert server...");
    await server.start();
    console.log("Server started successfully!");
    
    // Keep the process running
    process.stdin.resume();
    
    // Handle graceful shutdown
    process.on("SIGINT", () => {
      console.log("Shutting down server...");
      server[Symbol.dispose]();
      process.exit(0);
    });
  } catch (error) {
    console.error("Error starting server:", error);
    process.exit(1);
  }
}

main();