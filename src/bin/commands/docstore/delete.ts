import { Command } from "commander";
import { DocStoreSQLite } from "../../../docstore/index.js";
import { DocstoreCommandOptions, getDocstorePath, getDocstoreId } from "./index.js";
import { debugError } from "../../../common/debug.js";

/**
 * Delete a document from a docstore
 * @param id Document ID
 * @param options Command options
 */
export async function deleteDoc(
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

    const result = docstore.delete(docstoreId, id);

    if (result) {
      console.log(`Document with ID '${id}' deleted successfully`);
    } else {
      debugError(
        `Document with ID '${id}' not found in docstore '${docstoreId}'`
      );
      process.exit(1);
    }

    docstore[Symbol.dispose]();
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
  addPathOption: (cmd: Command) => Command
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
  
  addPathOption(deleteCommand);
}