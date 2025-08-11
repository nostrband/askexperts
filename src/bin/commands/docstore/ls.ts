import { Command } from "commander";
import { DocstoreCommandOptions, createDocstoreClient } from "./index.js";
import { debugError, enableAllDebug } from "../../../common/debug.js";

/**
 * List all docstores
 * @param options Command options
 */
export async function listDocstores(options: DocstoreCommandOptions): Promise<void> {
  try {
    // Enable debug output if debug flag is set
    if (options.debug) {
      enableAllDebug();
    }
    
    // Create docstore client based on options
    const docstoreClient = await createDocstoreClient(options);
    
    // List docstores
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
    .option("-r, --remote", "Use remote client")
    .option("-u, --url <url>", "URL of remote server (default: https://docstore.askexperts.io)")
    .action(listDocstores);
  
  addCommonOptions(lsCommand);
}