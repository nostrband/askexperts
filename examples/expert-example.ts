/**
 * Example of using the Expert class for NIP-174
 */

import { generateSecretKey, getPublicKey, SimplePool } from "nostr-tools";
import { AskExpertsServer, AskExpertsServerBase } from "../src/server/index.js";
import {
  Ask,
  Prompt,
  Proof,
  ExpertReplies,
  ExpertQuote,
  ExpertBid,
  ExpertReply,
} from "../src/common/types.js";
import {
  FORMAT_TEXT,
  METHOD_LIGHTNING,
  FORMAT_OPENAI,
} from "../src/common/constants.js";
import {
  DEFAULT_DISCOVERY_RELAYS,
  DEFAULT_PROPMT_RELAYS,
} from "../src/common/constants.js";
import { createWallet } from "nwc-enclaved-utils";
import { nwc } from "@getalby/sdk";
import dotenv from "dotenv";

// Load environment variables from .env file
dotenv.config();

/**
 * Run the example expert
 */
async function runExampleExpert() {
  console.log("Starting example expert...");

  // Generate a keypair for the expert
  const privateKey = generateSecretKey();
  const publicKey = getPublicKey(privateKey);
  console.log(`Expert pubkey: ${publicKey}`);

  // Create a wallet using nwc-enclaved-utils
  console.log("Creating NWC wallet...");
  const wallet = await createWallet();
  const nwcString = wallet.nwcString;
  console.log("NWC wallet created");

  // Create an NWC client using the Alby SDK
  const nwcClient = new nwc.NWCClient({
    nostrWalletConnectUrl: nwcString,
  });
  console.log("NWC client initialized");

  // Create a SimplePool instance for relay operations
  const pool = new SimplePool();

  // Create an expert instance
  const expert = new AskExpertsServerBase({
    privkey: privateKey,
    discoveryRelays: DEFAULT_DISCOVERY_RELAYS,
    promptRelays: DEFAULT_PROPMT_RELAYS,
    hashtags: ["ai", "help", "question", "test"],
    formats: [FORMAT_TEXT, FORMAT_OPENAI],
    paymentMethods: [METHOD_LIGHTNING],
    pool, // Pass the SimplePool instance

    // Handle asks
    onAsk: async (ask: Ask): Promise<ExpertBid | undefined> => {
      console.log(`Received ask: ${ask.summary}`);

      // Check if the ask contains keywords we're interested in
      const keywords = ["ai", "help", "question", "test"];
      const isRelevant = keywords.some(
        (keyword) =>
          ask.summary.toLowerCase().includes(keyword) ||
          ask.hashtags.includes(keyword)
      );

      if (!isRelevant) {
        console.log("Ask is not relevant, ignoring");
        return undefined;
      }

      // Create a bid
      console.log("Creating bid for ask");
      return {
        offer:
          "I can help you with your question! I specialize in AI and programming topics.",
      };
    },

    // Handle prompts
    onPrompt: async (prompt: Prompt): Promise<ExpertQuote> => {
      console.log(`Received prompt: ${JSON.stringify(prompt.content)}`);

      try {
        // Define the amount in sats
        const amount = 100;

        console.log(`Creating invoice for ${amount} sats...`);

        // Generate a real Lightning invoice using the NWC client
        // Amount needs to be in millisatoshis (msat)
        const amountMsat = amount * 1000;

        const invoiceResponse = await nwcClient.makeInvoice({
          amount: amountMsat,
          description: `Payment for prompt ${prompt.id}`,
        });

        console.log(`Invoice created: ${invoiceResponse.invoice}`);

        // Return the ExpertQuote with the real invoice
        return {
          invoices: [
            {
              method: METHOD_LIGHTNING,
              unit: "sat",
              amount: amount,
              invoice: invoiceResponse.invoice,
            },
          ],
        };
      } catch (error) {
        console.error("Error creating invoice:", error);
        // If we can't create an invoice, we throw an exception
        throw new Error(
          `Failed to create invoice: ${
            error instanceof Error ? error.message : String(error)
          }`
        );
      }
    },

    // Handle proofs and execute prompts
    onProof: async (
      prompt: Prompt,
      expertQuote: ExpertQuote,
      proof: Proof
    ): Promise<ExpertReplies | ExpertReply> => {
      console.log(`Received proof for prompt: ${prompt.id}`);
      console.log(
        `Payment method: ${proof.method}, preimage: ${proof.preimage}`
      );
      console.log(`Quote invoices: ${JSON.stringify(expertQuote.invoices)}`);

      try {
        // Verify the payment using the preimage
        // In a real implementation, you would verify the preimage against the payment hash
        if (!proof.preimage || proof.preimage.length === 0) {
          throw new Error("Invalid payment proof: missing preimage");
        }

        // NOTE: in real expert you must extract payment_hash from quote's invoice,
        // check the sha256(preimage) === payment_hash and
        // that invoice for this payment_hash was paid

        console.log("Payment verified successfully");

        if (prompt.format === FORMAT_TEXT) {
          // Create an ExpertReplies object
          const expertReplies: ExpertReplies = {
            // Implement AsyncIterable interface
            [Symbol.asyncIterator]: async function* () {
              // First reply
              yield {
                done: false,
                content: "This is the first part of my response.",
              };

              // Wait a bit to simulate processing time
              await new Promise((resolve) => setTimeout(resolve, 1000));

              // Second reply
              yield {
                done: false,
                content: "This is the second part of my response.",
              };

              // Wait a bit more
              await new Promise((resolve) => setTimeout(resolve, 1000));

              // Final reply
              yield {
                done: true,
                content:
                  "This is the final part of my response. Thank you for your question!",
              };
            },
          };

          return expertReplies;
        } else {
          return {
            content: {
              id: prompt.id,
              object: "chat.completion",
              created: prompt.event.created_at,
              model: publicKey,
              choices: [
                {
                  index: 0,
                  message: {
                    role: "assistant",
                    content: "Hello! How can I assist you today?",
                    refusal: null,
                    annotations: [],
                  },
                  logprobs: null,
                  finish_reason: "stop",
                },
              ],
              usage: {
                prompt_tokens: 19,
                completion_tokens: 10,
                total_tokens: 29,
                prompt_tokens_details: {
                  cached_tokens: 0,
                  audio_tokens: 0,
                },
                completion_tokens_details: {
                  reasoning_tokens: 0,
                  audio_tokens: 0,
                  accepted_prediction_tokens: 0,
                  rejected_prediction_tokens: 0,
                },
              },
              service_tier: "default",
            },
          };
        }
      } catch (error) {
        console.error("Error verifying payment:", error);
        throw error; // Rethrow to be handled by the Expert class
      }
    },
  });

  // Start the expert
  await expert.start();
  console.log("Expert started and listening for asks and prompts");

  // Keep the process running
  process.on("SIGINT", () => {
    console.log("Shutting down expert...");
    expert[Symbol.dispose]();
    process.exit(0);
  });

  console.log("Press Ctrl+C to exit");
}

// Run the example
runExampleExpert().catch((error) => {
  console.error("Error running example expert:", error);
  process.exit(1);
});
