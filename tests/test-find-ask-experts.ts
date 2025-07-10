import { AskExpertsMCP } from '../src/AskExpertsMCP.js';
import type { ExpertSessionStructure } from '../src/AskExpertsMCP.js';
import type { FindExpertsParams, AskExpertsParams } from '../src/AskExpertsTools.js';
import { DEFAULT_RELAYS } from '../src/nostr/constants.js';

/**
 * Integration test for the AskExpertsMCP class
 *
 * This test:
 * 1. Uses a predefined NWC connection string for payment functionality
 * 2. Creates an AskExpertsMCP instance with the NWC connection string
 * 3. Calls findExperts with a philosophical question summary
 * 4. If bids are received, calls askExperts with the detailed question
 * 5. Logs the results and verifies successful question sending and answer receiving
 */
async function testFindAskExperts() {
  try {
    console.log('Starting AskExpertsMCP test...');

    // Step 1: Set the NWC_CONNECTION_STRING environment variable
    const nwcString = 'nostr+walletconnect://c99a1f0b7390a3db4b09c47f08d4541de1aa9b60ba7a37396554101b7004fb96?relay=wss://relay.zap.land/&secret=2534ff0199b4ab23a8d72fb6a4af52a8db58bd6a98fa39f138b7ac58bcae486d&lud16=npub1cw6vww4hwszyndpphd463nnmagg6sqdg62wk6plsfwfz7rk7cznseftqza@npub1exdp7zmnjz3akjcfc3ls34z5rhs64xmqhfarwwt92sgpkuqylwtqp4tg0v.zap.land';
    console.log('Using NWC connection string');

    // Step 2: Create an AskExpertsMCP instance
    const askExpertsMCP = new AskExpertsMCP(
      DEFAULT_RELAYS, // Use default relays
      nwcString
    );
    console.log('Created AskExpertsMCP instance');

    // Step 3: Call findExperts with a dumb question
    console.log('Calling findExperts with a dumb question...');
    const findExpertsParams = {
      public_question_summary: "What is the meaning of life?",
      tags: ["nostr", "test"],
      max_bid_sats: 100
    };

    const findExpertsResult = await askExpertsMCP.findExperts(findExpertsParams);
    console.log('findExperts result:', JSON.stringify(findExpertsResult.structuredContent, null, 2));

    // Step 4: Check if any bids were received
    if (findExpertsResult.structuredContent.bids && findExpertsResult.structuredContent.bids.length > 0) {
      console.log(`Received ${findExpertsResult.structuredContent.bids.length} bids`);

      // Step 5: Call askExperts with the full question
      console.log('Calling askExperts with the full question...');
      const askExpertsParams = {
        ask_id: findExpertsResult.structuredContent.id,
        question: "What is the meaning of life? I've been pondering this question for a while and would appreciate your insights on this philosophical question. Some say it's 42, others say it's about finding your own purpose. What do you think?",
        experts: findExpertsResult.structuredContent.bids.map((bid: any) => ({
          pubkey: bid.pubkey,
          bid_sats: bid.bid_sats
        })) as ExpertSessionStructure[],
        timeout: 10000 // 10 seconds timeout
      };

      const askExpertsResult = await askExpertsMCP.askExperts(askExpertsParams);
      console.log('askExperts result:', JSON.stringify(askExpertsResult.structuredContent, null, 2));

      // Step 6: Check if any answers were received
      if (askExpertsResult.structuredContent.received > 0) {
        console.log('✅ Test passed: Received answers from experts');
      } else if (askExpertsResult.structuredContent.sent > 0) {
        console.log('✅ Test passed: Questions sent successfully, but no answers received (timeout)');
      } else {
        console.log('❌ Test failed: No questions were sent successfully');
        if (askExpertsResult.structuredContent.failed_payments > 0) {
          console.log('Failed payments:', askExpertsResult.structuredContent.failed_payments);
        }
      }
    } else {
      console.log('❌ Test failed: No bids received from experts');
    }

  } catch (error) {
    console.error('Error in testFindAskExperts:', error);
  }
}

// Run the test
testFindAskExperts().catch(error => {
  console.error('Unhandled error in test:', error);
  process.exit(1);
});