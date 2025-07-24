import { Command } from "commander";
import { DocStoreSQLite } from "../../../docstore/index.js";
import { DocstoreCommandOptions, getDocstorePath } from "./index.js";
import { debugError } from "../../../common/debug.js";

/**
 * List all docstores
 * @param options Command options
 */
export async function listDocstores(options: DocstoreCommandOptions): Promise<void> {
  const docstorePath = getDocstorePath(options);

  try {
    const docstore = new DocStoreSQLite(docstorePath);
    const docstores = docstore.listDocstores();

    if (docstores.length === 0) {
      console.log("No docstores found");
    } else {
      console.log("Docstores:");
      docstores.forEach((ds) => {
        console.log(
          `  ID: ${ds.id}, Name: ${ds.name}, Created: ${new Date(
            ds.timestamp * 1000
          ).toISOString()}`
        );
      });
    }

    docstore[Symbol.dispose]();
  } catch (error) {
    debugError(`Error listing docstores: ${error}`);
    process.exit(1);
  }
}

/**
 * Register the list command
 * @param docstoreCommand The parent docstore command
 * @param addPathOption Function to add path option to command
 */
export function registerListCommand(
  docstoreCommand: Command,
  addPathOption: (cmd: Command) => Command
): void {
  const lsCommand = docstoreCommand
    .command("ls")
    .description("List all docstores")
    .action(listDocstores);
  
  addPathOption(lsCommand);
}