import { Command } from "commander";
import { DocStoreSQLite } from "../../../docstore/index.js";
import { DocstoreCommandOptions, getDocstorePath, getDocstore } from "./index.js";
import { debugError, enableAllDebug } from "../../../common/debug.js";

/**
 * Delete a document from a docstore
 * @param id Document ID
 * @param options Command options
 */
export async function deleteDoc(
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
    const result = await docstoreClient.delete(docstore.id, id);

    if (result) {
      console.log(`Document with ID '${id}' deleted successfully`);
    } else {
      debugError(
        `Document with ID '${id}' not found in docstore '${docstore.id}'`
      );
      process.exit(1);
    }

    docstoreClient[Symbol.dispose]();
  } catch (error) {
    debugError(`Error deleting document: ${error}`);
    process.exit(1);
  }
}

/**
 * Register the delete command
 * @param docstoreCommand The parent docstore command
 * @param addPathOption Function to add path option to command
 */
export function registerDeleteCommand(
  docstoreCommand: Command,
  addCommonOptions: (cmd: Command) => Command
): void {
  const deleteCommand = docstoreCommand
    .command("delete")
    .description("Delete a document from a docstore")
    .argument("<id>", "ID of the document to delete")
    .option(
      "-s, --docstore <id>",
      "ID of the docstore (required if more than one docstore exists)"
    )
    .action(deleteDoc);
  
  addCommonOptions(deleteCommand);
}