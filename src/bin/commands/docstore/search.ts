import { Command } from "commander";
import { DocStoreSQLite } from "../../../docstore/index.js";
import { XenovaEmbeddings, ChromaRagDB, RagDocument } from "../../../rag/index.js";
import { DocstoreCommandOptions, getDocstorePath, getDocstoreId } from "./index.js";
import { debugError } from "../../../common/debug.js";

/**
 * Search documents in a docstore using vector similarity
 * @param query The search query
 * @param options Command options
 */
export async function searchDocs(
  query: string,
  options: DocstoreCommandOptions
): Promise<void> {
  const docstorePath = getDocstorePath(options);

  try {
    const docstore = new DocStoreSQLite(docstorePath);
    
    // Get docstore ID
    let docstoreId: string;
    let targetDocstore;
    
    try {
      const result = await getDocstoreId(docstore, options);
      docstoreId = result.docstoreId;
      targetDocstore = result.targetDocstore;
    } catch (error) {
      debugError(`Error: ${error instanceof Error ? error.message : String(error)}`);
      docstore[Symbol.dispose]();
      process.exit(1);
    }

    console.log(`Searching in docstore '${targetDocstore.name}' (ID: ${docstoreId})...`);
    
    // Initialize ChromaRagDB and XenovaEmbeddings
    const ragDb = new ChromaRagDB();
    const embeddings = new XenovaEmbeddings();
    await embeddings.start();
    
    const collectionName = `search-${docstoreId}`;
    console.log("Loading documents into search index...");
    
    // Track document count and batch for efficient storage
    let count = 0;
    let batch: RagDocument[] = [];
    
    // Subscribe to all documents
    await new Promise<void>((resolve) => {
      const subscription = docstore.subscribe(
        { docstore_id: docstoreId },
        async (doc) => {
          try {
            // If doc is undefined, it signals EOF
            if (!doc) {
              // Store any remaining documents
              if (batch.length > 0) {
                console.log("Writing last batch to db", batch.length);
                await ragDb.storeBatch(collectionName, batch);
                batch = [];
              }
              
              console.log(`Indexed ${count} documents`);
              subscription.close();
              resolve();
              return;
            }
            
            // Parse embeddings if they exist
            let docEmbeddings: number[][] = [];
            if (doc.embeddings) {
              try {
                docEmbeddings = JSON.parse(doc.embeddings);
              } catch (e) {
                console.warn(`Failed to parse embeddings for document ${doc.id}: ${e}`);
              }
            }
            
            // Add each embedding as a separate document in the RAG DB
            for (let i = 0; i < docEmbeddings.length; i++) {
              const chunkId = `${doc.id}-${i}`;
              batch.push({
                id: chunkId,
                vector: docEmbeddings[i],
                metadata: {
                  docId: doc.id,
                }
              });
              
              // Store in batches of 100
              if (batch.length >= 100) {
                console.log("Writing batch to db", batch.length);
                await ragDb.storeBatch(collectionName, batch);
                batch = [];
              }
            }
            
            count++;
          } catch (error) {
            debugError(`Error processing document: ${error}`);
            subscription.close();
            resolve();
          }
        }
      );
    });
    
    // Now perform the search
    console.log(`Searching for: "${query}"`);
    
    // Generate embeddings for the query
    const queryChunks = await embeddings.embed(query);
    if (queryChunks.length === 0) {
      debugError("Failed to generate embeddings for the query");
      docstore[Symbol.dispose]();
      process.exit(1);
    }
    
    // Use the first chunk's embedding for the search
    const queryVector = queryChunks[0].embedding;
    
    // Set default limit if not provided
    const limit = options.limit || 10;
    
    // Search for similar documents
    const results = await ragDb.search(collectionName, queryVector, limit);
    
    if (results.length === 0) {
      console.log("No matching documents found");
    } else {
      console.log(`Found ${results.length} matching documents:`);
      results.forEach((result, index) => {
        console.log(`\n--- Result ${index + 1} (distance: ${(result.distance).toFixed(4)}) ---`);
        console.log(`Document ID: ${result.metadata.docId}`);
        const doc = docstore.get(docstoreId, result.metadata.docId);
        if (doc!.type) {
          console.log(`Type: ${doc!.type}`);
        }
        console.log(`Updated at: ${new Date(doc!.timestamp * 1000).toISOString()}`);
        console.log("Content:");
        console.log(doc!.data);
      });
    }
    
    docstore[Symbol.dispose]();
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
  addPathOption: (cmd: Command) => Command
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
  
  addPathOption(searchCommand);
}