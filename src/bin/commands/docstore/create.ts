import { Command } from "commander";
import { DocStoreSQLite } from "../../../docstore/index.js";
import { DocstoreCommandOptions, getDocstorePath } from "./index.js";
import { debugError } from "../../../common/debug.js";

/**
 * Create a new docstore
 * @param name Name of the docstore
 * @param options Command options
 */
export async function createDocstore(
  name: string,
  options: DocstoreCommandOptions
): Promise<void> {
  const docstorePath = getDocstorePath(options);

  try {
    const docstore = new DocStoreSQLite(docstorePath);
    const docstoreId = docstore.createDocstore(name);
    console.log(`Docstore '${name}' created with ID: ${docstoreId}`);
    docstore[Symbol.dispose]();
  } catch (error) {
    debugError(`Error creating docstore: ${error}`);
    process.exit(1);
  }
}

/**
 * Register the create command
 * @param docstoreCommand The parent docstore command
 * @param addPathOption Function to add path option to command
 */
export function registerCreateCommand(
  docstoreCommand: Command,
  addPathOption: (cmd: Command) => Command
): void {
  const createCommand = docstoreCommand
    .command("create")
    .description("Create a new docstore")
    .argument("<name>", "Name of the docstore")
    .action(createDocstore);
  
  addPathOption(createCommand);
}