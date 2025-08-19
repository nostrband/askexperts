/**
 * Example demonstrating the use of DocStoreLocalClient
 * 
 * This example shows how to:
 * 1. Create a DocStoreLocalClient instance
 * 2. Create a docstore
 * 3. Add documents to the docstore
 * 4. Retrieve documents from the docstore
 * 5. List all docstores
 * 6. Count documents in a docstore
 */

import { DocStoreLocalClient, Doc } from '../src/docstore/index.js';
import path from 'path';
import { fileURLToPath } from 'url';

// Get the directory name of the current module
const __dirname = path.dirname(fileURLToPath(import.meta.url));

async function main() {
  try {
    // Create a DocStoreLocalClient instance with a path to the SQLite database
    const dbPath = path.join(__dirname, 'example-docstore.db');
    console.log(`Using database at: ${dbPath}`);
    
    const client = new DocStoreLocalClient(dbPath);
    
    // Create a docstore
    const docstoreName = 'example-docstore';
    const modelName = 'example-model';
    const vectorSize = 4; // Small vector size for example purposes
    
    console.log(`Creating docstore: ${docstoreName}`);
    const docstoreId = await client.createDocstore(docstoreName, modelName, vectorSize);
    console.log(`Created docstore with ID: ${docstoreId}`);
    
    // Create a document with embeddings
    const doc: Doc = {
      id: 'doc1',
      docstore_id: docstoreId,
      timestamp: Math.floor(Date.now() / 1000),
      created_at: Math.floor(Date.now() / 1000),
      type: 'example',
      data: JSON.stringify({ title: 'Example Document', content: 'This is an example document.' }),
      embeddings: [new Float32Array([0.1, 0.2, 0.3, 0.4])],
    };
    
    // Add the document to the docstore
    console.log(`Adding document with ID: ${doc.id}`);
    await client.upsert(doc);
    
    // Retrieve the document
    console.log(`Retrieving document with ID: ${doc.id}`);
    const retrievedDoc = await client.get(docstoreId, doc.id);
    console.log('Retrieved document:', {
      id: retrievedDoc?.id,
      type: retrievedDoc?.type,
      data: retrievedDoc?.data,
      embeddings: retrievedDoc?.embeddings?.map(e => Array.from(e)),
    });
    
    // List all docstores
    console.log('Listing all docstores:');
    const docstores = await client.listDocstores();
    docstores.forEach(ds => {
      console.log(`- ${ds.name} (${ds.id}): model=${ds.model}, vector_size=${ds.vector_size}`);
    });
    
    // Count documents in the docstore
    const count = await client.countDocs(docstoreId);
    console.log(`Number of documents in docstore ${docstoreName}: ${count}`);
    
    // Subscribe to documents in the docstore
    console.log(`Subscribing to documents in docstore: ${docstoreId}`);
    const subscription = await client.subscribe(
      { docstore_id: docstoreId },
      async (doc) => {
        if (doc) {
          console.log(`Received document: ${doc.id}, type: ${doc.type}`);
        } else {
          console.log('End of document stream');
        }
      }
    );
    
    // Wait for a moment to receive documents
    await new Promise(resolve => setTimeout(resolve, 1000));
    
    // Close the subscription
    subscription.close();
    
    // Clean up resources
    client[Symbol.dispose]();
    console.log('Example completed successfully');
  } catch (error) {
    console.error('Error in example:', error);
  }
}

main();