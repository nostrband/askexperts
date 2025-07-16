#!/usr/bin/env node

/**
 * Example client for the OpenAI proxy
 * 
 * This example demonstrates how to use the OpenAI proxy with a standard OpenAI client.
 * It sends a request to the proxy, which forwards it to an expert via NIP-174.
 * 
 * Usage:
 * 1. Start the proxy server: node bin/askexperts proxy
 * 2. Run this example: node examples/openai-proxy-client.js
 */

import fetch from 'node-fetch';
import dotenv from 'dotenv';

// Load environment variables from .env file
dotenv.config();

// Configuration
const PROXY_URL = process.env.PROXY_URL || 'http://localhost:3006/v1';
const NWC_STRING = process.env.NWC_STRING || '';

if (!NWC_STRING) throw new Error("NWC_STRING required");

async function main() {

  console.log("argv", process.argv);
  const EXPERT_PUBKEY = process.argv?.[2];
  if (!EXPERT_PUBKEY) throw new Error("Pass expert pubkey as cli param");

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
        model: EXPERT_PUBKEY, // The expert's pubkey goes in the model field
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