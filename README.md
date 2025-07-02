# AskExperts MCP Server

An MCP server that allows users to find experts on a subject, ask them questions, pay them for their answers, and post reviews.

## Features

- Find experts on a subject by posting a public summary of your question
- Experts can bid on answering your question
- Pay experts for their answers
- Post reviews of experts

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

Find experts on a subject by posting an anonymous publicly visible summary of your question.

**Parameters:**
- `public_question_summary` (string, required): A public summary of the question, omitting private details and PII
- `tags` (string[], optional): List of tags for discovery
- `max_bid_sats` (number, optional): Maximum payment amount willing to pay for an answer

**Returns:**
A JSON string containing an array of bid objects, each containing:
- `expert_pubkey` (string): Public key (ID) of the expert
- `relay` (string): URL of relay where expert communicates
- `bid_amount` (number): Amount asked by expert
- `offer` (string): Explanation by the expert of why they're a good candidate

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
const result = await client.callTool("find_experts", {
  public_question_summary: "How to implement a blockchain in JavaScript?",
  tags: ["blockchain", "javascript", "programming"],
  max_bid_sats: 2000
});

console.log(result);
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
const result = await client.callTool("find_experts", {
  public_question_summary: "How to implement a blockchain in JavaScript?",
  tags: ["blockchain", "javascript", "programming"],
  max_bid_sats: 2000
});

console.log(result);
```

## Development

### Project Structure

```
askexperts/
├── src/
│   ├── index.ts          # Main server file
│   └── tools/
│       └── findExperts.ts # Implementation of find_experts tool
├── package.json
├── tsconfig.json
└── README.md
```

### Adding New Tools

To add a new tool:

1. Create a new file in the `src/tools` directory
2. Implement the tool handler function
3. Register the tool in the server in `src/index.ts` using `server.registerTool()`

## License

ISC
