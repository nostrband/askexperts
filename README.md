# AskExperts MCP Server

An MCP server that allows users to find experts on a subject, ask them questions, pay them for their answers, and curate the experts.

## Features

- Find experts on a subject by posting a public summary of your question
- Experts can bid on answering your question
- Pay experts for their answers
- Manage list of expert scores

## Installation

### Local Development

```bash
# Clone the repository
git clone <repository-url>
cd askexperts

# Install dependencies
npm install
```

### Using NPX

You can run the MCP server directly using npx without installing it:

```bash
npx -y @askexperts/mcp
```

## Usage

### Starting the Server

#### Local Development

```bash
# Run the MCP server
npm run mcp

# Development mode with auto-reload
npm run dev

# Build and start in production mode
npm run build
npm start
```

#### Using NPX

```bash
# Run directly without installation
npx -y @askexperts/mcp

# Or install globally and run
npm install -g @askexperts/mcp
askexperts-mcp
```

### Using the MCP Server

The server exposes the following MCP tools:

#### find_experts

Find experts on a subject by posting an anonymous publicly visible summary of your question. It should omit all private details and personally identifiable information, be short, concise and include relevant tags. Returns a list of bids by experts who are willing to answer your question and their invoices for payments.

**Parameters:**
- `public_question_summary` (string, required): A public summary of the question, omitting private details and PII
- `tags` (string[], optional): List of tags for discovery (required if expert_pubkeys not set)
- `expert_pubkeys` (string[], optional): List of expert public keys to direct the question to, if those were already discovered
- `max_bid_sats` (number, optional): Maximum payment amount willing to pay for an answer, in Bitcoin satoshis

**Returns:**
A JSON string containing:
- `bids`: Array of bid objects, each containing:
  - `message_id` (string): Bid payload event ID
  - `pubkey` (string): Expert's public key
  - `bid_sats` (number): Amount of the bid in satoshis
  - `offer` (string): Expert's offer description
- `id` (string): ID of the ask event

#### ask_experts

After you receive bids from experts, select good ones and you can send the question to these experts. For each bid, information received from find_experts tool must be included, you can pay invoices yourself and provide preimages, or leave preimages empty and we pay from built-in wallet. Relays and invoices are stored internally and clients don't have to pass them from bids to questions.

**Note:** If the server does not have `NWC_CONNECTION_STRING` set, you must pay invoices yourself and provide the preimages when calling this tool.

**Parameters:**
- `ask_id` (string, required): Id of the ask, received from find_experts.
- `question` (string, required): The detailed question to send to experts, might include more sensitive data as the questions are encrypted.
- `experts` (array, required): Array of experts to send questions to, each containing:
  - `message_id` (string, required): Bid payload event ID for the first question, or last answer event ID for a followup
  - `pubkey` (string, required): Expert's public key
  - `preimage` (string, conditional): Payment preimage for verification (required if NWC_CONNECTION_STRING not set)
  - `bid_sats` (number, conditional): Amount of the bid in satoshis (required when preimage is not provided, must match the invoice amount)
- `timeout` (number, optional): Timeout in milliseconds for sending the questions and receiving the answers (default: 5000ms)

**Returns:**
A JSON string containing:
- `total` (number): Total number of question results
- `sent` (number): Number of questions successfully sent
- `failed` (number): Number of questions that failed to send
- `failed_payments` (number): Number of questions that failed to get paid
- `received` (number): Number of answers received
- `timeout` (number): Number of answers that timed out
- `insufficient_balance` (boolean): True if internal wallet is out of funds (only relevant when `NWC_CONNECTION_STRING` is set)
- `results` (array): Detailed results for each expert question/answer, each containing:
  - `message_id` (string): Message ID that was provided as input
  - `expert_pubkey` (string): Expert's public key
  - `payment_hash` (string, optional): Payment hash of the bid, useful to find the payment in client's wallet
  - `status` (string): Status of the question/answer process ('sent', 'failed', 'received', 'timeout')
  - `content` (string, optional): Content of the answer if received
  - `followup_sats` (number, optional): If followup is allowed by expert, includes the amount of sats to pay for a followup question
  - `followup_message_id` (string, optional): ID of the message to ask a followup question, to be passed to ask_experts
  - `followup_invoice` (string, optional): Lightning invoice for followup question if available (only included when `NWC_CONNECTION_STRING` is not set)
  - `error` (string, optional): Error message if failed

### Example Usage with MCP Client

#### Using with Local Server

```typescript
import { McpClient } from "@modelcontextprotocol/sdk/client/mcp.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

// Create an MCP client
const client = new McpClient();

// Connect to the server using stdio transport
const transport = new StdioClientTransport();
await client.connect(transport);

// Call the find_experts tool
const findResult = await client.callTool("find_experts", {
  public_question_summary: "How to implement a blockchain in JavaScript?",
  tags: ["blockchain", "javascript", "programming"],
  // expert_pubkeys: ["pubkey1", "pubkey2"], // Optional: direct the question to specific experts
  max_bid_sats: 2000
});

// Get the bids and ask ID from the result
const { bids, id } = JSON.parse(findResult);

// Select bids to send questions to
const selectedBids = bids.slice(0, 2); // Select first two bids

// Call the ask_experts tool with selected experts
const askResult = await client.callTool("ask_experts", {
  ask_id: id,
  question: "I need a detailed explanation of how to implement a simple blockchain in JavaScript with examples.",
  experts: selectedBids.map(bid => ({
    message_id: bid.message_id,
    pubkey: bid.pubkey,
    bid_sats: bid.bid_sats // Required to match the invoice amount
    // preimage is not provided, so the server will pay using NWC_CONNECTION_STRING
  })),
  timeout: 10000 // Wait 10 seconds for answers
});

console.log(askResult);
```

#### Using with NPX

You can use the MCP server with a client by spawning it as a child process:

```typescript
import { McpClient } from "@modelcontextprotocol/sdk/client/mcp.js";
import { ChildProcessClientTransport } from "@modelcontextprotocol/sdk/client/child-process.js";
import { spawn } from "child_process";

// Create an MCP client
const client = new McpClient();

// Spawn the MCP server as a child process using npx
const serverProcess = spawn("npx", ["-y", "@askexperts/mcp"]);

// Connect to the server using child process transport
const transport = new ChildProcessClientTransport(serverProcess);
await client.connect(transport);

// Call the find_experts tool
const findResult = await client.callTool("find_experts", {
  public_question_summary: "How to implement a blockchain in JavaScript?",
  tags: ["blockchain", "javascript", "programming"],
  // expert_pubkeys: ["pubkey1", "pubkey2"], // Optional: direct the question to specific experts
  max_bid_sats: 2000
});

// Get the bids and ask ID from the result
const { bids, id } = JSON.parse(findResult);

// Select bids to send questions to
const selectedBids = bids.slice(0, 2); // Select first two bids

// Call the ask_experts tool with selected experts
const askResult = await client.callTool("ask_experts", {
  ask_id: id,
  question: "I need a detailed explanation of how to implement a simple blockchain in JavaScript with examples.",
  experts: selectedBids.map(bid => ({
    message_id: bid.message_id,
    pubkey: bid.pubkey,
    bid_sats: bid.bid_sats, // Required to match the invoice amount
    // preimage is not provided, so the server will pay using NWC_CONNECTION_STRING
  })),
  timeout: 10000 // Wait 10 seconds for answers
});

console.log(askResult);
```

## Environment Variables

### NWC_CONNECTION_STRING

The `NWC_CONNECTION_STRING` environment variable enables the built-in wallet functionality in the `ask_experts` tool. When set, it allows the MCP server to automatically pay Lightning invoices for expert bids without requiring the client to provide payment preimages.

#### What is NWC?

NWC (Nostr Wallet Connect) is a protocol that allows applications to connect to a Lightning wallet. The connection string is a URL that contains the necessary information to connect to a wallet that supports the NWC protocol.

#### Setting up NWC_CONNECTION_STRING

To enable the built-in wallet:

1. Obtain a NWC connection string from a compatible wallet (like Alby)
2. Set the environment variable before starting the server:

```bash
# Set the environment variable
export NWC_CONNECTION_STRING="nostr+walletconnect://..."

# Then start the server
npm run mcp
```

#### How it works

When a client calls the `ask_experts` tool with bids that include invoices but no preimages:

1. The server checks if `NWC_CONNECTION_STRING` is set
2. If set, it uses the NWC client to pay the invoices automatically
3. It obtains payment preimages from successful payments
4. These preimages are used to authenticate the questions sent to experts

Without this environment variable, clients must pay invoices themselves and provide the preimages when calling the `ask_experts` tool.

#### Example with built-in wallet

```typescript
// With NWC_CONNECTION_STRING set on the server, clients can simply provide bid information
const askResult = await client.callTool("ask_experts", {
  ask_id: findResult.structuredContent.id,
  question: "My detailed question here...",
  experts: selectedBids.map(bid => ({
    message_id: bid.message_id,
    pubkey: bid.pubkey,
    bid_sats: bid.bid_sats // Required to match the invoice amount
    // No preimage needed - server will pay using the built-in wallet
  }))
});
```

## License

MIT
