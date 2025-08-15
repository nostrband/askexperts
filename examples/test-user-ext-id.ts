import { getDB } from "../src/db/utils.js";
import { DBServer } from "../src/db/DBServer.js";
import { generateRandomKeyPair } from "../src/common/crypto.js";
import { bytesToHex } from "nostr-tools/utils";
import { createWallet } from "nwc-enclaved-utils";
import { debugServer } from "../src/common/debug.js";

/**
 * Test script for user_id_ext functionality
 * 
 * This script demonstrates:
 * 1. Creating a user with an external ID
 * 2. Retrieving a user by external ID
 * 3. Using ensureExternalUser with an external ID
 */
async function testUserExtId() {
  // Initialize DB
  const db = getDB();
  
  // Create a DBServer instance
  const dbServer = new DBServer({
    port: 3000,
    basePath: "/api"
  });
  
  try {
    console.log("=== Testing user_id_ext functionality ===");
    
    // Generate test data
    const { privateKey, publicKey } = generateRandomKeyPair();
    const { nwcString } = await createWallet();
    const externalId = "external-user-123";
    
    console.log(`\n1. Creating a user with external ID: ${externalId}`);
    // Create a user with an external ID
    const userId = await dbServer.addUser(
      publicKey,
      nwcString,
      bytesToHex(privateKey),
      externalId
    );
    console.log(`User created with ID: ${userId} and external ID: ${externalId}`);
    
    // Verify user was created correctly
    const user = await db.getUser(userId);
    console.log(`User retrieved by ID: ${JSON.stringify(user, null, 2)}`);
    
    console.log(`\n2. Retrieving user by external ID: ${externalId}`);
    // Retrieve user by external ID
    const userByExtId = await db.getUserByExtId(externalId);
    console.log(`User retrieved by external ID: ${JSON.stringify(userByExtId, null, 2)}`);
    
    console.log(`\n3. Testing ensureExternalUser with existing external ID: ${externalId}`);
    // Test ensureExternalUser with existing external ID
    const pubkey1 = await dbServer.ensureExternalUser(externalId);
    console.log(`Ensured external user returned pubkey: ${pubkey1}`);
    console.log(`Original pubkey: ${publicKey}`);
    console.log(`Match: ${pubkey1 === publicKey}`);
    
    console.log(`\n4. Testing ensureExternalUser with new external ID`);
    // Test ensureExternalUser with new external ID
    const newExternalId = "new-external-user-456";
    const pubkey2 = await dbServer.ensureExternalUser(newExternalId);
    console.log(`Ensured new external user returned pubkey: ${pubkey2}`);
    
    // Verify new user was created
    const newUser = await db.getUserByExtId(newExternalId);
    console.log(`New user retrieved by external ID: ${JSON.stringify(newUser, null, 2)}`);
    
    console.log("\n=== All tests completed successfully ===");
  } catch (error) {
    console.error("Error during testing:", error);
  } finally {
    // Clean up
    db[Symbol.dispose]();
  }
}

// Run the test
testUserExtId().catch(console.error);