import express from "express";
import cors from "cors";
import { randomUUID } from "node:crypto";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { isInitializeRequest } from "@modelcontextprotocol/sdk/types.js";
import { AskExpertsMCP } from "./AskExpertsMCP.js";
import { DEFAULT_RELAYS } from "./nostr/constants.js";
import { DB } from "./db/index.js";
import { ParentClient } from "./utils/parentClient.js";

// Default port for the server
const PORT = process.env.PORT ? parseInt(process.env.PORT) : 3000;

// Parent server configuration
const PARENT_URL = process.env.PARENT_URL || "http://localhost:3001";
const PARENT_TOKEN = process.env.PARENT_TOKEN || "";
const MCP_SERVER_ID = process.env.MCP_SERVER_ID ? parseInt(process.env.MCP_SERVER_ID) : 0;

// Create an Express application
const app = express();

// Enable CORS for all routes
app.use(
  cors({
    origin: "*", // Allow all origins
    methods: ["GET", "POST", "DELETE", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization", "mcp-session-id"],
    credentials: true,
  })
);

// Parse JSON request bodies
app.use(express.json());

// Map to store transports by session ID
const transports: { [sessionId: string]: StreamableHTTPServerTransport } = {};

// Initialize the database
const db = new DB();

// Initialize the parent client if parent token is provided
let parentClient: ParentClient | null = null;

if (PARENT_TOKEN && MCP_SERVER_ID > 0) {
  // Get the latest user timestamp from the database
  const latestTimestamp = await db.getLatestUserTimestamp();
  console.log(`Latest user timestamp from database: ${latestTimestamp}`);
  
  // Create a parent client with the latest timestamp
  parentClient = new ParentClient(
    PARENT_URL,
    PARENT_TOKEN,
    async (users) => {
      // Process new users from parent server
      for (const user of users) {
        try {
          // Add user to local database
          await db.addUser({
            pubkey: user.pubkey,
            nsec: user.nsec,
            nwc: user.nwc
          });
          console.log(`Added user ${user.pubkey} from parent server`);
        } catch (error) {
          console.error(`Error adding user ${user.pubkey} from parent:`, error);
        }
      }
    },
    latestTimestamp // Pass the latest timestamp to start fetching from this point
  );

  // Start polling for new users every minute
  parentClient.startPolling(60000);
  console.log(`Connected to parent server at ${PARENT_URL}`);
}

// Handle POST requests for client-to-server communication
app.post("/mcp", async (req, res) => {
  // Check for existing session ID
  const sessionId = req.headers["mcp-session-id"] as string | undefined;
  let transport: StreamableHTTPServerTransport;

  console.log("POST sid", sessionId);

  // Get authentication token from Authorization header
  const authHeader = req.headers.authorization;
  let token: string | null = null;
  let user = null;

  if (authHeader && authHeader.startsWith("Bearer ")) {
    token = authHeader.substring(7); // Remove 'Bearer ' prefix
    user = await db.getUserByToken(token);
  }

  if (!user) {
    res.status(401).json({
      jsonrpc: "2.0",
      error: {
        code: -32001,
        message: "Unauthorized: Invalid token",
      },
      id: null,
    });
    return;
  }

  if (sessionId && transports[sessionId]) {
    // Reuse existing transport
    transport = transports[sessionId];
  } else if (!sessionId && isInitializeRequest(req.body)) {
    // New initialization request
    transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: () => randomUUID(),
      onsessioninitialized: (sessionId) => {
        // Store the transport by session ID
        transports[sessionId] = transport;
      },
      // DNS rebinding protection is disabled by default for backwards compatibility. If you are running this server
      // locally, make sure to set:
      // enableDnsRebindingProtection: true,
      // allowedHosts: ['127.0.0.1'],
    });

    // Clean up transport when closed
    transport.onclose = () => {
      if (transport.sessionId) {
        delete transports[transport.sessionId];
      }
    };

    // Create a new AskExpertsMCP instance with user's NWC if authenticated
    const server = new AskExpertsMCP(DEFAULT_RELAYS, user.nwc);

    // Connect to the MCP server
    await server.connect(transport);
  } else {
    // Invalid request
    res.status(400).json({
      jsonrpc: "2.0",
      error: {
        code: -32000,
        message: "Bad Request: No valid session ID provided",
      },
      id: null,
    });
    return;
  }

  // Handle the request
  await transport.handleRequest(req, res, req.body);
});

// Reusable handler for GET and DELETE requests
const handleSessionRequest = async (
  req: express.Request,
  res: express.Response
) => {
  const sessionId = req.headers["mcp-session-id"] as string | undefined;

  // Get authentication token from Authorization header
  const authHeader = req.headers.authorization;
  let token: string | null = null;

  if (authHeader && authHeader.startsWith("Bearer ")) {
    token = authHeader.substring(7); // Remove 'Bearer ' prefix
    const user = await db.getUserByToken(token);

    if (!user) {
      res.status(401).send("Unauthorized: Invalid token");
      return;
    }
  }

  if (!sessionId || !transports[sessionId]) {
    res.status(400).send("Invalid or missing session ID");
    return;
  }

  const transport = transports[sessionId];
  await transport.handleRequest(req, res);
};

// Handle GET requests for server-to-client notifications via SSE
app.get("/mcp", handleSessionRequest);

// Handle DELETE requests for session termination
app.delete("/mcp", handleSessionRequest);

// Health check endpoint
app.get("/health", (req, res) => {
  res.json({ status: "ok" });
});


// New user webhook endpoint (protected by token)
app.post("/new-user-webhook", async (req, res) => {
  // Get authentication token from Authorization header
  const authHeader = req.headers.authorization;

  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    res
      .status(401)
      .json({ error: "Unauthorized: Missing or invalid token format" });
    return;
  }

  const token = authHeader.substring(7); // Remove 'Bearer ' prefix
  
  // Check if the token matches the server's own token
  if (token !== PARENT_TOKEN) {
    res.status(401).json({ error: "Unauthorized: Invalid token" });
    return;
  }

  // Reset parent polling and fetch new users immediately
  if (parentClient) {
    console.log("Webhook triggered: Fetching new users from parent server");
    await parentClient.pollForUsers();
    res.json({ status: "ok", message: "New users fetch triggered" });
  } else {
    res.status(503).json({
      error: "Service unavailable: Parent client not initialized",
      message: "Make sure PARENT_TOKEN and MCP_SERVER_ID are set"
    });
  }
});

// Start the server
app.listen(PORT, () => {
  console.log(`AskExperts MCP server is running on port ${PORT}`);
  console.log(`MCP endpoint: http://localhost:${PORT}/mcp`);
  
  if (parentClient) {
    console.log(`Connected to parent server at ${PARENT_URL}`);
  } else {
    console.log(`Not connected to parent server. Set PARENT_TOKEN and MCP_SERVER_ID environment variables to enable.`);
  }
});

// Handle process termination
process.on('SIGINT', async () => {
  console.log('Shutting down...');
  
  if (parentClient) {
    parentClient.stopPolling();
  }
  
  await db.close();
  process.exit(0);
});
