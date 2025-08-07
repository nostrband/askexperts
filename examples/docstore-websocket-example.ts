#!/usr/bin/env node

import { DocStoreSQLiteServer } from '../src/docstore/DocStoreSQLiteServer.js';
import { DocStoreWebSocketClient } from './docstore-websocket-client.js';
import { Doc } from '../src/docstore/interfaces.js';
import path from 'path';
import fs from 'fs';
import os from 'os';

// Configuration
const PORT = 8081;
const HOST = 'localhost';
const DB_PATH = path.join(os.tmpdir(), 'docstore-websocket-example.db');
const WS_URL = `ws://${HOST}:${PORT}`;

// Create a temporary database file
if (fs.existsSync(DB_PATH)) {
  fs.unlinkSync(DB_PATH);
}

// Main function
async function main() {
  console.log(`Starting DocStoreSQLiteServer on ${HOST}:${PORT}`);
  console.log(`Using database at ${DB_PATH}`);
  
  // Create and start the server
  const server = new DocStoreSQLiteServer(DB_PATH, PORT, HOST);
  
  try {
    // Create a client
    console.log(`Connecting to ${WS_URL}`);
    const client = new DocStoreWebSocketClient(WS_URL);
    
    // Wait for connection
    await client.waitForConnection();
    console.log('Connected to server');
    
    // Create a docstore
    console.log('Creating docstore...');
    const docstoreId = await client.createDocstore('test-docstore', 'test-model', 2, '');
    console.log(`Created docstore with ID: ${docstoreId}`);
    
    // Get the docstore
    console.log('Getting docstore...');
    const docstore = await client.getDocstore(docstoreId);
    console.log('Docstore:', docstore);
    
    // List docstores
    console.log('Listing docstores...');
    const docstores = await client.listDocstores();
    console.log(`Found ${docstores.length} docstores:`, docstores);
    
    // Create a document
    const doc: Doc = {
      id: 'doc-1',
      docstore_id: docstoreId,
      timestamp: Math.floor(Date.now() / 1000),
      created_at: Math.floor(Date.now() / 1000),
      type: 'test',
      data: 'Hello, world!',
      embeddings: [new Float32Array([1.0, 2.0])]
    };
    
    // Upsert the document
    console.log('Upserting document...');
    await client.upsert(doc);
    console.log('Document upserted');
    
    // Get the document
    console.log('Getting document...');
    const retrievedDoc = await client.get(docstoreId, 'doc-1');
    console.log('Retrieved document:', retrievedDoc);
    
    // Count documents
    console.log('Counting documents...');
    const count = await client.countDocs(docstoreId);
    console.log(`Document count: ${count}`);
    
    // Subscribe to documents
    console.log('Subscribing to documents...');
    const subscription = await client.subscribe({
      docstore_id: docstoreId,
      type: 'test'
    }, async (doc) => {
      if (doc) {
        console.log('Received document:', doc);
      } else {
        console.log('End of feed');
      }
    });
    
    // Wait for subscription to receive documents
    console.log('Waiting for subscription to receive documents...');
    await new Promise(resolve => setTimeout(resolve, 2000));
    
    // Upsert another document to test subscription
    const doc2: Doc = {
      id: 'doc-2',
      docstore_id: docstoreId,
      timestamp: Math.floor(Date.now() / 1000),
      created_at: Math.floor(Date.now() / 1000),
      type: 'test',
      data: 'Hello again!',
      embeddings: [new Float32Array([3.0, 4.0])]
    };
    
    console.log('Upserting second document...');
    await client.upsert(doc2);
    console.log('Second document upserted');
    
    // Wait for subscription to receive the new document
    console.log('Waiting for subscription to receive the new document...');
    await new Promise(resolve => setTimeout(resolve, 2000));
    
    // Close the subscription
    console.log('Closing subscription...');
    subscription.close();
    console.log('Subscription closed');
    
    // Delete a document
    console.log('Deleting document...');
    const deleteResult = await client.delete(docstoreId, 'doc-1');
    console.log(`Delete result: ${deleteResult}`);
    
    // Delete the docstore
    console.log('Deleting docstore...');
    const deleteDocstoreResult = await client.deleteDocstore(docstoreId);
    console.log(`Delete docstore result: ${deleteDocstoreResult}`);
    
    // Close the client
    console.log('Closing client...');
    client[Symbol.dispose]();
    console.log('Client closed');
    
  } catch (error) {
    console.error('Error:', error);
  } finally {
    // Close the server
    console.log('Closing server...');
    server.close();
    console.log('Server closed');
    
    // Clean up the database file
    if (fs.existsSync(DB_PATH)) {
      fs.unlinkSync(DB_PATH);
      console.log('Database file deleted');
    }
  }
}

// Run the main function
main().catch(error => {
  console.error('Unhandled error:', error);
  process.exit(1);
});