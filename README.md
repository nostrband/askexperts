# AskExperts

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](https://opensource.org/licenses/MIT)
[![npm version](https://img.shields.io/npm/v/askexperts.svg)](https://www.npmjs.com/package/askexperts)

Create AI experts, discover them, ask them questions privately and pay for the answers using the Lightning Network.

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
  - [User Management](#user-management)
  - [Environment Management](#environment-management)
  - [Streaming](#streaming)
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

The OpenAI API Proxy provides an OpenAI-compatible interface to the AskExperts protocol, allowing you to use any OpenAI client library to interact with NIP-174 experts. To try with our hosted version, use `https://proxy.askexperts.io/`, the base path is `/api/v1/` (like on OpenRouter).

#### Running the OpenAI API Proxy

```bash
# Run the OpenAI API Proxy
npx askexperts proxy --port=3002

# With specific base path and relays
npx askexperts proxy --port=3002 --base-path=/v1 --relays=wss://relay1.askexperts.io,wss://relay2.askexperts.io

# Enable debug logging
npx askexperts proxy --debug
```

The OpenAI API Proxy supports the following options:
- `--port`: Port number to listen on (required)
- `--base-path`: Base path for the API (default: "/")
- `--relays`: Comma-separated list of discovery relays

#### Using the OpenAI API Proxy

The proxy implements the OpenAI Chat Completions API, with a few key differences:

1. The `model` parameter can contain any well-known name like `openai/gpt-5` and the matching expert will be chosen, or you might use it to specify the expert's pubkey directly:
   - You can optionally append query parameters to the model name using the format: `<well-known-name | expert-pubkey>?max_amount_sats=N`
   - `max_amount_sats` limits the maximum amount in satoshis that will be paid to the expert
   - If the invoice amount exceeds this limit, the request will be rejected
2. The `Authorization: Bearer <nwcString>` header should contain your NWC connection string for payments

The proxy handles all the NIP-174 protocol details, including payments. It supports both streaming and non-streaming responses.

The proxy exposes the following endpoints:
- `GET /health`: Health check endpoint
- `POST /chat/completions`: OpenAI Chat Completions API endpoint
- `GET /models`: List of models, in OpenRouter format

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


## CLI Commands

The AskExperts SDK provides a comprehensive command-line interface (CLI) for various operations. Here's an overview of the available commands:

### MCP Servers

- **mcp**: Run a standard MCP server
  ```bash
  npx askexperts mcp --wallet=my_wallet_name --relays=wss://relay1.example.com
  ```

- **smart**: Run a Smart MCP server with LLM capabilities
  ```bash
  npx askexperts smart --wallet=my_wallet_name --openai-api-key=your_key --openai-base-url=https://api.openai.com/v1
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
  npx askexperts chat <expert-pubkey> --wallet=my_wallet --max-amount=1000 --stream
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
  - **search**: Search for experts
    ```bash
    npx askexperts expert search --hashtags=bitcoin,lightning
    ```
  - **scheduler**: Run expert scheduler
    ```bash
    npx askexperts expert scheduler
    ```
  - **worker**: Run expert worker
    ```bash
    npx askexperts expert worker
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
  - **server**: Run a docstore server
    ```bash
    npx askexperts docstore server --port=3003
    ```
  - **reembed**: Re-embed documents in a store
    ```bash
    npx askexperts docstore reembed --docstore=store_id
    ```
  - **import**: Import data into a store
    - **nostr**: Import Nostr posts
      ```bash
      npx askexperts docstore import nostr <pubkey> --docstore=store_id --kinds=1,30023 -r wss://relay.nostr.band -l 100
      ```
    - **twitter**: Import Twitter data
      ```bash
      npx askexperts docstore import twitter --docstore=store_id
      ```
    - **markdown**: Import markdown files
      ```bash
      npx askexperts docstore import markdown --docstore=store_id --file=path/to/file.md
      ```
    - **dir**: Import directory of files
      ```bash
      npx askexperts docstore import dir --docstore=store_id --path=path/to/directory
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

### User Management

- **user**: Manage users
  - **add**: Add a new user
    ```bash
    npx askexperts user add --pubkey=user_pubkey --privkey=user_privkey
    ```
  - **list**: List all users
    ```bash
    npx askexperts user list
    ```
  - **whoami**: Show the current user
    ```bash
    npx askexperts user whoami
    ```
  - **switch**: Switch to a different user
    ```bash
    npx askexperts user switch user_id
    ```
  - **signup**: Sign up a new user
    ```bash
    npx askexperts user signup
    ```

### Environment Management

- **env**: Manage environment variables
  - **show**: Display all environment variables
    ```bash
    npx askexperts env show
    ```
  - **migrate**: Migrate .env file to app directory
    ```bash
    npx askexperts env migrate --force
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

## HOWTO: launch an AI expert "clone" based on your Nostr posts

Create yourself an NWC-enabled lightning wallet:
```bash
bash$ npx askexperts wallet create main
Creating new NWC wallet...
Wallet 'main' created successfully with ID 1
NWC connection string: nostr+walletconnect://c99a1f0b7390a3db4b09c47f08d4541de1aa9b60ba7a37396554101b7004fb96?relay=...............
```

Topup your wallet with some sats, as LLM access (paid with sats) is needed when expert is launched. Create invoice and pay it:
```bash
bash$ npx askexperts wallet invoice 1000 --desc topup
...
Invoice: lnbc10u1p5fga5lpp5h9440kpfs0km...
...
```

Or, if you already have a wallet (i.e. Alby Hub) - connect it:
```bash
bash$ npx askexperts wallet add main -n "nostr+walletconnect://c99a1f0b7390a3db4b09c47f08d4541de1aa9b60ba7a37396554101b7004fb96?relay=..."
Wallet 'main' added successfully with ID 1
```

Launch chromadb - RAG database to provide relevant context to expert:
```bash
bash$ docker run -p 8000:8000 -v ./data:/data chromadb/chroma
```

Next, create a document store for your documents (Nostr posts, etc):
```bash
bash$ npx askexperts docstore create my-docs
Docstore 'my-docs' created with ID: 6a9a1e51-3219-4e1c-9e13-5e08ef24bfcd
Model: Xenova/all-MiniLM-L6-v2
Vector size: 384
```

Next, import your Nostr posts into your doc store:
```bash
bash$ npx askexperts docstore import nostr <your pubkey> -k 0,1 -l 10000 -d
  ...
  askexperts:docstore Fetched 321 events. Preparing embeddings... +20s
  askexperts:docstore Upserting document: 24858b9226aa310e615aa72bbbb402525fe24c9d5d1f3010d3015d367ec64dcd in docstore: 2dc955b4-dc38-4c74-af2a-706f50712426, type: nostr:kind:1 +247ms
  ...
  askexperts:docstore Processed 10/321 events +7ms
  askexperts:docstore Successfully imported 321 Nostr events +2ms
```

Now create the expert, supply it's name, and the doc store id which you created above:
```bash
bash$ npx askexperts expert create rag <expert name> -s 6a9a1e51-3219-4e1c-9e13-5e08ef24bfcd --system_prompt nostr
Expert created successfully:
  Type: rag
  Nickname: <expert name>
  Public Key: b88eaa8898e0f4f852541304ff1e34ff0ce99837006c564f63da6fa4e728f5dd
  Private Key: <....>
  Wallet ID: 1
  Docstores: 6a9a1e51-3219-4e1c-9e13-5e08ef24bfcd
```

Launch it:
```bash
bash$ npx askexperts expert run lyn_clone -d
  ...
  askexperts:expert Initializing RAG components... +0ms
  askexperts:expert RAG database initialized +1ms
  ...
  askexperts:expert Starting sync from docstore 6a9a1e51-3219-4e1c-9e13-5e08ef24bfcd to RAG collection ... +0ms
  askexperts:docstore Subscribing to docstore: 6a9a1e51-3219-4e1c-9e13-5e08ef24bfcd, type: all, since: beginning, until: now +151ms
  askexperts:docstore Synced batch 100 +594ms
  askexperts:docstore Synced batch 100 +79ms
  askexperts:docstore Synced batch 100 +80ms
  askexperts:docstore Synced batch 100 +65ms
  askexperts:docstore Synced batch 100 +70ms
  askexperts:docstore Synced batch 100 +62ms
  askexperts:docstore Synced batch 100 +70ms
  askexperts:docstore Synced batch 100 +74ms
  askexperts:docstore Synced batch 19 +49ms
  askexperts:expert Completed syncing docstore to RAG collection ... +1s
  askexperts:expert Extract hashtags, input size 177814 chars +2ms
  ...
  askexperts:expert Paying 120 for extractHashtags +944ms
  askexperts:expert Completed syncing docstore to RAG collection ... +9s
  askexperts:expert Extracted hashtags: ai, ai-ethics, ai-in-media, ai-research, ai-tools, ai-writing, artificial-intelligence, asset-allocation, author-life, automation, bitcoin, bitcoin-adoption, bitcoin-ecosystem, bitcoin-education, bitcoin-network, bitcoin-policy, bitcoin-privacy, bitcoin-research, bitcoin-settlement, blockchain, blockchain-adoption, blockchain-consensus, blockchain-education, blockchain-governance, blockchain-network, blockchain-policy, blockchain-privacy, blockchain-security, blockchain-technology, book-reviews, btc, creative-writing, currency-markets, decentralized-social-media, deflation, dollar-system, economic-analysis, economic-history, economic-policy, editing, energy, energy-infrastructure, energy-markets, energy-policy, energy-transition, fiction-writing, finance, financial-analysis, financial-education, financial-literacy, financial-literacy, financial-markets, fiscal-policy, geopolitics, global-macro, global-politics, global-trade, globalization, gold, import-export, inflation, international-relations, international-trade, investment-strategy, macro-analysis, macro-economics, macro-policy, macro-trends, macroeconomics, monetary-history, monetary-policy, nostr, nostr-adoption, nostr-ecosystem, nostr-network, nostr-protocol, nostr-social, nostr-use-cases, nostr-vs-twitter, novel-writing, nuclear-energy, oil-markets, open-protocols, portfolio-management, publishing, renewable-energy, robotics, solar-energy, sovereign-debt, supply-chains, tariffs, tech-trends, technology, trade-deficits, trade-imbalances, trade-policy, trade-wars, tradfi, traditional-finance, us-deficit, us-economic-policy, us-economy, us-fiscal-policy, us-macroeconomics, us-monetary-policy, us-politics, us-public-debt, us-tariffs, us-trade, usd, writing, writing-advice, writing-process +5s
  askexperts:expert NostrExpert started successfully for pubkey: ... +1ms
  askexperts:expert Press Ctrl+C to exit. +0ms
```

Try chatting with your expert (use it's pubkey):
```bash
bash$ npx askexperts chat b88eaa8898e0f4f852541304ff1e34ff0ce99837006c564f63da6fa4e728f5dd -d

Expert: <expert name>
-----------------------------------------------------------
Type your messages and press Enter to send. Type "exit" to quit.
-----------------------------------------------------------
You > who are you?
Paid 47 sats to expert in 1049 ms.
Expert > I’m Lyn Alden. I’m an engineer-turned-macro-analyst, author, and business owner. I started out with a blue-collar background, studied engineering, and solo-leveled up to become a lead engineer before my side finance work took off to the point that it became my main thing.
.....
```

You successfully created an AI expert "clone" of yourself, anyone in the world can talk to it and pay over Lightning Network per message, expert income flows into the wallet you attached. In our case the same wallet was used to pay while we were chatting with it.


## License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.
