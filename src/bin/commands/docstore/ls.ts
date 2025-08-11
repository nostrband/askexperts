import { Command } from "commander";
import { DocStoreSQLite, DocStoreWebSocketClient } from "../../../docstore/index.js";
import { DocstoreCommandOptions, getDocstorePath } from "./index.js";
import { debugError, enableAllDebug } from "../../../common/debug.js";
import { RemoteClient } from "../../../remote/index.js";

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
    
    let docstoreClient;
    
    // Use remote client if remote flag is set
    if (options.remote) {
      // Use the provided URL or default to https://docstore.askexperts.io
      const serverUrl = options.url || "https://docstore.askexperts.io";
      
      // Create a RemoteClient to get the private key
      const remoteClient = new RemoteClient();
      const privateKey = remoteClient.getPrivateKey();
      
      // Create a DocStoreWebSocketClient with the server URL and private key
      docstoreClient = new DocStoreWebSocketClient(serverUrl, privateKey);
    } else {
      // Use local SQLite client
      const docstorePath = getDocstorePath();
      docstoreClient = new DocStoreSQLite(docstorePath);
    }
    
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