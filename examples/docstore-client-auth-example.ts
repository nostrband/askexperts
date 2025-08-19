import { DocStoreWebSocketClient } from '../src/docstore/DocStoreWebSocketClient.js';
import { generateSecretKey, getPublicKey } from 'nostr-tools';

/**
 * Example of using DocStoreWebSocketClient with authentication
 * This example demonstrates how to connect to a DocStoreSQLiteServer with NIP-98 authentication
 */
async function main() {
  try {
    // Generate a key pair for authentication
    const privateKey = generateSecretKey();
    const pubkey = getPublicKey(privateKey);
    
    console.log('Generated key pair for authentication:');
    console.log(`Public key: ${pubkey}`);
    
    // Create a DocStoreWebSocketClient with authentication
    console.log('Connecting to server with authentication...');
    const client = new DocStoreWebSocketClient({
      url: 'ws://localhost:8080',
      privateKey
    });
    
    // Wait for connection
    await client.waitForConnection();
    console.log('Connected to server with authentication');
    
    // List docstores
    console.log('Listing docstores...');
    const docstores = await client.listDocstores();
    console.log('Docstores:', docstores);
    
    // Create a new docstore
    console.log('Creating a new docstore...');
    const docstoreId = await client.createDocstore('Test Docstore', 'test-model', 128);
    console.log(`Created docstore with ID: ${docstoreId}`);
    
    // Get the docstore
    console.log('Getting docstore...');
    const docstore = await client.getDocstore(docstoreId);
    console.log('Docstore:', docstore);
    
    // Upsert a document
    console.log('Upserting a document...');
    const docId = `doc-${Date.now()}`;
    await client.upsert({
      id: docId,
      docstore_id: docstoreId,
      timestamp: Math.floor(Date.now() / 1000),
      created_at: Math.floor(Date.now() / 1000),
      type: 'test',
      data: JSON.stringify({ text: 'Hello, world!' }),
      embeddings: [new Float32Array([0.1, 0.2, 0.3])]
    });
    console.log(`Upserted document with ID: ${docId}`);
    
    // Get the document
    console.log('Getting document...');
    const doc = await client.get(docstoreId, docId);
    console.log('Document:', doc);
    
    // Count documents
    console.log('Counting documents...');
    const count = await client.countDocs(docstoreId);
    console.log(`Document count: ${count}`);
    
    // Delete the document
    console.log('Deleting document...');
    const deleteResult = await client.delete(docstoreId, docId);
    console.log(`Delete result: ${deleteResult}`);
    
    // Delete the docstore
    console.log('Deleting docstore...');
    const deleteDocstoreResult = await client.deleteDocstore(docstoreId);
    console.log(`Delete docstore result: ${deleteDocstoreResult}`);
    
    // Close the connection
    console.log('Closing connection...');
    client[Symbol.dispose]();
    console.log('Connection closed');
    
    console.log('\nExample completed successfully');
  } catch (error) {
    console.error('Error:', error);
  }
}

/**
 * Example of handling authentication errors
 * This demonstrates what happens when you try to connect with an invalid key
 */
async function authErrorExample() {
  try {
    console.log('\n--- Authentication Error Example ---');
    
    // Generate an invalid key (not registered with the server)
    const invalidPrivateKey = generateSecretKey();
    const invalidPubkey = getPublicKey(invalidPrivateKey);
    
    console.log('Using invalid key for authentication:');
    console.log(`Public key: ${invalidPubkey}`);
    
    // Create a client with the invalid key
    console.log('Attempting to connect with invalid key...');
    const client = new DocStoreWebSocketClient({
      url: 'ws://localhost:8080',
      privateKey: invalidPrivateKey
    });
    
    // This will likely fail if the server has authentication enabled
    // and the pubkey is not registered
    await client.waitForConnection();
    
    // If we get here, the server might not have authentication enabled
    // or the key might have been accepted
    console.log('Connected to server (server might not have authentication enabled)');
    
    // Try to list docstores
    console.log('Attempting to list docstores...');
    const docstores = await client.listDocstores();
    console.log('Docstores:', docstores);
    
    // Close the connection
    client[Symbol.dispose]();
    console.log('Connection closed');
  } catch (error) {
    console.error('Authentication error (expected):', error.message);
    console.log('This error is expected when using an invalid key with an authenticated server');
  }
}

/**
 * Example of connecting without authentication
 * This demonstrates what happens when you try to connect to an authenticated server without a key
 */
async function noAuthExample() {
  try {
    console.log('\n--- No Authentication Example ---');
    
    // Create a client without authentication
    console.log('Attempting to connect without authentication...');
    const client = new DocStoreWebSocketClient({
      url: 'ws://localhost:8080'
    });
    
    // This will likely fail if the server has authentication enabled
    await client.waitForConnection();
    
    // If we get here, the server might not have authentication enabled
    console.log('Connected to server (server might not have authentication enabled)');
    
    // Try to list docstores
    console.log('Attempting to list docstores...');
    const docstores = await client.listDocstores();
    console.log('Docstores:', docstores);
    
    // Close the connection
    client[Symbol.dispose]();
    console.log('Connection closed');
  } catch (error) {
    console.error('No authentication error (expected):', error.message);
    console.log('This error is expected when connecting to an authenticated server without a key');
  }
}

// Run the examples
async function runExamples() {
  // First run the main example with valid authentication
  await main();
  
  // Then run the error examples
  await authErrorExample();
  await noAuthExample();
}

runExamples().catch(console.error);