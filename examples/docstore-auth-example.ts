import { DocStoreSQLiteServer } from "../src/docstore/DocStoreSQLiteServer.js";
import { DocStorePerms, WebSocketMessage } from "../src/docstore/interfaces.js";
import WebSocket from "ws";
import { generateSecretKey, getPublicKey } from "nostr-tools";
import { createAuthToken } from "../src/common/auth.js";

/**
 * Example implementation of DocStorePerms
 * This is a simple implementation that allows specific pubkeys and operations
 */
class ExampleDocStorePerms implements DocStorePerms {
  private allowedPubkeys: Set<string> = new Set();
  private allowedOperations: Map<string, Set<string>> = new Map();

  constructor() {}

  addPubkey(pubkey: string) {
    this.allowedPubkeys.add(pubkey);
    this.allowedOperations.set(
      pubkey,
      new Set([
        "get",
        "upsert",
        "delete",
        "createDocstore",
        "getDocstore",
        "listDocstores",
        "deleteDocstore",
        "countDocs",
        "subscribe",
      ])
    );
  }

  /**
   * Check if a pubkey is a valid user
   * @param pubkey - The public key of the user
   * @throws Error if the user is not valid with a custom error message
   * @returns Promise that resolves if the user is valid
   */
  async checkUser(pubkey: string): Promise<void> {
    if (!this.allowedPubkeys.has(pubkey)) {
      throw new Error(`User ${pubkey} is not authorized to access this server`);
    }
  }

  /**
   * Check if a user is allowed to perform an operation
   * @param pubkey - The public key of the user
   * @param message - The WebSocket message being processed
   * @throws Error if the operation is not allowed with a custom error message
   * @returns Promise that resolves if the operation is allowed
   */
  async checkPerms(pubkey: string, message: WebSocketMessage): Promise<void> {
    // Get the allowed operations for this pubkey
    const allowedOps = this.allowedOperations.get(pubkey);

    // If no operations are defined for this pubkey, deny access
    if (!allowedOps) {
      throw new Error(`User ${pubkey} has no defined permissions`);
    }

    // Check if the operation is allowed
    if (!allowedOps.has(message.method)) {
      throw new Error(`User ${pubkey} is not authorized to perform ${message.method} operation`);
    }
  }
}


// Example usage
async function main() {
  // Create the permissions interface
  const perms = new ExampleDocStorePerms();

  // Create the server with permissions
  const server = new DocStoreSQLiteServer({
    dbPath: "./docstore.db",
    port: 8880,
    host: "localhost",
    perms
  });

  // Start the server
  server.start();

  console.log("DocStoreSQLiteServer started with authentication");
  console.log("Press Ctrl+C to stop");

  // Example of how to connect with authentication
  // Generate a test key pair
  const privateKey = generateSecretKey();
  const pubkey = getPublicKey(privateKey);

  console.log(`Generated test key pair:`);
  console.log(`Private key: ${privateKey}`);
  console.log(`Public key: ${pubkey}`);

  // Add this pubkey to allowed pubkeys for testing
  perms.addPubkey(pubkey);

  // Create auth token
  const authToken = createAuthToken(
    privateKey,
    "http://localhost:8880/",
    "GET"
  );

  // Connect to the server with authentication
  const ws = new WebSocket("ws://localhost:8880", {
    headers: {
      Authorization: authToken,
    },
  });

  ws.on("open", () => {
    console.log("Connected to server with authentication");

    // Example: List docstores
    ws.send(
      JSON.stringify({
        id: "1",
        type: "request",
        method: "listDocstores",
        params: {},
      })
    );
  });

  ws.on("message", (data) => {
    console.log("Received:", data.toString());
  });

  ws.on("error", (error) => {
    console.error("WebSocket error:", error);
  });

  ws.on("close", () => {
    console.log("Connection closed");
  });

  // Keep the process running
  process.on("SIGINT", () => {
    console.log("Shutting down...");
    server.close();
    process.exit(0);
  });
}

main().catch(console.error);
