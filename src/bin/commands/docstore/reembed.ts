import { Command } from "commander";
import { Doc, Subscription } from "../../../docstore/index.js";
import { DocstoreCommandOptions, getDocstore, createDocstoreClient } from "./index.js";
import { debugError, enableAllDebug, debugDocstore } from "../../../common/debug.js";
import { createRagEmbeddings } from "../../../rag/index.js";

/**
 * Reembed documents in a docstore
 * @param docstoreId ID of the docstore
 * @param options Command options
 */
export async function reembedDocs(
  docstoreId: string,
  options: DocstoreCommandOptions
): Promise<void> {
  try {
    // Enable debug output if debug flag is set
    if (options.debug) {
      enableAllDebug();
    }
    
    // Create docstore client
    const docstoreClient = await createDocstoreClient(options);
    
    // Get the docstore
    const docstore = await getDocstore(docstoreClient, docstoreId);
    
    console.log(`Reembedding documents in docstore: ${docstore.name} (${docstore.id})`);
    console.log(`Model: ${docstore.model}, Vector size: ${docstore.vector_size}`);
    
    // Create embeddings matching the docstore model
    console.log("Initializing embeddings model...");
    const embeddings = createRagEmbeddings(docstore.model);
    await embeddings.start();
    
    // Array to store documents for reembedding
    const docs: Doc[] = [];
    
    // Call 'sync' to subscribe to all documents
    console.log("Fetching documents...");
    
    // Wait for sync to complete
    await new Promise<void>(async (resolve) => {
      const subscription = await docstoreClient.subscribe(
        { docstore_id: docstore.id },
        async (doc?: Doc) => {
          if (doc) {
            // Store document in array
            docs.push(doc);
            if (docs.length % 10 === 0) {
              console.log(`Retrieved ${docs.length} documents...`);
            }
          } else {
            // doc is undefined - this signals end of feed
            debugDocstore("Received end of feed signal");
            subscription.close();
            resolve();
          }
        }
      );
    });
    
    console.log(`Retrieved ${docs.length} documents for reembedding`);
    
    // Process each document
    console.log("Reembedding documents...");
    for (let i = 0; i < docs.length; i++) {
      const doc = docs[i];
      
      try {
        // Rebuild embeddings for the document
        const reembeddedDoc = await embeddings.embedDoc(doc);
        
        // Update the document in the docstore
        await docstoreClient.upsert(reembeddedDoc);
        
        if ((i + 1) % 10 === 0 || i === docs.length - 1) {
          console.log(`Reembedded ${i + 1}/${docs.length} documents`);
        }
      } catch (error) {
        debugError(`Error reembedding document ${doc.id}: ${error}`);
      }
    }
    
    console.log(`Successfully reembedded ${docs.length} documents in docstore ${docstore.id}`);
    
    // Clean up
    docstoreClient[Symbol.dispose]();
    
  } catch (error) {
    debugError(`Error reembedding documents: ${error}`);
    process.exit(1);
  }
}

/**
 * Register the reembed command
 * @param docstoreCommand The parent docstore command
 * @param addCommonOptions Function to add common options to command
 */
export function registerReembedCommand(
  docstoreCommand: Command,
  addCommonOptions: (cmd: Command) => Command
): void {
  const reembedCommand = docstoreCommand
    .command("reembed")
    .description("Rebuild embeddings for all documents in a docstore")
    .argument("[docstore_id]", "ID of the docstore (required if more than one docstore exists)")
    .action(reembedDocs);
  
  addCommonOptions(reembedCommand);
}