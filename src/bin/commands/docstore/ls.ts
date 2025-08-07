import { Command } from "commander";
import { DocStoreSQLite } from "../../../docstore/index.js";
import { DocstoreCommandOptions, getDocstorePath } from "./index.js";
import { debugError, enableAllDebug } from "../../../common/debug.js";

/**
 * List all docstores
 * @param options Command options
 */
export async function listDocstores(options: DocstoreCommandOptions): Promise<void> {
  const docstorePath = getDocstorePath();

  try {
    // Enable debug output if debug flag is set
    if (options.debug) {
      enableAllDebug();
    }
    
    const docstoreClient = new DocStoreSQLite(docstorePath);
    const docstores = await docstoreClient.listDocstores();

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

    docstoreClient[Symbol.dispose]();
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
  addCommonOptions: (cmd: Command) => Command
): void {
  const lsCommand = docstoreCommand
    .command("ls")
    .description("List all docstores")
    .action(listDocstores);
  
  addCommonOptions(lsCommand);
}