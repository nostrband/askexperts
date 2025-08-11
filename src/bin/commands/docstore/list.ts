import { Command } from "commander";
import { DocstoreCommandOptions, getDocstore, createDocstoreClient } from "./index.js";
import { debugError, enableAllDebug } from "../../../common/debug.js";

/**
 * List all documents in a docstore
 * @param id Docstore ID
 * @param options Command options
 */
export async function listDocs(
  id: string | undefined,
  options: DocstoreCommandOptions
): Promise<void> {
  try {
    // Enable debug output if debug flag is set
    if (options.debug) {
      enableAllDebug();
    }
    
    const docstoreClient = await createDocstoreClient(options);
    const docstore = await getDocstore(docstoreClient, options.docstore);

    console.log(
      `Listing all documents in docstore '${docstore.name}' (ID: ${docstore.id})...`
    );

    // Track document count
    let count = 0;

    // Subscribe to all documents without type, since, and until filters
    await new Promise<void>(async (resolve) => {
      const subscription = await docstoreClient.subscribe(
        { docstore_id: docstore.id },
        async (doc) => {
          // If doc is undefined, it signals EOF
          if (!doc) {
            console.log(
              `Fetched all ${count} documents from docstore '${docstore.name}'`
            );
            await subscription.close();
            docstoreClient[Symbol.dispose]();
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
  addCommonOptions: (cmd: Command) => Command
): void {
  const listCommand = docstoreCommand
    .command("list")
    .description("List all documents in a docstore")
    .argument("[id]", "ID of the docstore (optional if only one docstore exists)")
    .action(listDocs);
  
  addCommonOptions(listCommand);
}