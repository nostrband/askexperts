import { Command } from "commander";
import { DocStoreSQLite } from "../../../docstore/index.js";
import { DocstoreCommandOptions, getDocstorePath } from "./index.js";
import { debugError } from "../../../common/debug.js";

/**
 * Count documents in a docstore
 * @param id ID of the docstore
 * @param options Command options
 */
export async function countDocs(
  id: string,
  options: DocstoreCommandOptions
): Promise<void> {
  const docstorePath = getDocstorePath(options);

  try {
    const docstore = new DocStoreSQLite(docstorePath);

    // Check if docstore exists
    const docstores = docstore.listDocstores();
    const targetDocstore = docstores.find((ds) => ds.id.toString() === id);

    if (!targetDocstore) {
      debugError(`Docstore with ID '${id}' not found`);
      docstore[Symbol.dispose]();
      process.exit(1);
    }

    const count = docstore.countDocs(id);
    console.log(
      `Docstore '${targetDocstore.name}' (ID: ${id}) contains ${count} document(s)`
    );

    docstore[Symbol.dispose]();
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
  addPathOption: (cmd: Command) => Command
): void {
  const countCommand = docstoreCommand
    .command("count")
    .description("Count documents in a docstore")
    .argument("<id>", "ID of the docstore")
    .action(countDocs);
  
  addPathOption(countCommand);
}