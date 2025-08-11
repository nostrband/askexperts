import { Command } from "commander";
import { ChromaRagDB, createRagEmbeddings, RagDocument } from "../../../rag/index.js";
import { DocstoreCommandOptions, getDocstore, createDocstoreClient } from "./index.js";
import { debugDocstore, debugError, enableAllDebug } from "../../../common/debug.js";

/**
 * Search documents in a docstore using vector similarity
 * @param query The search query
 * @param options Command options
 */
export async function searchDocs(
  query: string,
  options: DocstoreCommandOptions
): Promise<void> {
  try {
    // Enable debug output if debug flag is set
    if (options.debug) {
      enableAllDebug();
    }
    
    const docstoreClient = await createDocstoreClient(options);
    const docstore = await getDocstore(docstoreClient, options.docstore);

    console.log(`Searching in docstore '${docstore.name}' (ID: ${docstore.id})...`);
    
    // Initialize ChromaRagDB and XenovaEmbeddings
    const ragDb = new ChromaRagDB();
    const embeddings = createRagEmbeddings(docstore.model);
    await embeddings.start();
    
    const collectionName = `search-${docstore.id}`;
    debugDocstore("Loading documents into search index...");
    
    // Track document count and batch for efficient storage
    let count = 0;
    let batch: RagDocument[] = [];
    
    // Subscribe to all documents
    await new Promise<void>(async (resolve) => {
      const subscription = await docstoreClient.subscribe(
        { docstore_id: docstore.id },
        async (doc) => {
          try {
            // If doc is undefined, it signals EOF
            if (!doc) {
              // Store any remaining documents
              if (batch.length > 0) {
                debugDocstore("Writing last batch to db", batch.length);
                await ragDb.storeBatch(collectionName, batch);
                batch = [];
              }
              
              debugDocstore(`Indexed ${count} documents`);
              await subscription.close();
              resolve();
              return;
            }
            
            // Use embeddings directly if they exist
            if (doc.embeddings && doc.embeddings.length > 0) {
              // Convert Float32Array to regular arrays for the RAG DB
              const embeddings = doc.embeddings.map(embedding => {
                // Convert Float32Array to regular array
                return Array.from(embedding);
              });
              
              // Add each embedding as a separate document in the RAG DB
              for (let i = 0; i < embeddings.length; i++) {
                const chunkId = `${doc.id}-${i}`;
                batch.push({
                  id: chunkId,
                  vector: embeddings[i],
                  metadata: {
                    docId: doc.id,
                  }
                });
              }
              
              // Store in batches of 100
              if (batch.length >= 100) {
                debugDocstore("Writing batch to db", batch.length);
                await ragDb.storeBatch(collectionName, batch);
                batch = [];
              }
            }
            
            count++;
          } catch (error) {
            debugError(`Error processing document: ${error}`);
            await subscription.close();
            resolve();
          }
        }
      );
    });
    
    // Now perform the search
    debugDocstore(`Searching for: "${query}"`);
    
    // Generate embeddings for the query
    const queryChunks = await embeddings.embed(query);
    if (queryChunks.length === 0) {
      debugError("Failed to generate embeddings for the query");
      docstoreClient[Symbol.dispose]();
      process.exit(1);
    }
    
    // Use the first chunk's embedding for the search
    const queryVector = queryChunks[0].embedding;
    
    // Set default limit if not provided
    const limit = options.limit || 10;
    
    // Search for similar documents
    const results = await ragDb.search(collectionName, queryVector, limit);
    
    if (results.length === 0) {
      console.error("No matching documents found");
    } else {
      debugDocstore(`Found ${results.length} matching documents:`);
      
      // Use for...of instead of forEach to allow await
      for (const [index, result] of results.entries()) {
        console.log(`\n--- Result ${index + 1} (distance: ${(result.distance).toFixed(4)}) ---`);
        console.log(`Document ID: ${result.metadata.docId}`);
        const doc = await docstoreClient.get(docstore.id, result.metadata.docId);
        if (doc && doc.type) {
          console.log(`Type: ${doc.type}`);
        }
        if (doc) {
          console.log(`Updated at: ${new Date(doc.timestamp * 1000).toISOString()}`);
          console.log("Content:");
          console.log(doc.data);
        }
      }
    }
    
    docstoreClient[Symbol.dispose]();
  } catch (error) {
    debugError(`Error searching documents: ${error}`);
    process.exit(1);
  }
}

/**
 * Register the search command
 * @param docstoreCommand The parent docstore command
 * @param addPathOption Function to add path option to command
 */
export function registerSearchCommand(
  docstoreCommand: Command,
  addCommonOptions: (cmd: Command) => Command
): void {
  const searchCommand = docstoreCommand
    .command("search")
    .description("Search documents in a docstore using vector similarity")
    .argument("<query>", "Search query")
    .option(
      "-s, --docstore <id>",
      "ID of the docstore (optional if only one docstore exists)"
    )
    .option(
      "-l, --limit <number>",
      "Maximum number of results to return",
      (value) => parseInt(value, 10),
      10
    )
    .action(searchDocs);
  
  addCommonOptions(searchCommand);
}