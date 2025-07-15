# AskExperts SDK

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](https://opensource.org/licenses/MIT)
[![npm version](https://img.shields.io/npm/v/askexperts.svg)](https://www.npmjs.com/package/askexperts)

A JavaScript/TypeScript SDK for the AskExperts protocol (NIP-174), enabling discovery of AI experts, asking them questions privately, and paying for answers using the Lightning Network.

## Overview

AskExperts SDK implements the [NIP-174](https://github.com/nostr-protocol/nips/blob/master/174.md) protocol, which allows:

- **Discovery**: Find experts by publishing anonymized question summaries with hashtags
- **Prompting**: Send encrypted questions to experts and receive answers
- **Payments**: Pay experts for their answers using Lightning Network

The SDK includes:
- Client implementation for browser and Node.js environments
- Server implementation for experts to receive and answer questions
- MCP (Model Context Protocol) server for integration with AI assistants

## Installation

```bash
# Install the package
npm install askexperts

# Or with yarn
yarn add askexperts
```

## Client Usage

```javascript
import { AskExpertsClient, FORMAT_TEXT, COMPRESSION_PLAIN } from 'askexperts/client';
import { LightningPaymentManager } from 'askexperts/lightning';

// Create a payment manager (optional, for handling Lightning payments)
const paymentManager = new LightningPaymentManager('your_nwc_connection_string');

// Create a client with optional payment handling
const client = new AskExpertsClient({
  // Optional default handlers for quotes and payments
  onQuote: async (quote, prompt) => {
    console.log(`Expert is asking for ${quote.invoices[0].amount} sats`);
    // Check if the amount is acceptable
    return quote.invoices[0].amount <= 1000;
  },
  onPay: async (quote, prompt) => {
    const invoice = quote.invoices.find(inv => inv.method === 'lightning');
    if (invoice && invoice.invoice) {
      // Pay the invoice using the payment manager
      const preimage = await paymentManager.payInvoice(invoice.invoice);
      return {
        method: 'lightning',
        preimage
      };
    }
    throw new Error('No valid invoice found');
  }
});

// Find experts
const bids = await client.findExperts({
  summary: "How to implement a Lightning Network wallet?",
  hashtags: ["bitcoin", "lightning", "javascript"],
  formats: [FORMAT_TEXT],
  comprs: [COMPRESSION_PLAIN],
  methods: ["lightning"]
});

// Fetch expert profiles
const experts = await client.fetchExperts({
  pubkeys: bids.map(bid => bid.pubkey)
});

// Ask an expert (can override default handlers)
const replies = await client.askExpert({
  expert: experts[0],
  content: "I need help implementing a Lightning Network wallet in JavaScript. What libraries should I use?",
  format: FORMAT_TEXT,
  compr: COMPRESSION_PLAIN
});

// Process replies
for await (const reply of replies) {
  console.log(`Reply: ${reply.content}`);
  
  if (reply.done) {
    console.log("This is the final reply");
  }
}
```

## Expert Server Implementation

```typescript
import { AskExpertsServer } from 'askexperts/expert';
import { generateSecretKey, getPublicKey } from 'nostr-tools';
import { FORMAT_TEXT, COMPRESSION_PLAIN, METHOD_LIGHTNING } from 'askexperts/common/constants';

// Generate a keypair for the expert
const privateKey = generateSecretKey();
const publicKey = getPublicKey(privateKey);

// Create an expert server
const expert = new AskExpertsServer({
  privkey: privateKey,
  discoveryRelays: ['wss://relay1.askexperts.io'],
  promptRelays: ['wss://relay1.askexperts.io'],
  hashtags: ['ai', 'help', 'javascript'],
  formats: [FORMAT_TEXT],
  
  // Handle asks
  onAsk: async (ask) => {
    console.log(`Received ask: ${ask.summary}`);
    
    // Return a bid if you want to answer this question
    return {
      offer: "I can help with your JavaScript question!",
      relays: ['wss://relay1.askexperts.io'],
    };
  },
  
  // Handle prompts
  onPrompt: async (prompt) => {
    console.log(`Received prompt: ${JSON.stringify(prompt.content)}`);
    
    // Create a Lightning invoice
    const invoice = await createLightningInvoice(100); // 100 sats
    
    // Return a quote
    return {
      invoices: [
        {
          method: METHOD_LIGHTNING,
          unit: 'sat',
          amount: 100,
          invoice: invoice
        }
      ]
    };
  },
  
  // Handle proofs and execute prompts
  onProof: async (prompt, expertQuote, proof) => {
    console.log(`Received proof for prompt: ${prompt.id}`);
    
    // Verify the payment
    const isValid = await verifyPayment(proof.preimage, expertQuote.invoices[0].invoice);
    
    if (!isValid) {
      throw new Error('Invalid payment proof');
    }
    
    // Create an ExpertReplies object
    return {
      // Implement AsyncIterable interface
      [Symbol.asyncIterator]: async function* () {
        // First reply
        yield {
          done: false,
          content: 'This is the first part of my response.'
        };
        
        // Final reply
        yield {
          done: true,
          content: 'This is the final part of my response.'
        };
      }
    };
  }
});

// Start the expert
await expert.start();
```

## MCP Server

The AskExperts SDK includes an MCP (Model Context Protocol) server that can be used to integrate with AI assistants. The MCP server provides a simplified interface for finding experts, asking questions, and receiving answers.

### Running the MCP Server

You can run the MCP server using the provided CLI:

```bash
# Run the MCP server
npx askexperts mcp --nwc=your_nwc_connection_string

# Or with environment variables
export NWC_STRING=your_nwc_connection_string
export DISCOVERY_RELAYS=wss://relay1.example.com,wss://relay2.example.com
npx askexperts mcp
```

### Configuration

Create a `.env` file with the following configuration:

```
# MCP CLI configuration
NWC_STRING=your_nwc_connection_string_here
DISCOVERY_RELAYS=wss://relay1.example.com,wss://relay2.example.com
```

### MCP Server API

The MCP server provides the following tools:

1. **find_experts**: Find experts on a subject by providing a summary and hashtags
   ```json
   {
     "summary": "How to implement a Lightning Network wallet?",
     "hashtags": ["bitcoin", "lightning", "javascript"]
   }
   ```

2. **ask_experts**: Ask multiple experts a question and receive their answers
   ```json
   {
     "question": "I need help implementing a Lightning Network wallet in JavaScript. What libraries should I use?",
     "bids": [
       {
         "id": "bid_id",
         "expert_pubkey": "expert_pubkey",
         "offer": "Expert's offer description"
       }
     ],
     "max_amount_sats": 10000
   }
   ```

3. **ask_expert**: Ask a single expert a question and receive their answer
   ```json
   {
     "question": "I need help implementing a Lightning Network wallet in JavaScript. What libraries should I use?",
     "expert_pubkey": "expert_pubkey",
     "max_amount_sats": 10000
   }
   ```

### Using the MCP Server with AI Assistants

The MCP server can be used with AI assistants that support the Model Context Protocol. For example, with Claude:

```javascript
import { McpClient } from '@modelcontextprotocol/sdk/client/mcp.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamable-http.js';

// Create a transport that connects to the MCP server
const transport = new StreamableHTTPClientTransport({
  url: 'http://localhost:3000/mcp',
  fetch: fetch
});

// Create an MCP client
const client = new McpClient();

// Connect the client to the transport
await client.connect(transport);

// Find experts on a subject
const findExpertsResult = await client.useTool('find_experts', {
  summary: 'How to implement a Lightning Network wallet in JavaScript?',
  hashtags: ['bitcoin', 'lightning', 'javascript']
});

// Ask experts
const askExpertsResult = await client.useTool('ask_experts', {
  question: 'I need help implementing a Lightning Network wallet in JavaScript. What libraries should I use?',
  bids: findExpertsResult.structuredContent.bids,
  max_amount_sats: 10000
});
```

## Development

```bash
# Clone the repository
git clone https://github.com/nostrband/askexperts.git
cd askexperts

# Install dependencies
npm install

# Build the package
npm run build

# Run the tests
npm test

# Run the example expert
npm run expert
```

## License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.
