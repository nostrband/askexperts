import { Command } from "commander";
import { DocStoreSQLite } from "../../../docstore/index.js";
import { DocstoreCommandOptions, getDocstorePath, getDocstore } from "./index.js";
import { debugError, enableAllDebug } from "../../../common/debug.js";

/**
 * Get a document by ID
 * @param id Document ID
 * @param options Command options
 */
export async function getDoc(
  id: string,
  options: DocstoreCommandOptions
): Promise<void> {
  const docstorePath = getDocstorePath();

  try {
    // Enable debug output if debug flag is set
    if (options.debug) {
      enableAllDebug();
    }
    
    const docstoreClient = new DocStoreSQLite(docstorePath);
    const docstore = await getDocstore(docstoreClient, options.docstore);

    // Use the get method to retrieve the document
    const foundDoc = docstoreClient.get(docstore.id, id);

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
        `Document with ID '${id}' not found in docstore '${docstore.id}'`
      );
      process.exit(1);
    }

    docstoreClient[Symbol.dispose]();
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
  addCommonOptions: (cmd: Command) => Command
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
  
  addCommonOptions(getCommand);
}