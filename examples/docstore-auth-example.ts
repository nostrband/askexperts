import { DocStoreSQLiteServer } from "../src/docstore/DocStoreSQLiteServer.js";
import { DocStorePerms, WebSocketMessage } from "../src/docstore/interfaces.js";
import WebSocket from "ws";
import { generateSecretKey, getPublicKey, finalizeEvent } from "nostr-tools";
import { createHash } from "crypto";

// Helper function to create a digest hash
function digest(algorithm: string, data: string): string {
  return createHash(algorithm).update(data).digest("hex");
}

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
   * @returns Promise that resolves with true if the user is valid, false otherwise
   */
  async isUser(pubkey: string): Promise<boolean> {
    return this.allowedPubkeys.has(pubkey);
  }

  /**
   * Check if a user is allowed to perform an operation
   * @param pubkey - The public key of the user
   * @param message - The WebSocket message being processed
   * @returns Promise that resolves with true if the operation is allowed, false otherwise
   */
  async isAllowed(pubkey: string, message: WebSocketMessage): Promise<boolean> {
    // Get the allowed operations for this pubkey
    const allowedOps = this.allowedOperations.get(pubkey);

    // If no operations are defined for this pubkey, deny access
    if (!allowedOps) {
      return false;
    }

    // Check if the operation is allowed
    return allowedOps.has(message.method);
  }
}

/**
 * Create a NIP-98 auth token for WebSocket connection
 * @param privateKey - The private key to sign the event with
 * @param url - The URL to connect to
 * @param method - The HTTP method (usually 'GET' for WebSocket)
 * @returns The authorization header value
 */
function createAuthToken(
  privateKey: Uint8Array,
  url: string,
  method: string
): string {
  // Create a NIP-98 event
  const event = {
    kind: 27235,
    created_at: Math.floor(Date.now() / 1000),
    tags: [
      ["u", url],
      ["method", method],
      // No payload tag for WebSocket connections
    ],
    content: "",
    pubkey: getPublicKey(privateKey),
  };

  // Sign the event
  const signedEvent = finalizeEvent(event, privateKey);

  // Convert to base64
  const base64Event = Buffer.from(JSON.stringify(signedEvent)).toString(
    "base64"
  );

  // Return the authorization header value
  return `Nostr ${base64Event}`;
}

// Example usage
async function main() {
  // Create the permissions interface
  const perms = new ExampleDocStorePerms();

  // Create the server with permissions
  const server = new DocStoreSQLiteServer(
    "./docstore.db",
    8880,
    "localhost",
    perms
  );

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
