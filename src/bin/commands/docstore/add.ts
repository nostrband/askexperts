import { Command } from "commander";
import { DocStoreSQLite, Doc } from "../../../docstore/index.js";
import { XenovaEmbeddings } from "../../../rag/index.js";
import { randomUUID } from "crypto";
import { DocstoreCommandOptions, getDocstorePath, getDocstoreId } from "./index.js";
import { debugError } from "../../../common/debug.js";

/**
 * Add a document to a docstore
 * @param data Document data
 * @param options Command options
 */
export async function addDoc(
  data: string,
  options: DocstoreCommandOptions
): Promise<void> {
  const docstorePath = getDocstorePath(options);

  try {
    const docstore = new DocStoreSQLite(docstorePath);
    
    // Get docstore ID
    let docstoreId: string;
    try {
      const result = await getDocstoreId(docstore, options);
      docstoreId = result.docstoreId;
    } catch (error) {
      debugError(`Error: ${error instanceof Error ? error.message : String(error)}`);
      docstore[Symbol.dispose]();
      process.exit(1);
    }

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

    // Generate embeddings
    console.log("Generating embeddings...");
    const embeddings = new XenovaEmbeddings();
    await embeddings.start();
    const chunks = await embeddings.embed(docData);

    // Create document
    const docId = options.id || randomUUID();
    const timestamp = Math.floor(Date.now() / 1000);

    const doc: Doc = {
      id: docId,
      docstore_id: docstoreId,
      timestamp: timestamp,
      created_at: timestamp,
      type: options.type || "",
      data: docData,
      embeddings: JSON.stringify(chunks.map(c => c.embedding)),
    };

    docstore.upsert(doc);
    console.log(`Document added with ID: ${docId}`);

    docstore[Symbol.dispose]();
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
  addPathOption: (cmd: Command) => Command
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
  
  addPathOption(addCommand);
}