import { ExpertServer, ExpertServerOptions } from "../src/experts/ExpertServer.js";
import { ExpertServerPerms } from "../src/experts/interfaces.js";
import { Request } from "express";
import { generateSecretKey, getPublicKey } from "nostr-tools";
import { getExpertClient } from "../src/experts/ExpertRemoteClient.js";
import { DBExpert } from "../src/db/interfaces.js";

/**
 * Example implementation of ExpertServerPerms
 * This is a simple implementation that allows specific pubkeys and operations
 */
class ExampleExpertServerPerms implements ExpertServerPerms {
  private allowedPubkeys: Set<string> = new Set();
  private allowedOperations: Map<string, Set<string>> = new Map();

  constructor() {}

  addPubkey(pubkey: string) {
    this.allowedPubkeys.add(pubkey);
    this.allowedOperations.set(
      pubkey,
      new Set([
        "GET",
        "POST",
        "PUT",
        "PATCH",
        "DELETE"
      ])
    );
  }

  /**
   * Check if a user is allowed to perform an operation
   * @param pubkey - The public key of the user
   * @param req - The Express request being processed
   * @throws Error if the operation is not allowed with a custom error message
   * @returns Promise that resolves if the operation is allowed
   */
  async checkPerms(pubkey: string, req: Request): Promise<void> {
    // Check if the pubkey is allowed
    if (!this.allowedPubkeys.has(pubkey)) {
      throw new Error(`User ${pubkey} is not authorized to access this server`);
    }

    // Get the allowed operations for this pubkey
    const allowedOps = this.allowedOperations.get(pubkey);

    // If no operations are defined for this pubkey, deny access
    if (!allowedOps) {
      throw new Error(`User ${pubkey} has no defined permissions`);
    }

    // Check if the operation is allowed
    if (!allowedOps.has(req.method)) {
      throw new Error(`User ${pubkey} is not authorized to perform ${req.method} operation`);
    }
  }
}

// Example usage
async function main() {
  // Create the permissions interface
  const perms = new ExampleExpertServerPerms();

  // Create the server with permissions
  const serverOptions: ExpertServerOptions = {
    port: 8881,
    basePath: "/api",
    origin: "http://localhost:8881",
    perms
  };
  
  const server = new ExpertServer(serverOptions);

  // Start the server
  await server.start();

  console.log("ExpertServer started with authentication");
  console.log("Press Ctrl+C to stop");

  // Generate a test key pair
  const privateKey = generateSecretKey();
  const pubkey = getPublicKey(privateKey);

  console.log(`Generated test key pair:`);
  console.log(`Private key: ${Buffer.from(privateKey).toString('hex')}`);
  console.log(`Public key: ${pubkey}`);

  // Add this pubkey to allowed pubkeys for testing
  perms.addPubkey(pubkey);

  // Create a client with authentication
  const client = getExpertClient("http://localhost:8881/api", privateKey);

  try {
    // Test listing experts
    console.log("Listing experts...");
    const experts = await client.listExperts();
    console.log("Experts:", experts);

    // Test creating an expert
    console.log("Creating a test expert...");
    const testExpert: DBExpert = {
      pubkey: "test-expert-" + Date.now(),
      wallet_id: 1,
      type: "test",
      nickname: "Test Expert",
      env: JSON.stringify({
        description: "A test expert created with authentication",
        model: "test-model"
      }),
      docstores: "[]",
      disabled: false
    };

    const insertResult = await client.insertExpert(testExpert);
    console.log("Insert result:", insertResult);

    // Test getting the expert
    console.log("Getting the expert...");
    const expert = await client.getExpert(testExpert.pubkey);
    console.log("Expert:", expert);

    // Test updating the expert
    console.log("Updating the expert...");
    if (expert) {
      // Parse the env JSON, update it, and stringify it back
      const env = JSON.parse(expert.env || "{}");
      env.description = "Updated description";
      expert.env = JSON.stringify(env);
      
      const updateResult = await client.updateExpert(expert);
      console.log("Update result:", updateResult);
    }

    // Test setting disabled status
    console.log("Setting disabled status...");
    const disableResult = await client.setExpertDisabled(testExpert.pubkey, true);
    console.log("Disable result:", disableResult);

    // Test deleting the expert
    console.log("Deleting the expert...");
    const deleteResult = await client.deleteExpert(testExpert.pubkey);
    console.log("Delete result:", deleteResult);

  } catch (error) {
    console.error("Error in client operations:", error);
  }

  // Keep the process running
  process.on("SIGINT", async () => {
    console.log("Shutting down...");
    await server.stop();
    process.exit(0);
  });
}

// Example of trying to access with invalid authentication
async function authErrorExample() {
  try {
    console.log('\n--- Authentication Error Example ---');
    
    // Generate an invalid key (not registered with the server)
    const invalidPrivateKey = generateSecretKey();
    const invalidPubkey = getPublicKey(invalidPrivateKey);
    
    console.log('Using invalid key for authentication:');
    console.log(`Public key: ${invalidPubkey}`);
    
    // Create a client with the invalid key
    const client = getExpertClient("http://localhost:8881/api", invalidPrivateKey);
    
    // This should fail because the pubkey is not registered
    console.log('Attempting to list experts with invalid key...');
    const experts = await client.listExperts();
    console.log('Experts:', experts);
    
  } catch (error) {
    console.error('Authentication error (expected):', error);
    console.log('This error is expected when using an invalid key with an authenticated server');
  }
}

// Run the examples
async function runExamples() {
  // First run the main example with valid authentication
  await main();
  
  // Then run the error example
  setTimeout(authErrorExample, 2000);
}

runExamples().catch(console.error);