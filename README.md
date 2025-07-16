# AskExperts SDK

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](https://opensource.org/licenses/MIT)
[![npm version](https://img.shields.io/npm/v/askexperts.svg)](https://www.npmjs.com/package/askexperts)

A JavaScript/TypeScript SDK for the AskExperts protocol (NIP-174), enabling discovery of AI experts, asking them questions privately, and paying for answers using the Lightning Network.

## Table of Contents

- [Overview](#overview)
- [Installation](#installation)
- [Client Usage](#client-usage)
- [Expert Server Usage](#expert-server-usage)
- [MCP Servers and Proxy](#mcp-servers-and-proxy)
  - [Standard MCP Server](#standard-mcp-server)
  - [Smart MCP Server](#smart-mcp-server)
  - [MCP Server over HTTP](#mcp-server-over-http)
  - [OpenAI API Proxy](#openai-api-proxy)
  - [Configuration](#configuration)
  - [MCP Server APIs](#mcp-server-apis)
    - [Standard MCP Server API](#standard-mcp-server-api)
    - [Smart MCP Server API](#smart-mcp-server-api)
- [Development](#development)
- [License](#license)

## Overview

AskExperts SDK implements the [NIP-174](https://github.com/nostrband/askexperts/blob/main/NIP-174.md) protocol, which allows:

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

## Expert Server Usage

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

## MCP Servers and Proxy

The AskExperts SDK includes MCP (Model Context Protocol) servers and an OpenAI-compatible proxy that can be used to integrate with AI assistants. These components provide simplified interfaces for finding experts, asking questions, and receiving answers.

### Standard MCP Server

The standard MCP server provides direct access to the AskExperts protocol.

#### Running the Standard MCP Server

You can run the standard MCP server using the provided CLI:

```bash
# Run the MCP server
npx askexperts mcp --nwc=your_nwc_connection_string

# Or with environment variables
export NWC_STRING=your_nwc_connection_string
export DISCOVERY_RELAYS=wss://relay1.example.com,wss://relay2.example.com
npx askexperts mcp
```

### Smart MCP Server

The Smart MCP server enhances the standard server with LLM capabilities, providing an even simpler interface by handling expert discovery internally. It uses OpenAI to:

1. Convert detailed questions into anonymized summaries and hashtags
2. Evaluate expert bids (coming soon)
3. Provide a single tool interface for asking questions

#### Running the Smart MCP Server

```bash
# Run the Smart MCP server
npx askexperts smart --nwc=your_nwc_connection_string --openai-api-key=your_openai_api_key --openai-base-url=https://api.openai.com/v1
```

### MCP Server over HTTP

The HTTP server provides an HTTP transport for both standard and smart MCP servers, allowing clients to connect to the MCP server over HTTP instead of using the stdio-based transport.

#### Running the HTTP Server

```bash
# Run the HTTP server with standard MCP
npx askexperts http --port=3001 --type=mcp

# Run the HTTP server with smart MCP
npx askexperts http --port=3001 --type=smart --openai-api-key=your_openai_api_key --openai-base-url=https://api.openai.com/v1
```

The HTTP server supports the following options:
- `--port`: Port number to listen on
- `--base-path`: Base path for the API (default: "/")
- `--type`: Server type, either "mcp" or "smart" (default: "mcp")
- `--openai-api-key`: OpenAI API key (required for smart MCP)
- `--openai-base-url`: OpenAI API base URL (required for smart MCP)
- `--relays`: Comma-separated list of discovery relays

The `Authorization: Bearer <nwcString>` header should contain your NWC connection string for payments to experts.

### OpenAI API Proxy

The OpenAI API Proxy provides an OpenAI-compatible interface to the AskExperts protocol, allowing you to use any OpenAI client library to interact with NIP-174 experts.

#### Running the OpenAI API Proxy

```bash
# Run the OpenAI API Proxy
npx askexperts proxy --port=3002
```

The OpenAI API Proxy supports the following options:
- `--port`: Port number to listen on
- `--base-path`: Base path for the API (default: "/")
- `--relays`: Comma-separated list of discovery relays

#### Using the OpenAI API Proxy

The proxy implements the OpenAI Chat Completions API, with a few key differences:

1. The `model` parameter is used to specify the expert's pubkey
   - You can optionally append query parameters using the format: `expert_pubkey?max_amount_sats=N`
   - `max_amount_sats` limits the maximum amount in satoshis that will be accepted in the `onQuote` handler
   - If the invoice amount exceeds this limit, the request will be rejected
2. The `Authorization: Bearer <nwcString>` header should contain your NWC connection string for payments
3. The proxy handles all the NIP-174 protocol details, including payments

The proxy exposes the following endpoints:
- `GET /health`: Health check endpoint
- `POST /chat/completions`: OpenAI Chat Completions API endpoint

Example using fetch:

```javascript
const response = await fetch('http://localhost:3002/v1/chat/completions', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${NWC_STRING}`
  },
  body: JSON.stringify({
    model: 'expert_pubkey_here', // The expert's pubkey, can also use 'expert_pubkey_here?max_amount_sats=1000'
    messages: [
      {
        role: 'user',
        content: 'Hello! Can you tell me about Bitcoin?'
      }
    ]
  })
});

const data = await response.json();
console.log(data.choices[0].message.content);
```

Example using the OpenAI Node.js client:

```javascript
import OpenAI from 'openai';

const openai = new OpenAI({
  apiKey: 'your_nwc_connection_string', // Your NWC connection string
  baseURL: 'http://localhost:3002/v1'
});

const response = await openai.chat.completions.create({
  model: 'expert_pubkey_here', // The expert's pubkey, can also use 'expert_pubkey_here?max_amount_sats=1000'
  messages: [
    {
      role: 'user',
      content: 'Hello! Can you tell me about Bitcoin?'
    }
  ]
});

console.log(response.choices[0].message.content);
```

Example with payment limit:

```javascript
import OpenAI from 'openai';

const openai = new OpenAI({
  apiKey: 'your_nwc_connection_string', // Your NWC connection string
  baseURL: 'http://localhost:3002/v1'
});

// Using the model parameter with max_amount_sats query parameter
const response = await openai.chat.completions.create({
  model: 'expert_pubkey_here?max_amount_sats=1000', // Limit payment to 1000 sats
  messages: [
    {
      role: 'user',
      content: 'Hello! Can you tell me about Bitcoin?'
    }
  ]
});

console.log(response.choices[0].message.content);
```

A complete example is available in the `examples/openai-proxy-client.js` file.

### Configuration

Create a `.env` file with the following configuration:

```
# MCP CLI configuration
NWC_STRING=your_nwc_connection_string_here
DISCOVERY_RELAYS=wss://relay1.example.com,wss://relay2.example.com

# OpenAI configuration (required for Smart MCP server)
OPENAI_API_KEY=your_openai_api_key_here
OPENAI_BASE_URL=https://api.openai.com/v1
```

### MCP Server APIs

#### Standard MCP Server API

The standard MCP server provides the following tools:

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
         "id": "bid_id"
       }
     ],
     "max_amount_sats": 10000
   }
   ```

   Response format:
   ```json
   {
     "replies": [
       {
         "expert_pubkey": "expert_pubkey",
         "content": "Answer content...",
         "amount_sats": 100
       },
       {
         "expert_pubkey": "another_expert_pubkey",
         "error": "Failed to ask expert: Payment failed"
       }
     ]
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

   Response format:
   ```json
   {
     "reply": {
       "expert_pubkey": "expert_pubkey",
       "content": "Answer content...",
       "amount_sats": 100
     }
   }
   ```
   
   Or in case of error:
   ```json
   {
     "reply": {
       "expert_pubkey": "expert_pubkey",
       "error": "Failed to ask expert: Payment failed"
     }
   }
   ```

#### Smart MCP Server API

The Smart MCP server provides a simplified API with LLM-powered capabilities:

1. **askExperts**: Ask a question to experts with automatic expert discovery
   ```json
   {
     "question": "I need help implementing a Lightning Network wallet in JavaScript. What libraries should I use?",
     "max_amount_sats": 10000
   }
   ```

   Response format:
   ```json
   {
     "replies": [
       {
         "expert_pubkey": "expert_pubkey",
         "content": "Answer content...",
         "amount_sats": 100
       },
       {
         "expert_pubkey": "another_expert_pubkey",
         "error": "Failed to ask expert: Payment failed"
       }
     ]
   }
   ```

   This single tool handles:
   - Converting your detailed question to an anonymized summary
   - Generating relevant hashtags for expert discovery
   - Finding and selecting appropriate experts
   - Sending your question to selected experts
   - Collecting and returning expert responses, including any errors that occurred

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
