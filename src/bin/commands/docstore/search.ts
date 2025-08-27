import { Command } from "commander";
import {
  ChromaRagDB,
  createRagEmbeddings,
  DocstoreToRag,
} from "../../../rag/index.js";
import {
  DocstoreCommandOptions,
  getDocstore,
  createDocstoreClient,
} from "./index.js";
import { DocStoreClient, Doc } from "../../../docstore/interfaces.js";
import {
  debugDocstore,
  debugError,
  enableAllDebug,
} from "../../../common/debug.js";

/**
 * Search documents in a docstore using vector similarity
 * @param query The search query
 * @param options Command options
 */
export async function searchDocs(
  query: string,
  options: DocstoreCommandOptions
): Promise<void> {
  // Declare variables outside try-catch for cleanup in catch block
  let docstoreClient: DocStoreClient | undefined;
  let docstoreToRag: DocstoreToRag | undefined;
  
  try {
    // Enable debug output if debug flag is set
    if (options.debug) {
      enableAllDebug();
    }

    docstoreClient = await createDocstoreClient(options);
    const docstore = await getDocstore(docstoreClient, options.docstore);

    console.log(
      `Searching in docstore '${docstore.name}' (ID: ${docstore.id})...`
    );

    // Initialize ChromaRagDB and embeddings
    const ragDb = new ChromaRagDB();
    const embeddings = createRagEmbeddings(docstore.model);
    await embeddings.start();

    // Use provided collection name or generate one
    const collectionName = options.collection || `search-${docstore.id}`;
    
    // Skip syncing if the skip-sync flag is provided
    if (!options.skipSync) {
      debugDocstore("Loading documents into search index...");
      
      // Use DocstoreToRag to sync documents
      docstoreToRag = new DocstoreToRag(ragDb, docstoreClient);
      
      // Track document count for reporting
      let count = 0;
      
      // Sync documents from docstore to RAG database
      await new Promise<void>(async (resolve) => {
        if (!docstoreToRag) {
          resolve();
          return;
        }
        
        const syncController = await docstoreToRag.sync({
          docstore_id: docstore.id,
          collection_name: collectionName,
          onDoc: async (doc: Doc) => {
            // Count documents for reporting
            count++;
            return true;
          },
          onEof: () => {
            debugDocstore(`Indexed ${count} documents`);
            syncController.stop();
            resolve();
          }
        });
      });
    } else {
      debugDocstore(`Skipping sync (--skip-sync provided), using collection: ${collectionName}`);
    }

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
        console.log(
          `\n--- Result ${index + 1} (distance: ${result.distance.toFixed(
            4
          )}) ---`
        );
        console.log(`Document ID: ${result.metadata.id}`);
        console.log(`Chunk: ${result.data}`);
        const doc = await docstoreClient.get(docstore.id, result.metadata.id);
        if (doc && doc.type) {
          console.log(`Type: ${doc.type}`);
        }
        if (doc) {
          console.log(
            `Updated at: ${new Date(doc.timestamp * 1000).toISOString()}`
          );
          console.log("Content:");
          console.log(doc.data);
        }
      }
    }

    // Clean up resources
    if (docstoreToRag) {
      docstoreToRag[Symbol.dispose]();
    }
    if (docstoreClient) {
      docstoreClient[Symbol.dispose]();
    }
  } catch (error) {
    debugError(`Error searching documents: ${error}`);
    
    // Ensure resources are cleaned up even on error
    if (docstoreToRag) {
      docstoreToRag[Symbol.dispose]();
    }
    if (docstoreClient) {
      docstoreClient[Symbol.dispose]();
    }
    
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
    .option(
      "-c, --collection <name>",
      "Use the specified RAG collection name (default: search-<docstore_id>)"
    )
    .option(
      "--skip-sync",
      "Skip syncing documents from docstore to RAG (useful for searching in existing collections)"
    )
    .action(searchDocs);

  addCommonOptions(searchCommand);
}
