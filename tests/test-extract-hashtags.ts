/**
 * Test for extractHashtags function
 */

import { extractHashtags } from "../src/experts/utils/index.js";
import { LightningPaymentManager } from "../src/payments/LightningPaymentManager.js";
import { createOpenAI } from "../src/openai/index.js";
import { SimplePool } from "nostr-tools";

// Fake NWC string - this will be replaced with a real value by the user
const FAKE_NWC_STRING = "nostr+walletconnect://c99a1f0b7390a3db4b09c47f08d4541de1aa9b60ba7a37396554101b7004fb96";

/**
 * Run the test for extractHashtags
 */
async function testExtractHashtags() {
  console.log("Starting extractHashtags test...");

  // Create a fake nostr profile
  const fakeProfile = {
    name: "Bitcoin Expert",
    about: "I am a cryptocurrency enthusiast and Bitcoin expert. I've been in the space since 2013."
  };

  // Create fake posts
  const fakePosts = [
    { content: "I am a bitcoin expert and have been studying cryptocurrencies for years." },
    { content: "The Lightning Network is revolutionizing Bitcoin payments with instant transactions." }
  ];

  try {
    // Create a LightningPaymentManager with the fake NWC string
    const paymentManager = new LightningPaymentManager(FAKE_NWC_STRING);

    const pool = new SimplePool();

    // Create OpenAI instance with the specified model
    const openai = createOpenAI({
      paymentManager,
      pool
    });

    // Call extractHashtags function
    console.log("Calling extractHashtags function...");
    const hashtags = await extractHashtags(
      openai,
      "openai/gpt-oss-20b",
      fakeProfile,
      fakePosts
    );

    // Log the results
    console.log("Extracted hashtags:", hashtags);
    console.log("Test completed successfully");
  } catch (error) {
    console.error("Error during test:", error);
  }
}

// Run the test
testExtractHashtags().catch((error) => {
  console.error("Error running extractHashtags test:", error);
  process.exit(1);
});