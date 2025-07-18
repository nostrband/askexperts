/**
 * Test for OpenaiExpert class
 */

import { generateSecretKey, getPublicKey } from 'nostr-tools';
import { OpenaiExpert } from '../src/experts/OpenaiExpert.js';
import { SimplePool } from 'nostr-tools';
import { createWallet } from 'nwc-enclaved-utils';
import dotenv from 'dotenv';
import { OpenRouter } from '../src/experts/utils/OpenRouter.js';

// Load environment variables from .env file
dotenv.config();

/**
 * Run the test for OpenaiExpert
 */
async function testOpenaiExpert() {
  console.log('Starting OpenaiExpert test...');

  // Generate a keypair for the expert
  const privateKey = generateSecretKey();
  const publicKey = getPublicKey(privateKey);
  console.log(`Expert pubkey: ${publicKey}`);

  // Create a wallet using nwc-enclaved-utils
  console.log('Creating NWC wallet...');
  const wallet = await createWallet();
  const nwcString = wallet.nwcString;
  console.log('NWC wallet created');

  // Create a pricing provider
  const pricingProvider = new OpenRouter();

  // Create an OpenaiExpert instance
  const expert = new OpenaiExpert({
    privkey: privateKey,
    openaiBaseUrl: process.env.OPENAI_BASE_URL || '',
    openaiApiKey: process.env.OPENAI_API_KEY || '',
    model: 'openai/gpt-4.1',
    nwcString,
    margin: 0.1, // 10% margin
    systemPrompt: 'You are a helpful assistant.',
    pricingProvider,
  });

  try {
    // Start the expert
    console.log('Starting the expert...');
    await expert.start();
    console.log('Expert started successfully');
    
    // In a real scenario, the expert would now be listening for events
    // and handling them through the AskExpertsServer
    console.log('Expert is now listening for events on the configured relays');
    console.log('Test completed successfully');
    
    // Keep the expert running for a short time to demonstrate it's working
    await new Promise(resolve => setTimeout(resolve, 500000));
  } catch (error) {
    console.error('Error during test:', error);
  } finally {
    // Clean up resources
    console.log('Cleaning up resources...');
    expert[Symbol.dispose]();
    console.log('Resources cleaned up');
  }
}

// Run the test
testOpenaiExpert().catch((error) => {
  console.error('Error running OpenaiExpert test:', error);
  process.exit(1);
});