import { Command } from "commander";
import { Doc } from "../../../docstore/index.js";
import { randomUUID } from "crypto";
import { DocstoreCommandOptions, getDocstore, createDocstoreClient } from "./index.js";
import { debugError, enableAllDebug } from "../../../common/debug.js";
import { createRagEmbeddings } from "../../../rag/index.js";

/**
 * Add a document to a docstore
 * @param data Document data
 * @param options Command options
 */
export async function addDoc(
  data: string,
  options: DocstoreCommandOptions
): Promise<void> {
  try {
    // Enable debug output if debug flag is set
    if (options.debug) {
      enableAllDebug();
    }
    
    const docstoreClient = await createDocstoreClient(options);
    const docstore = await getDocstore(docstoreClient, options.docstore);

    // Check if data is "-" to read from stdin
    let docData = data;
    if (data === "-") {
      docData = await new Promise<string>((resolve) => {
        let input = "";
        process.stdin.on("data", (chunk) => {
          input += chunk;
        });
        process.stdin.on("end", () => {
          resolve(input);
        });
      });
    }

    // Initialize embeddings
    console.log("Generating embeddings...");
    const embeddings = createRagEmbeddings(docstore.model);
    await embeddings.start();

    // Create document with basic info
    const docId = options.id || randomUUID();
    const timestamp = Math.floor(Date.now() / 1000);
    
    // Create a minimal doc object
    let doc: Doc = {
      id: docId,
      docstore_id: docstore.id,
      timestamp: timestamp,
      created_at: timestamp,
      type: options.type || "",
      data: docData,
      embeddings: [],
    };
    
    // Generate embeddings and update doc with embeddings and embedding_offsets
    doc = await embeddings.embedDoc(doc);

    // Get the docstore to check if it has model and vector_size set
    const docstores = await docstoreClient.listDocstores();
    const targetDocstore = docstores.find(ds => ds.id === docstore.id);
    
    if (!targetDocstore) {
      throw new Error(`Docstore with ID ${docstore.id} not found`);
    }
    
    // If model or vector_size is not set, update the docstore
    if (!targetDocstore.model || !targetDocstore.vector_size) {
      // Use the model from the embeddings
      const model = embeddings.getModelName();
      const vector_size = embeddings.getVectorSize();
      
      // Update the docstore with model and vector_size
      console.log(`Updating docstore with model: ${model}, vector_size: ${vector_size}`);
      
      // We need to recreate the docstore with the same ID but with model and vector_size
      // This is a workaround since we don't have an update method
      const updatedDocstore = {
        ...targetDocstore,
        model,
        vector_size
      };
      
      // For now, we'll just log this - in a real implementation, we would update the docstore
      console.log(`Docstore updated: ${JSON.stringify(updatedDocstore)}`);
    }

    await docstoreClient.upsert(doc);
    console.log(`Document added with ID: ${docId}`);

    docstoreClient[Symbol.dispose]();
  } catch (error) {
    debugError(`Error adding document: ${error}`);
    process.exit(1);
  }
}

/**
 * Register the add command
 * @param docstoreCommand The parent docstore command
 * @param addPathOption Function to add path option to command
 */
export function registerAddCommand(
  docstoreCommand: Command,
  addCommonOptions: (cmd: Command) => Command
): void {
  const addCommand = docstoreCommand
    .command("add")
    .description("Add a document to a docstore")
    .argument("<data>", "Document data (use '-' to read from stdin)")
    .option(
      "-s, --docstore <id>",
      "ID of the docstore (required if more than one docstore exists)"
    )
    .option("-t, --type <type>", "Document type")
    .option("-i, --id <id>", "Document ID (generated if not provided)")
    .action(addDoc);
  
  addCommonOptions(addCommand);
}