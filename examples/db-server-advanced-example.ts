import { DBServer } from "../src/db/index.js";
import type { DBServerPerms } from "../src/db/index.js";
import { Request } from "express";

/**
 * Example implementation of DBServerPerms interface
 * This demonstrates how to implement custom permissions for the DBServer
 */
class ExamplePermissions implements DBServerPerms {

  constructor() {
  }

  /**
   * Check if the user has permission to perform the requested operation
   * @param user_id - User ID
   * @param req - Express request object
   * @returns Promise that resolves with optional listIds if the user has permission
   */
  async checkPerms(user_id: string, req: Request): Promise<{ listIds?: string[] }> {
    return {};
  }

  /**
   * Get the user ID associated with a public key
   * @param pubkey - Public key of the user
   * @returns Promise that resolves with the user ID
   */
  async getUserId(pubkey: string): Promise<string> {
    throw new Error(`User not found for pubkey: ${pubkey}`);
  }
}

/**
 * Advanced example demonstrating how to launch a DBServer with custom permissions
 */
async function main() {
  // Create custom permissions handler
  const perms = new ExamplePermissions();

  // Create a new DBServer instance with configuration options
  const dbServer = new DBServer({
    port: 3100,
    basePath: "/api/db",
    origin: "http://localhost:3100",
    perms: perms // Use our custom permissions implementation
  });

  try {
    // Start the server
    await dbServer.start();
    console.log("DB Server started successfully!");
    console.log("Server is running at http://localhost:3100/api/db");
    
    console.log("\nExample API endpoints:");
    console.log("- GET    /api/db/health         - Check server health");
    console.log("- GET    /api/db/whoami         - Get current user ID");
    console.log("- GET    /api/db/wallets        - List all wallets");
    console.log("- GET    /api/db/wallets/:id    - Get wallet by ID");
    console.log("- POST   /api/db/wallets        - Create a new wallet");
    console.log("- PUT    /api/db/wallets/:id    - Update a wallet");
    console.log("- DELETE /api/db/wallets/:id    - Delete a wallet");
    console.log("- GET    /api/db/experts        - List all experts");
    console.log("- GET    /api/db/experts/:pubkey - Get expert by pubkey");
    console.log("- POST   /api/db/experts        - Create a new expert");
    console.log("- PUT    /api/db/experts/:pubkey - Update an expert");
    console.log("- DELETE /api/db/experts/:pubkey - Delete an expert");
    
    console.log("\nPress Ctrl+C to stop the server");

    // Handle graceful shutdown
    process.on("SIGINT", async () => {
      console.log("\nShutting down server...");
      await dbServer.stop();
      console.log("Server stopped");
      process.exit(0);
    });
  } catch (error) {
    console.error("Failed to start DB Server:", error);
    process.exit(1);
  }
}

// Run the example
main().catch(console.error);

/**
 * Example HTTP requests to interact with the server:
 * 
 * 1. Check server health:
 *    GET http://localhost:3000/api/db/health
 * 
 * 2. Get current user ID (requires auth token):
 *    GET http://localhost:3000/api/db/whoami
 *    Headers: { "Authorization": "Bearer <token>" }
 * 
 * 3. List wallets (requires auth token):
 *    GET http://localhost:3000/api/db/wallets
 *    Headers: { "Authorization": "Bearer <token>" }
 * 
 * 4. Create a new wallet (requires auth token):
 *    POST http://localhost:3000/api/db/wallets
 *    Headers: { 
 *      "Authorization": "Bearer <token>",
 *      "Content-Type": "application/json"
 *    }
 *    Body: {
 *      "name": "My Wallet",
 *      "nwc": "nostr+walletconnect://...",
 *      "is_default": true
 *    }
 * 
 * 5. Update a wallet (requires auth token):
 *    PUT http://localhost:3000/api/db/wallets/123
 *    Headers: { 
 *      "Authorization": "Bearer <token>",
 *      "Content-Type": "application/json"
 *    }
 *    Body: {
 *      "id": "123",
 *      "name": "Updated Wallet Name",
 *      "nwc": "nostr+walletconnect://...",
 *      "is_default": true
 *    }
 */