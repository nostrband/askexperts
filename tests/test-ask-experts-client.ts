/**
 * Test file for AskExpertsClient
 */

import { Quote, Proof, Prompt } from '../src/common/types.js';
import { AskExpertsClient } from '../src/client/index.js';
import * as bolt11 from 'light-bolt11-decoder';

/**
 * Example of using AskExpertsClient to find experts, fetch their profiles, and ask questions
 */
async function testAskExpertsClient() {
  try {
    console.log('Creating AskExpertsClient...');
    const client = new AskExpertsClient();

    // Step 1: Find experts by publishing an ask event
    console.log('Finding experts...');
    const bids = await client.findExperts({
      summary: 'What is the meaning of life?',
      hashtags: ['philosophy', 'life', 'test'],
      formats: ['text'],
      methods: ['lightning'],
    });

    console.log(`Found ${bids.length} bids from experts`);
    
    if (bids.length === 0) {
      console.log('No bids received. Exiting test.');
      return;
    }

    // Print the bids
    bids.forEach((bid, index) => {
      console.log(`\nBid #${index + 1}:`);
      console.log(`  Expert: ${bid.pubkey}`);
      console.log(`  Offer: ${bid.offer}`);
      console.log(`  Formats: ${bid.formats.join(', ')}`);
      console.log(`  Stream: ${bid.stream}`);
      console.log(`  Methods: ${bid.methods.join(', ')}`);
      console.log(`  Relays: ${bid.relays.join(', ')}`);
    });

    // Step 2: Fetch expert profiles
    console.log('\nFetching expert profiles...');
    const expertPubkeys = bids.map(bid => bid.pubkey);
    const experts = await client.fetchExperts({
      pubkeys: expertPubkeys,
    });

    console.log(`Fetched ${experts.length} expert profiles`);
    
    // Print the expert profiles
    experts.forEach((expert, index) => {
      console.log(`\nExpert #${index + 1}:`);
      console.log(`  Pubkey: ${expert.pubkey}`);
      console.log(`  Description: ${expert.description}`);
      console.log(`  Hashtags: ${expert.hashtags.join(', ')}`);
      console.log(`  Formats: ${expert.formats.join(', ')}`);
      console.log(`  Stream: ${expert.stream}`);
      console.log(`  Methods: ${expert.methods.join(', ')}`);
      console.log(`  Relays: ${expert.relays.join(', ')}`);
    });

    // Step 3: Ask a question to the first expert
    if (experts.length > 0) {
      const expert = experts[0];
      console.log(`\nAsking a question to expert ${expert.pubkey}...`);
      
      // Define the onQuote callback - returns boolean to accept/reject payment
      const onQuote = async (quote: Quote, prompt: Prompt): Promise<boolean> => {
        console.log('Received quote from expert:');
        
        // Check if there are any issues with the quote
        // Note: The Quote interface doesn't have an error property directly
        // This is just a safety check for the test
        
        if (!quote.invoices || quote.invoices.length === 0) {
          console.log('  No invoices provided');
          return false; // Reject payment
        }
        
        const invoice = quote.invoices[0];
        console.log(`  Method: ${invoice.method}`);
        console.log(`  Amount: ${invoice.amount} ${invoice.unit}`);
        
        if (invoice.invoice) {
          console.log(`  Invoice: ${invoice.invoice}`);
          
          try {
            // Parse the invoice
            const decoded = bolt11.decode(invoice.invoice);
            console.log(`  Decoded payment hash: ${decoded.sections.find(s => s.name === 'payment_hash')?.value}`);
            
            // For testing, we'll accept the payment
            return true;
          } catch (error) {
            console.error('Error decoding invoice:', error);
            return false; // Reject payment
          }
        } else {
          return false; // Reject payment
        }
      };
      
      // Define the onPay callback - processes payment and returns proof
      const onPay = async (quote: Quote, prompt: Prompt): Promise<Proof> => {
        console.log('Processing payment...');
        
        const invoice = quote.invoices[0];
        
        // In a real implementation, you would pay the invoice here
        // and get the preimage from the payment result
        
        // For testing, we'll just return a fake preimage
        // This will cause the expert to reject the proof in a real scenario
        const fakePreimage = '0000000000000000000000000000000000000000000000000000000000000000';
        
        return {
          method: 'lightning',
          preimage: fakePreimage,
        };
      };
      
      // Ask the question
      const replies = await client.askExpert({
        expert,
        content: 'What is the meaning of life? I have been pondering this question for a while.',
        format: 'text',
        onQuote,
        onPay,
      });
      
      // Process the replies
      console.log('\nReceiving replies:');
      for await (const reply of replies) {
        console.log('\nReceived reply:');
        
        // Display the reply content
        console.log(`  Content: ${reply.content}`);
        
        console.log(`  Done: ${reply.done}`);
      }
      
      console.log('\nAll replies received');
    }

  } catch (error) {
    console.error('Error in testAskExpertsClient:', error);
  }
}

// Run the test
testAskExpertsClient().catch(error => {
  console.error('Unhandled error in test:', error);
  process.exit(1);
});