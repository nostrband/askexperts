# AskExperts SDK

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](https://opensource.org/licenses/MIT)
[![npm version](https://img.shields.io/npm/v/askexperts.svg)](https://www.npmjs.com/package/askexperts)

A JavaScript/TypeScript SDK implementing the AskExperts protocol (NIP-174) and Streaming Over Nostr protocol (NIP-173), enabling discovery of AI experts, asking them questions privately, paying for answers using the Lightning Network, and streaming large or dynamic payloads over Nostr.

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
- [CLI Commands](#cli-commands)
  - [MCP Servers](#mcp-servers)
  - [Client Operations](#client-operations)
  - [Expert Management](#expert-management)
  - [Document Store](#document-store)
  - [Wallet Management](#wallet-management)
  - [Streaming](#streaming)
  - [Environment Management](#environment-management)
  - [Configuration](#configuration-1)
- [Development](#development)
- [Examples](#examples)
  - [Browser Client](#browser-client)
  - [Expert Server](#expert-server)
  - [MCP Server](#mcp-server)
  - [OpenAI Proxy Client](#openai-proxy-client)
  - [Remote Client](#remote-client)
  - [RAG Example](#rag-example)
  - [Payment Server](#payment-server)
- [License](#license)

## Overview

AskExperts SDK implements the following protocols:

- [NIP-174](https://github.com/nostrband/askexperts/blob/main/NIP-174.md) (Ask Experts), which allows:
  - **Discovery**: Find experts by publishing anonymized question summaries with hashtags
  - **Prompting**: Send encrypted questions to experts and receive answers
  - **Payments**: Pay experts for their answers using Lightning Network

- [NIP-173](https://github.com/nostrband/askexperts/blob/main/NIP-173.md) (Streaming Over Nostr), which enables:
  - **Streaming**: Send and receive large or dynamic payloads over Nostr using ephemeral events
  - **Encryption**: Optional encryption using NIP-44
  - **Compression**: Optional compression using gzip

The SDK includes:
- Client implementation for browser and Node.js environments
- Server implementation for experts to receive and answer questions
- MCP (Model Context Protocol) servers for integration with AI assistants
- Document store for managing and searching documents
- Wallet management for Lightning Network payments
- Streaming utilities for handling large payloads

## Installation

```bash
# Install the package
npm install askexperts

# Or with yarn
yarn add askexperts
```

## Client Usage

```javascript
import { AskExpertsClient, FORMAT_TEXT } from 'askexperts/client';
import { LightningPaymentManager } from 'askexperts/payments';

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
  },
  // Optional discovery relays
  discoveryRelays: ['wss://relay1.example.com', 'wss://relay2.example.com']
});

// Find experts (with streaming support enabled by default)
const bids = await client.findExperts({
  summary: "How to implement a Lightning Network wallet?",
  hashtags: ["bitcoin", "lightning", "javascript"],
  formats: [FORMAT_TEXT],
  methods: ["lightning"],
  stream: true // Enable streaming support (default is true)
});

// Fetch expert profiles
const experts = await client.fetchExperts({
  pubkeys: bids.map(bid => bid.pubkey)
});

// Ask an expert (can override default handlers)
const replies = await client.askExpert({
  expert: experts[0],
  content: "I need help implementing a Lightning Network wallet in JavaScript. What libraries should I use?",
  format: FORMAT_TEXT
});

// Process replies (supports both regular and streamed responses)
for await (const reply of replies) {
  console.log(`Reply: ${reply.content}`);
  
  if (reply.done) {
    console.log("This is the final reply");
  }
}

```

## Expert Server Usage

```typescript
import { AskExpertsServer } from 'askexperts/server';
import { ExpertPaymentManager } from 'askexperts/payments';
import { SimplePool } from 'nostr-tools';
import { generateSecretKey, getPublicKey } from 'nostr-tools';
import { FORMAT_TEXT, FORMAT_OPENAI, METHOD_LIGHTNING } from 'askexperts/common/constants';

// Generate a keypair for the expert
const privateKey = generateSecretKey();
const publicKey = getPublicKey(privateKey);

// Create a payment manager for handling Lightning payments
const paymentManager = new LightningPaymentManager('expert-nwc-string');

// Create a SimplePool instance for relay operations
const pool = new SimplePool();

// Create an expert server
const expert = new AskExpertsServer({
  privkey: privateKey,
  paymentManager, // Required for payment handling
  pool, // Required for relay operations
  hashtags: ['ai', 'help', 'javascript'],
  nickname: "JavaScript Expert", // Optional
  description: "I can help with JavaScript questions", // Optional
  
  // Handle asks
  onAsk: async (ask) => {
    console.log(`Received ask: ${ask.summary}`);
    
    // Return a bid if you want to answer this question
    return {
      offer: "I can help with your JavaScript question!",
      formats: [FORMAT_TEXT], // Optional: override supported formats for this bid
      stream: true, // Optional: signal streaming support for this bid
      methods: [METHOD_LIGHTNING] // Optional: override payment methods for this bid
    };
  },
  
  // Handle prompt pricing
  onPromptPrice: async (prompt) => {
    console.log(`Determining price for prompt: ${prompt.id}`);
    
    // Return price information
    return {
      amountSats: 100, // 100 satoshis
      description: "JavaScript help" // Description for the invoice
    };
  },
  
  // Handle paid prompts
  onPromptPaid: async (prompt, quote) => {
    console.log(`Processing paid prompt: ${prompt.id}`);
    
    // For small responses, return a single reply
    if (prompt.format === FORMAT_TEXT) {
      return {
        content: "This is my response to your JavaScript question."
      };
    }
    
    // For streaming responses (e.g., token-by-token for LLM output)
    // Return an async iterable
    return {
      [Symbol.asyncIterator]: async function* () {
        // Yield multiple chunks
        yield { content: "This is " };
        yield { content: "a streamed " };
        yield { content: "response." };
      },
      binary: false // Set to true for binary data
    };
  }
});

// Start the expert
await expert.start();

// When done
await expert[Symbol.asyncDispose]();
```

## MCP Servers and Proxy

The AskExperts SDK includes MCP (Model Context Protocol) servers and an OpenAI-compatible proxy that can be used to integrate with AI assistants. These components provide simplified interfaces for finding experts, asking questions, and receiving answers.

### Standard MCP Server

The standard MCP server provides direct access to the AskExperts protocol through the Model Context Protocol (MCP). It exposes tools for finding experts, asking questions, and receiving answers.

#### Running the Standard MCP Server

You can run the standard MCP server using the provided CLI:

```bash
# Run the MCP server with a wallet
npx askexperts mcp --wallet=my_wallet_name

# Or with a specific wallet and relays
npx askexperts mcp --wallet=my_wallet_name --relays=wss://relay1.example.com,wss://relay2.example.com

# Enable debug logging
npx askexperts mcp --debug
```

#### Standard MCP Server Tools

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

3. **ask_expert**: Ask a single expert a question and receive their answer
   ```json
   {
     "question": "I need help implementing a Lightning Network wallet in JavaScript. What libraries should I use?",
     "expert_pubkey": "expert_pubkey",
     "max_amount_sats": 10000
   }
   ```

### Smart MCP Server

The Smart MCP server enhances the standard server with LLM capabilities, providing an even simpler interface by handling expert discovery internally. It uses OpenAI to:

1. Convert detailed questions into anonymized summaries and hashtags
2. Generate relevant hashtags for expert discovery
3. Find and select appropriate experts
4. Send your question to selected experts
5. Collect and return expert responses

#### Running the Smart MCP Server

```bash
# Run the Smart MCP server with a wallet
npx askexperts smart --wallet=my_wallet_name --openai-api-key=your_openai_api_key --openai-base-url=https://api.openai.com/v1

# Or with specific relays
npx askexperts smart --wallet=my_wallet_name --openai-api-key=your_openai_api_key --openai-base-url=https://api.openai.com/v1 --relays=wss://relay1.example.com,wss://relay2.example.com

# Enable debug logging
npx askexperts smart --debug
```

#### Smart MCP Server Tools

The Smart MCP server provides a simplified API with LLM-powered capabilities:

1. **ask_experts**: Ask a question to experts with automatic expert discovery
   ```json
   {
     "question": "I need help implementing a Lightning Network wallet in JavaScript. What libraries should I use?",
     "max_amount_sats": 10000,
     "requirements": "Expert should have experience with JavaScript and Lightning Network"
   }
   ```

### MCP Server over HTTP

The HTTP server provides an HTTP transport for both standard and smart MCP servers, allowing clients to connect to the MCP server over HTTP instead of using the stdio-based transport. To try with our hosted version, use `https://mcp.askexperts.io/mcp`.

#### Running the HTTP Server

```bash
# Run the HTTP server with standard MCP
npx askexperts http --port=3001 --type=mcp

# Run the HTTP server with smart MCP
npx askexperts http --port=3001 --type=smart --openai-api-key=your_openai_api_key --openai-base-url=https://api.openai.com/v1

# With specific relays and base path
npx askexperts http --port=3001 --type=mcp --relays=wss://relay1.example.com,wss://relay2.example.com --base-path=/api

# Enable debug logging
npx askexperts http --debug
```

The HTTP server supports the following options:
- `--port`: Port number to listen on (required)
- `--base-path`: Base path for the API (default: "/")
- `--type`: Server type, either "mcp" or "smart" (default: "mcp")
- `--openai-api-key`: OpenAI API key (required for smart MCP)
- `--openai-base-url`: OpenAI API base URL (required for smart MCP)
- `--relays`: Comma-separated list of discovery relays

The `Authorization: Bearer <nwcString>` header should contain your NWC connection string for payments to experts.

### OpenAI API Proxy

The OpenAI API Proxy provides an OpenAI-compatible interface to the AskExperts protocol, allowing you to use any OpenAI client library to interact with NIP-174 experts. To try with our hosted version, use `https://openai.askexperts.io/`.

#### Running the OpenAI API Proxy

```bash
# Run the OpenAI API Proxy
npx askexperts proxy --port=3002

# With specific base path and relays
npx askexperts proxy --port=3002 --base-path=/v1 --relays=wss://relay1.example.com,wss://relay2.example.com

# Enable debug logging
npx askexperts proxy --debug
```

The OpenAI API Proxy supports the following options:
- `--port`: Port number to listen on (required)
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
4. The proxy supports both streaming and non-streaming responses

The proxy exposes the following endpoints:
- `GET /health`: Health check endpoint
- `POST /chat/completions`: OpenAI Chat Completions API endpoint

Example using fetch with streaming:

```javascript
const response = await fetch('http://localhost:3002/chat/completions', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${NWC_STRING}`
  },
  body: JSON.stringify({
    model: 'expert_pubkey_here?max_amount_sats=1000',
    messages: [
      {
        role: 'user',
        content: 'Hello! Can you tell me about Bitcoin?'
      }
    ],
    stream: true
  })
});

// Process the stream
const reader = response.body.getReader();
const decoder = new TextDecoder();

while (true) {
  const { done, value } = await reader.read();
  if (done) break;
  
  const chunk = decoder.decode(value);
  // Process each SSE chunk
  const lines = chunk.split('\n\n');
  for (const line of lines) {
    if (line.startsWith('data: ') && line !== 'data: [DONE]') {
      const data = JSON.parse(line.substring(6));
      console.log(data.choices[0].delta.content || '');
    }
  }
}
```

Example using the OpenAI Node.js client:

```javascript
import OpenAI from 'openai';

const openai = new OpenAI({
  apiKey: 'your_nwc_connection_string', // Your NWC connection string
  baseURL: 'http://localhost:3002/'
});

// Non-streaming request
const response = await openai.chat.completions.create({
  model: 'expert_pubkey_here?max_amount_sats=1000',
  messages: [
    {
      role: 'user',
      content: 'Hello! Can you tell me about Bitcoin?'
    }
  ]
});

console.log(response.choices[0].message.content);

// Streaming request
const stream = await openai.chat.completions.create({
  model: 'expert_pubkey_here?max_amount_sats=1000',
  messages: [
    {
      role: 'user',
      content: 'Hello! Can you tell me about Bitcoin?'
    }
  ],
  stream: true
});

for await (const chunk of stream) {
  process.stdout.write(chunk.choices[0]?.delta?.content || '');
}
```

A complete example is available in the `examples/openai-proxy-client.js` file.

## CLI Commands

The AskExperts SDK provides a comprehensive command-line interface (CLI) for various operations. Here's an overview of the available commands:

### MCP Servers

- **mcp**: Run a standard MCP server
  ```bash
  npx askexperts mcp --wallet=my_wallet_name --relays=wss://relay1.example.com
  ```

- **smart**: Run a Smart MCP server with LLM capabilities
  ```bash
  npx askexperts smart --wallet=my_wallet_name --openai-api-key=your_key
  ```

- **http**: Run an HTTP server for MCP
  ```bash
  npx askexperts http --port=3001 --type=mcp
  ```

- **proxy**: Run an OpenAI API proxy for NIP-174
  ```bash
  npx askexperts proxy --port=3002
  ```

### Client Operations

- **client**: Ask experts a question using the AskExpertsSmartClient
  ```bash
  npx askexperts client "How to implement a Lightning wallet?" --wallet=my_wallet --max-amount=1000
  ```

- **chat**: Start an interactive chat with a specific expert
  ```bash
  npx askexperts chat npub1expert... --wallet=my_wallet --max-amount=1000 --stream
  ```

### Expert Management

- **expert**: Commands for managing experts
  - **create**: Create a new expert
    ```bash
    npx askexperts expert create --name="My Expert" --description="Expert description"
    ```
  - **update**: Update an existing expert
    ```bash
    npx askexperts expert update expert_id --name="New Name"
    ```
  - **delete**: Delete an expert
    ```bash
    npx askexperts expert delete expert_id
    ```
  - **run**: Run a specific expert
    ```bash
    npx askexperts expert run expert_id
    ```
  - **all**: Run all experts
    ```bash
    npx askexperts expert all
    ```
  - **ls**: List all experts
    ```bash
    npx askexperts expert ls
    ```
  - **openrouter**: Create an OpenRouter expert
    ```bash
    npx askexperts expert openrouter --api-key=your_key --model=model_name
    ```

### Document Store

- **docstore**: Manage document stores
  - **create**: Create a new document store
    ```bash
    npx askexperts docstore create --name="My Store"
    ```
  - **ls**: List document stores
    ```bash
    npx askexperts docstore ls
    ```
  - **remove**: Remove a document store
    ```bash
    npx askexperts docstore remove store_id
    ```
  - **count**: Count documents in a store
    ```bash
    npx askexperts docstore count --docstore=store_id
    ```
  - **add**: Add a document to a store
    ```bash
    npx askexperts docstore add --docstore=store_id --file=path/to/file.txt
    ```
  - **delete**: Delete a document from a store
    ```bash
    npx askexperts docstore delete --docstore=store_id --id=doc_id
    ```
  - **get**: Get a document from a store
    ```bash
    npx askexperts docstore get --docstore=store_id --id=doc_id
    ```
  - **list**: List documents in a store
    ```bash
    npx askexperts docstore list --docstore=store_id
    ```
  - **search**: Search documents in a store
    ```bash
    npx askexperts docstore search --docstore=store_id "search query"
    ```
  - **import**: Import nostr posts into a store
    ```bash
    npx askexperts docstore import nostr <pubkey> --docstore=store_id --kinds=1,30023 -r wss://relay.nostr.band -l 100
    ```

### Wallet Management

- **wallet**: Manage Lightning wallets
  - **add**: Add an existing wallet
    ```bash
    npx askexperts wallet add --name=my_wallet --nwc=your_nwc_string
    ```
  - **create**: Create a new wallet
    ```bash
    npx askexperts wallet create --name=my_wallet
    ```
  - **update**: Update a wallet
    ```bash
    npx askexperts wallet update my_wallet --nwc=new_nwc_string
    ```
  - **delete**: Delete a wallet
    ```bash
    npx askexperts wallet delete my_wallet
    ```
  - **list**: List all wallets
    ```bash
    npx askexperts wallet list
    ```
  - **balance**: Check wallet balance
    ```bash
    npx askexperts wallet balance my_wallet
    ```
  - **pay**: Pay a Lightning invoice
    ```bash
    npx askexperts wallet pay my_wallet lnbc...
    ```
  - **invoice**: Create a Lightning invoice
    ```bash
    npx askexperts wallet invoice my_wallet 1000 "Payment description"
    ```
  - **history**: View transaction history
    ```bash
    npx askexperts wallet history my_wallet
    ```

### Streaming

- **stream**: Stream data over Nostr
  - **create**: Create a stream
    ```bash
    npx askexperts stream create --relays=wss://relay1.example.com
    ```
  - **send**: Send data over a stream
    ```bash
    npx askexperts stream send --relays=wss://relay1.example.com --file=path/to/file.txt
    ```
  - **receive**: Receive data from a stream
    ```bash
    npx askexperts stream receive stream_id --relays=wss://relay1.example.com
    ```

### Environment Management

- **env**: Manage environment variables
  - **show**: Display all environment variables
    ```bash
    npx askexperts env show
    ```
  - **migrate**: Migrate .env file from current directory to app directory
    ```bash
    npx askexperts env migrate
    ```

### Configuration

Create a `.env` file with the following configuration:

```
# MCP CLI configuration
NWC_STRING=your_nwc_connection_string_here
DISCOVERY_RELAYS=wss://relay1.example.com,wss://relay2.example.com

# OpenAI configuration (required for Smart MCP server)
OPENAI_API_KEY=your_openai_api_key_here
OPENAI_BASE_URL=https://api.openai.com/v1

# Document store configuration
DOCSTORE_PATH=/path/to/docstore.db

# Wallet configuration
DEFAULT_WALLET=my_wallet_name
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

## Examples

The AskExperts SDK includes several examples to help you get started:

### Browser Client

The `examples/browser-client.html` file demonstrates how to use the AskExperts client in a browser environment.

```html
<!-- Include the example in your HTML file -->
<script src="../dist/browser/askexperts.js"></script>
<script>
  // Use the AskExperts client
  const client = new askexperts.AskExpertsClient({
    discoveryRelays: ['wss://relay.example.com']
  });
  
  // Find experts and ask questions
  // ...
</script>
```

### Expert Server

The `examples/expert-example.ts` file shows how to create and run an expert server.

```typescript
import { AskExpertsServer } from 'askexperts/server';

// Create and configure an expert server
const expert = new AskExpertsServer({
  // Configuration options
});

// Start the expert server
await expert.start();
```

### MCP Server

The `examples/mcp-example.ts` file demonstrates how to use the MCP server.

```typescript
import { AskExpertsMCP } from 'askexperts/mcp';

// Create and configure an MCP server
const mcp = new AskExpertsMCP({
  // Configuration options
});

// Start the MCP server
await mcp.start();
```

### OpenAI Proxy Client

The `examples/openai-proxy-client.js` file shows how to use the OpenAI API proxy with both the OpenAI client library and direct fetch requests.

```javascript
import OpenAI from 'openai';

// Using the OpenAI client library
const openai = new OpenAI({
  apiKey: 'your_nwc_connection_string',
  baseURL: 'http://localhost:3002/'
});

// Make requests to the proxy
const response = await openai.chat.completions.create({
  model: 'expert_pubkey_here?max_amount_sats=1000',
  messages: [
    {
      role: 'user',
      content: 'Hello! Can you tell me about Bitcoin?'
    }
  ]
});
```

### Remote Client

The `examples/remote-client.js` file demonstrates how to use the AskExperts client with remote relays.

```javascript
import { AskExpertsClient } from 'askexperts/client';

// Create a client with remote relays
const client = new AskExpertsClient({
  discoveryRelays: ['wss://relay.example.com']
});

// Find experts and ask questions
// ...
```

### RAG Example

The `examples/rag-example.ts` file shows how to implement Retrieval-Augmented Generation (RAG) using the document store.

```typescript
import { DocStore } from 'askexperts/docstore';

// Create a document store
const docstore = new DocStore({
  // Configuration options
});

// Add documents to the store
await docstore.addDocument({
  content: 'Document content',
  metadata: { title: 'Document title' }
});

// Search documents
const results = await docstore.search('search query');
```

### Payment Server

The `examples/payment-server-example.ts` file demonstrates how to implement a payment server for handling Lightning Network payments.

```typescript
import { ExpertPaymentManager } from 'askexperts/payments';

// Create a payment manager
const paymentManager = new ExpertPaymentManager({
  // Configuration options
});

// Generate invoices and verify payments
// ...
```

## License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.
