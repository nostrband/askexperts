import { Command } from "commander";
import { DocstoreCommandOptions, createDocstoreClient } from "./index.js";
import { debugError, enableAllDebug } from "../../../common/debug.js";
import { createInterface } from "readline";

/**
 * Delete a docstore
 * @param id ID of the docstore to delete
 * @param options Command options
 */
export async function removeDocstore(
  id: string,
  options: DocstoreCommandOptions
): Promise<void> {
  try {
    // Enable debug output if debug flag is set
    if (options.debug) {
      enableAllDebug();
    }
    
    const docstoreClient = await createDocstoreClient(options);

    // Check if docstore exists
    const docstores = await docstoreClient.listDocstores();
    const targetDocstore = docstores.find((ds) => ds.id.toString() === id);

    if (!targetDocstore) {
      debugError(`Docstore with ID '${id}' not found`);
      docstoreClient[Symbol.dispose]();
      process.exit(1);
    }

    // Confirm deletion unless -y flag is provided
    if (!options.yes) {
      const rl = createInterface({
        input: process.stdin,
        output: process.stdout,
      });

      const answer = await new Promise<string>((resolve) => {
        rl.question(
          `Are you sure you want to delete docstore '${targetDocstore.name}' (ID: ${id})? [y/N] `,
          resolve
        );
      });

      rl.close();

      if (answer.toLowerCase() !== "y" && answer.toLowerCase() !== "yes") {
        console.log("Operation cancelled");
        docstoreClient[Symbol.dispose]();
        return;
      }
    }

    const result = await docstoreClient.deleteDocstore(id);

    if (result) {
      console.log(
        `Docstore '${targetDocstore.name}' (ID: ${id}) deleted successfully`
      );
    } else {
      debugError(`Failed to delete docstore with ID '${id}'`);
      process.exit(1);
    }

    docstoreClient[Symbol.dispose]();
  } catch (error) {
    debugError(`Error removing docstore: ${error}`);
    process.exit(1);
  }
}

/**
 * Register the remove command
 * @param docstoreCommand The parent docstore command
 * @param addPathOption Function to add path option to command
 */
export function registerRemoveCommand(
  docstoreCommand: Command,
  addCommonOptions: (cmd: Command) => Command
): void {
  const rmCommand = docstoreCommand
    .command("rm")
    .description("Delete a docstore")
    .argument("<id>", "ID of the docstore to delete")
    .option("-y, --yes", "Skip confirmation prompt")
    .action(removeDocstore);
  
  addCommonOptions(rmCommand);
}