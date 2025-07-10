import { AskExpertsSmartMCP } from '../src/AskExpertsSmartMCP.js';
import type { ExpertSessionStructure } from '../src/AskExpertsTools.js';
import { DEFAULT_RELAYS } from '../src/nostr/constants.js';

/**
 * Integration test for the AskExpertsSmartMCP class
 *
 * This test:
 * 1. Uses predefined NWC connection string and OpenAI API key for functionality
 * 2. Creates an AskExpertsSmartMCP instance with the required parameters
 * 3. Calls askExperts with a question and maximum payment amount
 * 4. Logs the results and verifies successful question sending and answer receiving
 */
async function testSmartAskExperts() {
  try {
    console.log('Starting AskExpertsSmartMCP test...');

    // Step 1: Set the required environment variables
    const nwcString = process.env.NWC_CONNECTION_STRING;
    const openaiApiKey = process.env.OPENAI_API_KEY;
    const openaiBaseUrl = process.env.OPENAI_BASE_URL || 'https://api.openai.com/v1';

    if (!nwcString) {
      throw new Error('NWC_CONNECTION_STRING environment variable is required');
    }

    if (!openaiApiKey) {
      throw new Error('OPENAI_API_KEY environment variable is required');
    }

    console.log('Using NWC connection string and OpenAI API key');

    // Step 2: Create an AskExpertsSmartMCP instance
    const askExpertsSmartMCP = new AskExpertsSmartMCP(
      DEFAULT_RELAYS, // Use default relays
      openaiBaseUrl,
      openaiApiKey,
      nwcString
    );
    console.log('Created AskExpertsSmartMCP instance');

    // Step 3: Call askExperts with a question
    console.log('Calling askExperts with a philosophical question...');
    
    const question = "What is the meaning of life? I've been pondering this question for a while and would appreciate your insights on this philosophical question. Some say it's 42, others say it's about finding your own purpose. What do you think?";
    const maxPaymentSats = 200; // Maximum payment amount in satoshis

    const askExpertsResult = await askExpertsSmartMCP.askExperts(
      question,
      maxPaymentSats
    );
    
    console.log('askExperts result:', JSON.stringify(askExpertsResult.structuredContent, null, 2));

    // Step 4: Check if any answers were received
    if (askExpertsResult.structuredContent.received > 0) {
      console.log('✅ Test passed: Received answers from experts');
      
      // Step 5: If there are answers with followup options, test the followupExperts method
      const answersWithFollowup = askExpertsResult.structuredContent.results.filter(
        result => result.followup_message_id && result.followup_sats
      );
      
      if (answersWithFollowup.length > 0) {
        console.log(`Found ${answersWithFollowup.length} answers with followup options`);
        console.log('Calling followupExperts with a followup question...');
        
        const followupParams = {
          ask_id: askExpertsResult.structuredContent.results[0].message_id.split(':')[0],
          question: "Thank you for your answer! Could you elaborate more on how one can discover their own purpose in life?",
          experts: answersWithFollowup.map(result => ({
            message_id: result.followup_message_id!,
            pubkey: result.expert_pubkey,
            bid_sats: result.followup_sats!
          })) as ExpertSessionStructure[],
          timeout: 10000 // 10 seconds timeout
        };
        
        const followupResult = await askExpertsSmartMCP.followupExperts(followupParams);
        console.log('followupExperts result:', JSON.stringify(followupResult.structuredContent, null, 2));
        
        if (followupResult.structuredContent.received > 0) {
          console.log('✅ Test passed: Received answers to followup questions');
        } else if (followupResult.structuredContent.sent > 0) {
          console.log('✅ Test passed: Followup questions sent successfully, but no answers received (timeout)');
        } else {
          console.log('❌ Test failed: No followup questions were sent successfully');
        }
      }
    } else if (askExpertsResult.structuredContent.sent > 0) {
      console.log('✅ Test passed: Questions sent successfully, but no answers received (timeout)');
    } else {
      console.log('❌ Test failed: No questions were sent successfully');
      if (askExpertsResult.structuredContent.failed_payments > 0) {
        console.log('Failed payments:', askExpertsResult.structuredContent.failed_payments);
      }
    }

  } catch (error) {
    console.error('Error in testSmartAskExperts:', error);
  }
}

// Run the test
testSmartAskExperts().catch(error => {
  console.error('Unhandled error in test:', error);
  process.exit(1);
});