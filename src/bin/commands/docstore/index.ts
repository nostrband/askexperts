import { Command } from "commander";
import { DocStore, DocStoreClient, DocStoreLocalClient, DocStoreWebSocketClient } from "../../../docstore/index.js";
import fs from "fs";
import path from "path";
import { debugError, debugDocstore } from "../../../common/debug.js";
import { APP_DOCSTORE_PATH } from "../../../common/constants.js";
import { registerImportCommand } from "./import/index.js";
import { registerCreateCommand } from "./create.js";
import { registerListCommand } from "./ls.js";
import { registerRemoveCommand } from "./remove.js";
import { registerCountCommand } from "./count.js";
import { registerAddCommand } from "./add.js";
import { registerDeleteCommand } from "./delete.js";
import { registerGetCommand } from "./get.js";
import { registerListDocsCommand } from "./list.js";
import { registerSearchCommand } from "./search.js";
import { registerServerCommand } from "./server.js";
import { registerReembedCommand } from "./reembed.js";
import { registerClearCommand } from "./clear.js";
import { getCurrentUserId } from "../../../common/users.js";
import { getDB } from "../../../db/index.js";
import { hexToBytes } from "nostr-tools/utils";

/**
 * Options for docstore commands
 */
export interface DocstoreCommandOptions {
  debug?: boolean;
  yes?: boolean;
  docstore?: string;
  type?: string;
  id?: string;
  limit?: number;
  remote?: boolean;
  url?: string;
  collection?: string;
  skipSync?: boolean;
  context?: boolean;
}

/**
 * Get the fixed docstore path from constants
 * @returns The docstore path
 */
export function getDocstorePath(): string {
  // Ensure the directory exists
  const dir = path.dirname(APP_DOCSTORE_PATH);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  return APP_DOCSTORE_PATH;
}

/**
 * Get the docstore ID from options or select the default one
 * @param client DocStoreSQLite instance
 * @param options Command options
 * @returns Object containing docstore ID and the docstore object
 * @throws Error if no docstores found or multiple docstores without specified ID
 */
export async function getDocstore(
  client: DocStoreClient,
  docstoreId?: string
): Promise<DocStore> {
  if (docstoreId) {
    const docstore = await client.getDocstore(docstoreId);
    if (!docstore) throw new Error("Docstore not found");
    return docstore;
  }

  const docstores = await client.listDocstores();
  if (docstores.length === 0) {
    debugError("No docstores found");
    throw new Error("No docstores found");
  }

  if (docstores.length > 1 && !client) {
    debugError("Multiple docstores found but no docstore ID specified");
    throw new Error("Multiple docstores found. Please specify a docstore ID with -s option.");
  }
  
  // Use the only docstore
  debugDocstore(`Using default docstore: ${docstores[0].id}`);
  return docstores[0];
}

/**
 * Create a docstore client based on command options
 * @param options Command options
 * @returns DocStoreClient instance (either DocStoreSQLite or DocStoreWebSocketClient)
 */
export async function createDocstoreClient(options: DocstoreCommandOptions): Promise<DocStoreClient> {
  // Use remote client if remote flag is set
  if (options.remote) {
    // Use the provided URL or default to wss://docstore.askexperts.io
    const serverUrl = options.url || "wss://docstore.askexperts.io";

    // Get the current user ID
    const userId = getCurrentUserId();
    
    // Get the user's private key
    const user = await getDB().getUser(userId);
    if (!user) {
      throw new Error(`User with ID ${userId} not found`);
    }
    
    // Convert the private key string to Uint8Array
    const privkey = hexToBytes(user.privkey);
    
    // Create a DocStoreWebSocketClient with the server URL and private key
    return new DocStoreWebSocketClient({
      url: serverUrl,
      privateKey: privkey
    });
  } else {
    // Use local SQLite client
    const docstorePath = getDocstorePath();
    return new DocStoreLocalClient(docstorePath);
  }
}

/**
 * Register the docstore command with the CLI
 * @param program The commander program
 */
export function registerDocstoreCommand(program: Command): void {
  const docstoreCommand = program
    .command("docstore")
    .description("Manage document stores");

  // Add debug option to all subcommands
  const addDebugOption = (cmd: Command) =>
    cmd.option("-d, --debug", "Enable debug output");

  // Add remote options to a command
  const addRemoteOptions = (cmd: Command) =>
    cmd
      .option("-r, --remote", "Use remote client")
      .option("-u, --url <url>", "URL of remote server (default: wss://docstore.askexperts.io)");

  // Helper to add all common options
  const addCommonOptions = (cmd: Command) => {
    addDebugOption(cmd);
    // Add remote options to all commands except server
    if (cmd.name() !== "server") {
      addRemoteOptions(cmd);
    }
    return cmd;
  };

  // Register all subcommands
  registerCreateCommand(docstoreCommand, addCommonOptions);
  registerListCommand(docstoreCommand, addCommonOptions);
  registerRemoveCommand(docstoreCommand, addCommonOptions);
  registerCountCommand(docstoreCommand, addCommonOptions);
  registerAddCommand(docstoreCommand, addCommonOptions);
  registerDeleteCommand(docstoreCommand, addCommonOptions);
  registerGetCommand(docstoreCommand, addCommonOptions);
  registerListDocsCommand(docstoreCommand, addCommonOptions);
  registerSearchCommand(docstoreCommand, addCommonOptions);
  registerServerCommand(docstoreCommand, addCommonOptions);
  registerReembedCommand(docstoreCommand, addCommonOptions);
  registerClearCommand(docstoreCommand, addCommonOptions);
  
  // Register import command with its subcommands
  registerImportCommand(docstoreCommand, addCommonOptions);
}