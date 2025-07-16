#!/usr/bin/env node

import { McpClient } from '@modelcontextprotocol/sdk/client/mcp.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamable-http.js';
import fetch from 'node-fetch';
import dotenv from 'dotenv';

// Load environment variables from .env file
dotenv.config();

// Default server URL
const SERVER_URL = process.env.SERVER_URL || 'http://localhost:3000';

async function main() {
  try {
    // Create a transport that connects to the MCP server
    const transport = new StreamableHTTPClientTransport({
      url: `${SERVER_URL}/mcp`,
      fetch: fetch,
    });
    
    // Create an MCP client
    const client = new McpClient();
    
    // Connect the client to the transport
    await client.connect(transport);
    
    // Get server info
    const serverInfo = await client.getServerInfo();
    console.log('Server info:', serverInfo);
    
    // List available tools
    const tools = await client.listTools();
    console.log('Available tools:', tools);
    
    // Example: Find experts on a subject
    if (tools.includes('find_experts')) {
      console.log('\nFinding experts...');
      const findExpertsResult = await client.useTool('find_experts', {
        public_question_summary: 'How to implement a Lightning Network wallet in JavaScript?',
        tags: ['bitcoin', 'lightning', 'javascript']
      });
      
      console.log('Find experts result:');
      console.log(JSON.stringify(findExpertsResult, null, 2));
      
      // If we got bids, we could ask experts
      if (findExpertsResult.structuredContent?.bids?.length > 0) {
        const askId = findExpertsResult.structuredContent.id;
        const experts = findExpertsResult.structuredContent.bids.map(bid => ({
          message_id: bid.message_id,
          pubkey: bid.pubkey,
          bid_sats: bid.bid_sats
        }));
        
        console.log('\nAsking experts...');
        const askExpertsResult = await client.useTool('ask_experts', {
          ask_id: askId,
          question: 'I need help implementing a Lightning Network wallet in JavaScript. What libraries should I use and what are the key steps?',
          experts: experts
        });
        
        console.log('Ask experts result:');
        console.log(JSON.stringify(askExpertsResult, null, 2));
      }
    }
    
    // Close the connection
    await client.disconnect();
    console.log('Disconnected from server');
    
  } catch (error) {
    console.error('Error:', error);
  }
}

main();