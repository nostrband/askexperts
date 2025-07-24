import { Command } from "commander";
import { DocStoreSQLite } from "../../../docstore/index.js";
import { DocstoreCommandOptions, getDocstorePath, getDocstoreId } from "./index.js";
import { debugError } from "../../../common/debug.js";

/**
 * List all documents in a docstore
 * @param id Docstore ID
 * @param options Command options
 */
export async function listDocs(
  id: string | undefined,
  options: DocstoreCommandOptions
): Promise<void> {
  const docstorePath = getDocstorePath(options);

  try {
    const docstore = new DocStoreSQLite(docstorePath);
    
    // Get docstore ID
    let docstoreId: string;
    let targetDocstore;
    
    try {
      // If ID is provided via command line argument, use it instead of options
      if (id) {
        options = { ...options, docstore: id };
      }
      
      const result = await getDocstoreId(docstore, options);
      docstoreId = result.docstoreId;
      targetDocstore = result.targetDocstore;
    } catch (error) {
      debugError(`Error: ${error instanceof Error ? error.message : String(error)}`);
      docstore[Symbol.dispose]();
      process.exit(1);
    }

    console.log(
      `Listing all documents in docstore '${targetDocstore.name}' (ID: ${docstoreId})...`
    );

    // Track document count
    let count = 0;

    // Subscribe to all documents without type, since, and until filters
    await new Promise<void>((resolve) => {
      const subscription = docstore.subscribe(
        { docstore_id: docstoreId },
        async (doc) => {
          // If doc is undefined, it signals EOF
          if (!doc) {
            console.log(
              `Fetched all ${count} documents from docstore '${targetDocstore.name}'`
            );
            subscription.close();
            docstore[Symbol.dispose]();
            resolve();
            return;
          }

          console.log(`Document ID: ${doc.id}`);
          console.log(`Type: ${doc.type}`);
          console.log(
            `Created at: ${new Date(doc.created_at * 1000).toISOString()}`
          );
          console.log(
            `Updated at: ${new Date(doc.timestamp * 1000).toISOString()}`
          );
          console.log(
            `Data: ${doc.data.substring(0, 100)}${
              doc.data.length > 100 ? "..." : ""
            }`
          );
          console.log("---");

          count++;
        }
      );
    });
  } catch (error) {
    debugError(`Error listing documents: ${error}`);
    process.exit(1);
  }
}

/**
 * Register the list-docs command
 * @param docstoreCommand The parent docstore command
 * @param addPathOption Function to add path option to command
 */
export function registerListDocsCommand(
  docstoreCommand: Command,
  addPathOption: (cmd: Command) => Command
): void {
  const listCommand = docstoreCommand
    .command("list")
    .description("List all documents in a docstore")
    .argument("[id]", "ID of the docstore (optional if only one docstore exists)")
    .action(listDocs);
  
  addPathOption(listCommand);
}