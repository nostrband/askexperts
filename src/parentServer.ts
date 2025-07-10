import express from "express";
import cors from "cors";
import { ParentDB } from "./db/parentDb.js";
import { generateSecretKey, getPublicKey, nip19 } from "nostr-tools";
import { createWallet } from "nwc-enclaved-utils";
import dotenv from "dotenv";

// Load environment variables from .env file
dotenv.config();

// Default port for the parent server
const PORT = process.env.PARENT_PORT ? parseInt(process.env.PARENT_PORT) : 3001;

// Create an Express application
const app = express();

// Enable CORS for all routes
app.use(
  cors({
    origin: "*", // Allow all origins
    methods: ["GET", "POST", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization"],
    credentials: true,
  })
);

// Parse JSON request bodies
app.use(express.json());

// Initialize the parent database
const db = new ParentDB();

// Health check endpoint
app.get("/health", (req, res) => {
  res.json({ status: "ok" });
});

// Get user info endpoint (protected by token)
app.get("/user", async (req, res) => {
  const authHeader = req.headers.authorization;

  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    res
      .status(401)
      .json({ error: "Unauthorized: Missing or invalid token format" });
    return;
  }

  const token = authHeader.substring(7); // Remove 'Bearer ' prefix
  const user = await db.getUserByToken(token);

  if (!user) {
    res.status(401).json({ error: "Unauthorized: Invalid token" });
    return;
  }

  // Get the MCP server information
  const mcpServer = await db.getMcpServerById(user.mcp_server_id);
  
  // Return user info without sensitive data
  res.json({
    pubkey: user.pubkey,
    timestamp: user.timestamp,
    mcp_server_url: mcpServer ? mcpServer.url + "/mcp" : null,
  });
});

// Get users endpoint (protected by token)
app.get("/users", async (req, res) => {
  // Get authentication token from Authorization header
  const authHeader = req.headers.authorization;

  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    res
      .status(401)
      .json({ error: "Unauthorized: Missing or invalid token format" });
    return;
  }

  const token = authHeader.substring(7); // Remove 'Bearer ' prefix
  const mcpServer = await db.getMcpServerByToken(token);

  if (!mcpServer) {
    res.status(401).json({ error: "Unauthorized: Invalid token" });
    return;
  }

  // Get the 'since' query parameter (timestamp)
  const sinceParam = req.query.since;
  let since = 0;

  if (sinceParam) {
    // Convert to number and validate
    since = Number(sinceParam);
    if (isNaN(since)) {
      res.status(400).json({ error: "Invalid 'since' parameter. Must be a valid timestamp." });
      return;
    }
  }

  // Get users for this MCP server since the specified timestamp
  const users = await db.getUsersSince(mcpServer.id, since);

  // Return users without exposing sensitive data to other servers
  const safeUsers = users.map(user => ({
    pubkey: user.pubkey,
    nsec: user.nsec,
    nwc: user.nwc,
    timestamp: user.timestamp,
    token: user.token
  }));

  res.json(safeUsers);
});

// // Add MCP server endpoint (for admin use)
// app.post("/admin/mcp-servers", express.json(), async (req, res) => {
//   // In a production environment, this endpoint should be protected
//   // with proper authentication for administrators only
  
//   const { url } = req.body;
  
//   if (!url) {
//     res.status(400).json({ error: "Missing required field: url" });
//     return;
//   }
  
//   try {
//     const mcpServer = await db.addMcpServer(url);
//     res.status(201).json(mcpServer);
//   } catch (error) {
//     console.error("Error adding MCP server:", error);
//     res.status(500).json({ error: "Failed to add MCP server" });
//   }
// });

// // Add user endpoint (for admin use)
// app.post("/admin/users", express.json(), async (req, res) => {
//   // In a production environment, this endpoint should be protected
//   // with proper authentication for administrators only
  
//   const { pubkey, nsec, nwc, mcp_server_id } = req.body;
  
//   if (!pubkey || !nsec || !nwc || !mcp_server_id) {
//     res.status(400).json({ error: "Missing required fields" });
//     return;
//   }
  
//   try {
//     // Add user to the database
//     const user = await db.addUser({ pubkey, nsec, nwc, mcp_server_id });
    
//     // Get the MCP server information
//     const mcpServer = await db.getMcpServerById(mcp_server_id);
    
//     // If MCP server exists, call its webhook to notify about the new user
//     if (mcpServer) {
//       try {
//         // Call the webhook on the MCP server
//         const webhookUrl = `${mcpServer.url}/new-user-webhook`;
//         console.log(`Notifying MCP server at ${webhookUrl} about new user`);
        
//         const webhookResponse = await fetch(webhookUrl, {
//           method: 'POST',
//           headers: {
//             'Authorization': `Bearer ${mcpServer.token}`,
//             'Content-Type': 'application/json'
//           },
//           body: JSON.stringify({ action: 'new_user_added' })
//         });
        
//         if (!webhookResponse.ok) {
//           console.warn(`Failed to notify MCP server: ${webhookResponse.status} ${webhookResponse.statusText}`);
//         } else {
//           console.log(`MCP server notified successfully`);
//         }
//       } catch (webhookError) {
//         console.error(`Error notifying MCP server:`, webhookError);
//         // We don't want to fail the user creation if webhook notification fails
//       }
//     } else {
//       console.warn(`MCP server with ID ${mcp_server_id} not found, couldn't notify about new user`);
//     }
    
//     res.status(201).json(user);
//   } catch (error) {
//     console.error("Error adding user:", error);
//     res.status(500).json({ error: "Failed to add user" });
//   }
// });

// Signup endpoint (public)
app.post("/signup", async (req, res) => {
  try {
    // Generate a new Nostr secret key
    const secretKey = generateSecretKey();
    const pubkey = getPublicKey(secretKey);
    const nsec = nip19.nsecEncode(secretKey);
    
    // Create a wallet and get the NWC string
    const wallet = await createWallet();
    const nwc = wallet.nwcString;
    
    // Get the MCP server with the maximum ID
    const mcpServer = await db.getMcpServerWithMaxId();
    
    if (!mcpServer) {
      res.status(500).json({ error: "No MCP servers available" });
      return;
    }
    
    // Add user to the database
    const user = await db.addUser({
      pubkey,
      nsec,
      nwc,
      mcp_server_id: mcpServer.id
    });
    
    // Return user info to the caller
    res.status(201).json({
      pubkey,
      nsec,
      nwc,
      token: user.token,
      mcp_server_url: mcpServer.url + "/mcp"
    });
    
    // After sending the response, notify the MCP server
    try {
      // Call the webhook on the MCP server
      const webhookUrl = `${mcpServer.url}/new-user-webhook`;
      console.log(`Notifying MCP server at ${webhookUrl} about new user`);
      
      const webhookResponse = await fetch(webhookUrl, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${mcpServer.token}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ action: 'new_user_added' })
      });
      
      if (!webhookResponse.ok) {
        console.warn(`Failed to notify MCP server: ${webhookResponse.status} ${webhookResponse.statusText}`);
      } else {
        console.log(`MCP server notified successfully`);
      }
    } catch (webhookError) {
      console.error(`Error notifying MCP server:`, webhookError);
      // We don't want to fail the user creation if webhook notification fails
    }
  } catch (error) {
    console.error("Error in signup:", error);
    res.status(500).json({ error: "Failed to create user" });
  }
});

// Start the server
app.listen(PORT, () => {
  console.log(`Parent server is running on port ${PORT}`);
  console.log(`Users endpoint: http://localhost:${PORT}/users`);
});