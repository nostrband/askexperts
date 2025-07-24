import { Command } from "commander";
import { DocStoreSQLite } from "../../../docstore/index.js";
import { DocstoreCommandOptions, getDocstorePath, getDocstoreId } from "./index.js";
import { debugError } from "../../../common/debug.js";

/**
 * Get a document by ID
 * @param id Document ID
 * @param options Command options
 */
export async function getDoc(
  id: string,
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

    // Use the get method to retrieve the document
    const foundDoc = docstore.get(docstoreId, id);

    if (foundDoc) {
      console.log(`Document ID: ${foundDoc.id}`);
      console.log(`Docstore ID: ${foundDoc.docstore_id}`);
      console.log(`Type: ${foundDoc.type}`);
      console.log(
        `Created at: ${new Date(foundDoc.created_at * 1000).toISOString()}`
      );
      console.log(
        `Updated at: ${new Date(foundDoc.timestamp * 1000).toISOString()}`
      );
      console.log("Data:");
      console.log(foundDoc.data);
      console.log("Embeddings:");
      console.log(foundDoc.embeddings);
    } else {
      debugError(
        `Document with ID '${id}' not found in docstore '${docstoreId}'`
      );
      process.exit(1);
    }

    docstore[Symbol.dispose]();
  } catch (error) {
    debugError(`Error getting document: ${error}`);
    process.exit(1);
  }
}

/**
 * Register the get command
 * @param docstoreCommand The parent docstore command
 * @param addPathOption Function to add path option to command
 */
export function registerGetCommand(
  docstoreCommand: Command,
  addPathOption: (cmd: Command) => Command
): void {
  const getCommand = docstoreCommand
    .command("get")
    .description("Get a document by ID")
    .argument("<id>", "ID of the document to get")
    .option(
      "-s, --docstore <id>",
      "ID of the docstore (required if more than one docstore exists)"
    )
    .action(getDoc);
  
  addPathOption(getCommand);
}