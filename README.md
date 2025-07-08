# AskExperts MCP Server

An MCP server that allows users to find experts on a subject, ask them questions, pay them for their answers, and curate the experts.

## Features

- Find experts on a subject by posting a public summary of your question
- Experts can bid on answering your question
- Pay experts for their answers
- Manage list of expert scores
- Parent server for centralized user management across multiple MCP servers

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
npx -y askexperts
```

## Usage

### Starting the Server

#### Local Development (Stdio Mode)

```bash
# Run the MCP server in stdio mode
npm run mcp

# Development mode with auto-reload
npm run dev

# Build and start in production mode
npm run build
npm start
```

#### Remote HTTP Server

```bash
# Run the MCP server as a remote HTTP server
npm run server

# Development mode with auto-reload
npm run server:dev
```

The remote server will start on port 3000 (or the port specified in the PORT environment variable) with the following endpoints:
- Session endpoint: http://localhost:3000/api/session
- MCP endpoint: http://localhost:3000/api/mcp/:sessionId

#### Parent Server

```bash
# Run the parent server
npm run parent

# Development mode with auto-reload
npm run parent:dev
```

The parent server will start on port 3001 (or the port specified in the PARENT_PORT environment variable) with the following endpoints:
- Users endpoint: http://localhost:3001/users

### Server Architecture

The AskExperts MCP server is built with a modular architecture:

1. **AskExpertsTools** - Core functionality class that handles:
   - Finding experts on Nostr
   - Collecting bids from experts
   - Sending encrypted questions to experts
   - Receiving and processing answers
   - Managing payments via NWC (Nostr Wallet Connect)

2. **AskExpertsMCP** - MCP server class that:
   - Extends the base McpServer class from the MCP SDK
   - Encapsulates an instance of AskExpertsTools
   - Registers and exposes the find_experts and ask_experts tools
   - Handles tool registration and configuration

3. **Server** - Express.js HTTP server that:
   - Provides REST API endpoints for client connections
   - Manages sessions for stateful client interactions
   - Connects the AskExpertsMCP instance to HTTP transport
   - Handles CORS and other HTTP-specific concerns

4. **ParentServer** - Express.js HTTP server that:
   - Provides a centralized user database for multiple MCP servers
   - Distributes users to connected MCP servers
   - Authenticates MCP servers using tokens
   - Manages MCP server registrations

### Launching the Server

To launch the server, you have several options:

#### Option 1: Run as a local stdio-based MCP server

```bash
# Install dependencies if you haven't already
npm install

# Run the server in stdio mode
npm run mcp
```

This mode is suitable for direct integration with MCP clients that support stdio transport.

#### Option 2: Run as a remote HTTP server

```bash
# Install dependencies if you haven't already
npm install

# Run the server in HTTP mode
npm run server
```

The server will start on port 3000 by default (configurable via PORT environment variable) and output:
```
AskExperts MCP server is running on port 3000
Session endpoint: http://localhost:3000/api/session
MCP endpoint: http://localhost:3000/api/mcp/:sessionId
```

#### Option 3: Run with automatic payments enabled

To enable automatic payments for expert bids, set the NWC_CONNECTION_STRING environment variable:

```bash
# Set the NWC connection string
export NWC_CONNECTION_STRING="nostr+walletconnect://..."

# Run the server
npm run server
```

This allows the server to automatically pay Lightning invoices for expert bids without requiring clients to provide payment preimages.

#### Option 4: Run with parent server connection

To connect the MCP server to a parent server for centralized user management:

```bash
# Set the parent server connection details
export PARENT_URL="http://localhost:3001"
export PARENT_TOKEN="your-mcp-server-token"
export MCP_SERVER_ID="your-mcp-server-id"

# Run the server
npm run server
```

This allows the MCP server to fetch users from the parent server.

#### Option 5: Run the parent server

```bash
# Install dependencies if you haven't already
npm install

# Run the parent server
npm run parent
```

The parent server will start on port 3001 by default (configurable via PARENT_PORT environment variable).

#### Using NPX

```bash
# Run directly without installation (stdio mode)
npx -y askexperts

# Or install globally and run
npm install -g askexperts
askexperts

# Run as a remote HTTP server
npx -y askexperts-server

# Run as a parent server
npx -y askexperts-parent
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

#### Using with Local Server (Stdio Mode)

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
const serverProcess = spawn("npx", ["-y", "askexperts"]);

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

#### Using with Remote HTTP Server

```typescript
import { McpClient } from "@modelcontextprotocol/sdk/client/mcp.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamable-http.js";
import fetch from "node-fetch";

// Default server URL
const SERVER_URL = process.env.SERVER_URL || "http://localhost:3000";

async function main() {
  try {
    // First, get a session ID from the server
    console.log("Getting session ID from server...");
    const sessionResponse = await fetch(`${SERVER_URL}/api/session`);
    const sessionData = await sessionResponse.json();
    const sessionId = sessionData.sessionId;
    
    console.log(`Session ID: ${sessionId}`);
    
    // Create a transport that connects to the MCP server
    const transport = new StreamableHTTPClientTransport({
      url: `${SERVER_URL}/api/mcp/${sessionId}`,
      fetch: fetch,
    });
    
    // Create an MCP client
    const client = new McpClient();
    
    // Connect the client to the transport
    await client.connect(transport);
    
    // Get server info
    const serverInfo = await client.getServerInfo();
    console.log("Server info:", serverInfo);
    
    // List available tools
    const tools = await client.listTools();
    console.log("Available tools:", tools);
    
    // Example: Find experts on a subject
    if (tools.includes("find_experts")) {
      console.log("\nFinding experts...");
      const findExpertsResult = await client.useTool("find_experts", {
        public_question_summary: "How to implement a Lightning Network wallet in JavaScript?",
        tags: ["bitcoin", "lightning", "javascript"]
      });
      
      // Process the result...
    }
    
    // Close the connection
    await client.disconnect();
  } catch (error) {
    console.error("Error:", error);
  }
}

main();
```

A complete example client is available in the `examples/remote-client.js` file.

## User Authentication

The server supports user authentication using tokens. Users can be added to the SQLite database, and their tokens can be used to authenticate requests to the MCP endpoint.

### Database Structure

#### MCP Server Database

The MCP server uses a SQLite database to store user information with the following fields:
- `pubkey` (string): The user's public key
- `nsec` (string): The user's private key
- `nwc` (string): The user's NWC connection string
- `timestamp` (number): Unix timestamp when the user was added
- `token` (string): Authentication token for the user

#### Parent Server Database

The parent server uses a SQLite database with the following tables:

**mcp_servers**
- `id` (number): Autoincremented primary key
- `url` (string): URL of the MCP server
- `token` (string): Authentication token for the MCP server

**users**
- `pubkey` (string): The user's public key
- `nsec` (string): The user's private key
- `nwc` (string): The user's NWC connection string
- `timestamp` (number): Unix timestamp when the user was added
- `token` (string): Authentication token for the user
- `mcp_server_id` (number): Foreign key referencing the mcp_servers table

### Adding a User

#### To MCP Server

To add a user to the MCP server database, use the provided utility script:

```bash
# Build the project first
npm run build

# Add a user
npm run add-user
```

This will generate a random token for the user and store it in the database. The script will output the token that can be used for authentication.

#### To Parent Server

To add a user to the parent server database, use the provided utility script:

```bash
# Build the project first
npm run build

# Add a user
npm run add-parent-user
```

This will prompt you for the MCP server ID and user details, then add the user to the parent database.

### Adding an MCP Server to Parent

To register an MCP server with the parent server:

```bash
# Build the project first
npm run build

# Add an MCP server
npm run add-mcp-server
```

This will prompt you for the MCP server URL and generate a token for authentication.

### Getting User Information

To retrieve user information by token:

```bash
npm run get-user <token>
```

### Authenticating Requests

To authenticate requests to the MCP endpoint, include the token in the Authorization header:

```
Authorization: Bearer <token>
```

When a user is authenticated, the server will use their NWC string from the database instead of the environment variable.

### User API Endpoint

The server provides a `/user` endpoint to get information about the authenticated user:

```bash
curl -H "Authorization: Bearer <token>" http://localhost:3000/user
```

## Environment Variables

### PORT

The `PORT` environment variable sets the port number for the remote HTTP server. If not specified, the server will run on port 3000.

```bash
# Set the port for the remote server
export PORT=8080

# Then start the server
npm run server
```

### PARENT_PORT

The `PARENT_PORT` environment variable sets the port number for the parent server. If not specified, the server will run on port 3001.

```bash
# Set the port for the parent server
export PARENT_PORT=8081

# Then start the parent server
npm run parent
```

### PARENT_URL

The `PARENT_URL` environment variable sets the URL of the parent server for the MCP server to connect to. If not specified, the MCP server will use "http://localhost:3001".

```bash
# Set the parent server URL
export PARENT_URL="http://parent-server.example.com"

# Then start the MCP server
npm run server
```

### PARENT_TOKEN

The `PARENT_TOKEN` environment variable sets the authentication token for the MCP server to use when connecting to the parent server. This token is generated when adding an MCP server to the parent database.

```bash
# Set the parent server token
export PARENT_TOKEN="your-mcp-server-token"

# Then start the MCP server
npm run server
```

### MCP_SERVER_ID

The `MCP_SERVER_ID` environment variable sets the ID of the MCP server in the parent database. This ID is generated when adding an MCP server to the parent database.

```bash
# Set the MCP server ID
export MCP_SERVER_ID="your-mcp-server-id"

# Then start the MCP server
npm run server
```

### NWC_CONNECTION_STRING

The `NWC_CONNECTION_STRING` environment variable enables the built-in wallet functionality in the `ask_experts` tool. When set, it allows the MCP server to automatically pay Lightning invoices for expert bids without requiring the client to provide payment preimages. This is used as a fallback when no authenticated user is present.

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