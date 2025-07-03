import { createWallet } from 'nwc-enclaved-utils';
import { nwc } from '@getalby/sdk';
import { AskExpertsMCP, BidStructure } from '../src/AskExpertsMCP.js';
import { generateSecretKey, getPublicKey } from 'nostr-tools';
import * as bolt11 from 'bolt11';
import { payExperts } from '../src/utils/nwc.js';
import { DEFAULT_RELAYS } from '../src/nostr/constants.js';

/**
 * Test for the AskExpertsMCP class payment functionality
 * 
 * This test:
 * 1. Creates a wallet using nwc-enclaved-utils
 * 2. Uses Alby to create an invoice for 10 sats
 * 3. Creates a single fake bid
 * 4. Tests both direct payExperts and AskExpertsMCP payment functionality
 */
async function testPayExperts() {
  try {
    console.log('Starting payment test...');

    // The NWC connection string provided in the task
    const nwcConnectionString = '...';

    // Step 1: Create a wallet for testing
    console.log('Creating wallet...');
    const { nwcString, lnAddress } = await createWallet();
    console.log('Wallet created with lnAddress:', lnAddress);

    // Step 2: Create an Alby client to generate an invoice
    console.log('Creating Alby client...');
    const albyClient = new nwc.NWCClient({
      nostrWalletConnectUrl: nwcString,
    });

    // Step 3: Generate an invoice for 10 sats
    console.log('Generating invoice for 10 sats...');
    const { invoice } = await albyClient.makeInvoice({
      amount: 10 * 1000, // Convert sats to millisats
      description: 'Test invoice for payExperts',
    });
    console.log('Generated invoice:', invoice);
    const di = bolt11.decode(invoice);
    console.log('Generated invoice data:', di);

    // Step 4: Create a fake bid
    console.log('Creating fake bid...');
    const bidPrivateKey = generateSecretKey();
    const bidPublicKey = getPublicKey(bidPrivateKey);
    
    const fakeBid: BidStructure = {
      id: 'test-bid-' + Date.now(),
      pubkey: bidPublicKey,
      relays: ['wss://relay.nostr.band'],
      invoice: invoice
    };
    console.log('Created fake bid:', fakeBid);

    // Step 5: Call payExperts directly with the fake bid and NWC connection string
    console.log('Calling payExperts directly...');
    const directPaymentResults = await payExperts(
      [fakeBid as any], // Cast to match the expected type
      nwcConnectionString
    );

    // Step 6: Log the direct payment results
    console.log('Direct payment results:', JSON.stringify(directPaymentResults, null, 2));

    // Step 7: Create an AskExpertsMCP instance and test its payment functionality
    console.log('Creating AskExpertsMCP instance...');
    const askExpertsMCP = new AskExpertsMCP(
      DEFAULT_RELAYS, // Use default relays
      nwcConnectionString
    );

    // Create a new invoice for the AskExpertsMCP test
    console.log('Generating new invoice for AskExpertsMCP test...');
    const { invoice: newInvoice } = await albyClient.makeInvoice({
      amount: 10 * 1000, // Convert sats to millisats
      description: 'Test invoice for AskExpertsMCP',
    });

    // Create a new fake bid
    const newFakeBid: BidStructure = {
      id: 'test-bid-askexpertsmcp-' + Date.now(),
      pubkey: bidPublicKey,
      relays: ['wss://relay.nostr.band'],
      invoice: newInvoice
    };

    // Step 8: Test AskExpertsMCP by creating a mock ask and then calling askExperts
    // This is a simplified test that just verifies the payment functionality
    console.log('Testing AskExpertsMCP payment functionality...');
    
    // First, we need to add a mock ask to the internal map
    // We'll do this by calling findExperts with a dummy question
    const findExpertsResult = await askExpertsMCP.findExperts({
      public_question_summary: "Test question for payment",
      tags: ["test"],
      max_bid_sats: 100
    });
    
    // Now call askExperts with our fake bid
    const askExpertsParams = {
      ask_id: findExpertsResult.structuredContent.id,
      question: "Test question for payment functionality",
      bids: [newFakeBid],
      timeout: 5000
    };
    
    try {
      const askExpertsResult = await askExpertsMCP.askExperts(askExpertsParams);
      console.log('AskExpertsMCP payment test result:', JSON.stringify(askExpertsResult.structuredContent, null, 2));
      
      if (askExpertsResult.structuredContent.failed_payments === 0) {
        console.log('✅ AskExpertsMCP payment test passed');
      } else {
        console.log('❌ AskExpertsMCP payment test failed');
      }
    } catch (error) {
      console.error('Error in AskExpertsMCP payment test:', error);
    }

    // Check if direct payment was successful
    if (directPaymentResults.length > 0 && directPaymentResults[0].success) {
      console.log('✅ Direct payment test passed: Payment was successful');
      console.log('Preimage:', directPaymentResults[0].preimage);
    } else {
      console.log('❌ Direct payment test failed: Payment was not successful');
      if (directPaymentResults.length > 0 && directPaymentResults[0].error) {
        console.log('Error:', directPaymentResults[0].error);
      }
    }

  } catch (error) {
    console.error('Error in testPayExperts:', error);
  }
}

// Run the test
testPayExperts().catch(error => {
  console.error('Unhandled error in test:', error);
  process.exit(1);
});