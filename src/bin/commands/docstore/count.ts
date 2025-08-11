import { Command } from "commander";
import { DocstoreCommandOptions, getDocstore, createDocstoreClient } from "./index.js";
import { debugError, enableAllDebug } from "../../../common/debug.js";

/**
 * Count documents in a docstore
 * @param id ID of the docstore
 * @param options Command options
 */
export async function countDocs(
  id: string,
  options: DocstoreCommandOptions
): Promise<void> {
  try {
    // Enable debug output if debug flag is set
    if (options.debug) {
      enableAllDebug();
    }
    
    const docstoreClient = await createDocstoreClient(options);
    const docstore = await getDocstore(docstoreClient, options.docstore);
    const count = docstoreClient.countDocs(id);
    console.log(
      `Docstore '${docstore.name}' (ID: ${id}) contains ${count} document(s)`
    );
    docstoreClient[Symbol.dispose]();
  } catch (error) {
    debugError(`Error counting documents: ${error}`);
    process.exit(1);
  }
}

/**
 * Register the count command
 * @param docstoreCommand The parent docstore command
 * @param addPathOption Function to add path option to command
 */
export function registerCountCommand(
  docstoreCommand: Command,
  addCommonOptions: (cmd: Command) => Command
): void {
  const countCommand = docstoreCommand
    .command("count")
    .description("Count documents in a docstore")
    .argument("<id>", "ID of the docstore")
    .action(countDocs);
  
  addCommonOptions(countCommand);
}