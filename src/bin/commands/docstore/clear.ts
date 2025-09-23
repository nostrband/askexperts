import { Command } from "commander";
import { DocstoreCommandOptions, getDocstore, createDocstoreClient } from "./index.js";
import { debugError, enableAllDebug } from "../../../common/debug.js";
import * as readline from "readline";

/**
 * Clear all documents from a docstore
 * @param id Docstore ID
 * @param options Command options
 */
export async function clearDocs(
  id: string | undefined,
  options: DocstoreCommandOptions & { yes?: boolean }
): Promise<void> {
  try {
    // Enable debug output if debug flag is set
    if (options.debug) {
      enableAllDebug();
    }
    
    const docstoreClient = await createDocstoreClient(options);
    const docstore = await getDocstore(docstoreClient, id);

    console.log(
      `Collecting all documents from docstore '${docstore.name}' (ID: ${docstore.id})...`
    );

    // Collect all document IDs first
    const documentIds: string[] = [];

    // Subscribe to all documents to collect their IDs
    await new Promise<void>(async (resolve) => {
      const subscription = await docstoreClient.subscribe(
        { docstore_id: docstore.id },
        async (doc) => {
          // If doc is undefined, it signals EOF
          if (!doc) {
            console.log(
              `Found ${documentIds.length} documents in docstore '${docstore.name}'`
            );
            await subscription.close();
            resolve();
            return;
          }

          documentIds.push(doc.id);
        }
      );
    });

    // If no documents found, exit early
    if (documentIds.length === 0) {
      console.log(`No documents found in docstore '${docstore.name}'. Nothing to clear.`);
      docstoreClient[Symbol.dispose]();
      return;
    }

    // Ask for confirmation unless --yes flag is provided
    if (!options.yes) {
      const confirmed = await askForConfirmation(
        `Are you sure you want to delete all ${documentIds.length} documents from docstore '${docstore.name}' (ID: ${docstore.id})? This action cannot be undone.`
      );
      
      if (!confirmed) {
        console.log("Operation cancelled.");
        docstoreClient[Symbol.dispose]();
        return;
      }
    }

    console.log(`Deleting ${documentIds.length} documents...`);

    // Delete all documents
    let deletedCount = 0;
    let failedCount = 0;

    for (const docId of documentIds) {
      try {
        const result = await docstoreClient.delete(docstore.id, docId);
        if (result) {
          deletedCount++;
          if (options.debug) {
            console.log(`Deleted document: ${docId}`);
          }
        } else {
          failedCount++;
          if (options.debug) {
            console.log(`Failed to delete document: ${docId}`);
          }
        }
      } catch (error) {
        failedCount++;
        if (options.debug) {
          console.log(`Error deleting document ${docId}: ${error}`);
        }
      }
    }

    console.log(`Cleared docstore '${docstore.name}': ${deletedCount} documents deleted successfully`);
    if (failedCount > 0) {
      console.log(`Warning: ${failedCount} documents failed to delete`);
    }

    docstoreClient[Symbol.dispose]();
  } catch (error) {
    debugError(`Error clearing docstore: ${error}`);
    process.exit(1);
  }
}

/**
 * Ask user for confirmation
 * @param message The confirmation message
 * @returns Promise<boolean> true if user confirms, false otherwise
 */
async function askForConfirmation(message: string): Promise<boolean> {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
  });

  return new Promise((resolve) => {
    rl.question(`${message} (y/N): `, (answer) => {
      rl.close();
      const confirmed = answer.toLowerCase().trim() === 'y' || answer.toLowerCase().trim() === 'yes';
      resolve(confirmed);
    });
  });
}

/**
 * Register the clear command
 * @param docstoreCommand The parent docstore command
 * @param addCommonOptions Function to add common options to command
 */
export function registerClearCommand(
  docstoreCommand: Command,
  addCommonOptions: (cmd: Command) => Command
): void {
  const clearCommand = docstoreCommand
    .command("clear")
    .description("Clear all documents from a docstore")
    .argument("[id]", "ID of the docstore (optional if only one docstore exists)")
    .option(
      "-y, --yes",
      "Skip confirmation prompt and proceed with deletion"
    )
    .action(clearDocs);
  
  addCommonOptions(clearCommand);
}