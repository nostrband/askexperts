#!/usr/bin/env node

/**
 * Example client for the OpenAI proxy
 * 
 * This example demonstrates how to use the OpenAI proxy with a standard OpenAI client.
 * It sends a request to the proxy, which forwards it to an expert via NIP-174.
 * 
 * Usage:
 * 1. Start the proxy server: node bin/askexperts proxy
 * 2. Run this example: node examples/openai-proxy-client.js <expert_pubkey> [max_amount_sats]
 *
 * The optional max_amount_sats parameter sets a maximum payment limit in satoshis.
 * If the expert requests more than this amount, the request will be rejected.
 */

import fetch from 'node-fetch';
import dotenv from 'dotenv';

// Load environment variables from .env file
dotenv.config();

// Configuration
const PROXY_URL = process.env.PROXY_URL || 'https://proxy.askexperts.io';
const NWC_STRING = process.env.NWC_STRING || '';

if (!NWC_STRING) throw new Error("NWC_STRING required");

async function main() {

  console.log("argv", process.argv);
  const EXPERT_PUBKEY = process.argv?.[2];
  if (!EXPERT_PUBKEY) throw new Error("Pass expert pubkey as cli param");
  
  // Optional max amount in sats (from command line argument)
  const MAX_AMOUNT_SATS = process.argv?.[3];
  
  // Construct model parameter (with optional max_amount_sats)
  let modelParam = EXPERT_PUBKEY;
  if (MAX_AMOUNT_SATS) {
    modelParam = `${EXPERT_PUBKEY}?max_amount_sats=${MAX_AMOUNT_SATS}`;
  }

  try {
    console.log('Sending request to OpenAI proxy...');

    // Create a request to the OpenAI-compatible endpoint
    const response = await fetch(`${PROXY_URL}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${NWC_STRING}`
      },
      body: JSON.stringify({
        model: modelParam, // The expert's pubkey with optional max_amount_sats parameter
        messages: [
          {
            role: 'user',
            content: 'Hello! Can you tell me about Bitcoin and the Lightning Network?'
          }
        ],
        stream: false // Set to false for non-streaming response
      })
    });
    
    // Parse the response
    const data = await response.json();
    
    if (response.ok) {
      console.log('Response received:');
      console.log(JSON.stringify(data, null, 2));
      
      // Extract the assistant's message
      const assistantMessage = data.choices[0].message.content;
      console.log('\nAssistant\'s response:');
      console.log(assistantMessage);
    } else {
      console.error('Error:', data);
    }
  } catch (error) {
    console.error('Error:', error);
  }
}

main();