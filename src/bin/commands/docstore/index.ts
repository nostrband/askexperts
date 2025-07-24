import { Command } from "commander";
import { DocStoreSQLite } from "../../../docstore/index.js";
import fs from "fs";
import path from "path";
import { debugError, debugDocstore } from "../../../common/debug.js";
import { registerNostrImportCommand } from "./import-nostr.js";
import { registerCreateCommand } from "./create.js";
import { registerListCommand } from "./ls.js";
import { registerRemoveCommand } from "./remove.js";
import { registerCountCommand } from "./count.js";
import { registerAddCommand } from "./add.js";
import { registerDeleteCommand } from "./delete.js";
import { registerGetCommand } from "./get.js";
import { registerListDocsCommand } from "./list.js";
import { registerSearchCommand } from "./search.js";

/**
 * Options for docstore commands
 */
export interface DocstoreCommandOptions {
  path?: string;
  yes?: boolean;
  docstore?: string;
  type?: string;
  id?: string;
  limit?: number;
}

/**
 * Get the docstore path from options or environment
 * @param options Command options
 * @returns The docstore path
 */
export function getDocstorePath(options: DocstoreCommandOptions): string {
  const docstorePath =
    options.path || process.env.DOCSTORE_PATH || "./docstore.db";

  // Ensure the directory exists
  const dir = path.dirname(docstorePath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  return docstorePath;
}

/**
 * Get the docstore ID from options or select the default one
 * @param docstore DocStoreSQLite instance
 * @param options Command options
 * @returns Object containing docstore ID and the docstore object
 * @throws Error if no docstores found or multiple docstores without specified ID
 */
export async function getDocstoreId(
  docstore: DocStoreSQLite,
  options: DocstoreCommandOptions
): Promise<{ docstoreId: string; targetDocstore: any }> {
  debugDocstore("Getting docstore ID from options");
  const docstores = docstore.listDocstores();

  if (docstores.length === 0) {
    debugError("No docstores found");
    throw new Error("No docstores found");
  }

  // If more than one docstore exists, -s option is required
  let docstoreId: string;
  let targetDocstore;

  if (docstores.length > 1 && !options.docstore) {
    debugError("Multiple docstores found but no docstore ID specified");
    throw new Error("Multiple docstores found. Please specify a docstore ID with -s option.");
  } else if (options.docstore) {
    // Use the specified docstore
    targetDocstore = docstores.find(
      (ds) => ds.id.toString() === options.docstore
    );
    if (!targetDocstore) {
      debugError(`Docstore with ID '${options.docstore}' not found`);
      throw new Error(`Docstore with ID '${options.docstore}' not found`);
    }
    docstoreId = options.docstore;
    debugDocstore(`Using specified docstore: ${docstoreId}`);
  } else {
    // Use the only docstore
    docstoreId = docstores[0].id.toString();
    targetDocstore = docstores[0];
    debugDocstore(`Using default docstore: ${docstoreId}`);
  }

  return { docstoreId, targetDocstore };
}

/**
 * Register the docstore command with the CLI
 * @param program The commander program
 */
export function registerDocstoreCommand(program: Command): void {
  const docstoreCommand = program
    .command("docstore")
    .description("Manage document stores");

  // Common options for all subcommands
  const addPathOption = (cmd: Command) =>
    cmd.option("-p, --path <path>", "Path to the docstore database");

  // Register all subcommands
  registerCreateCommand(docstoreCommand, addPathOption);
  registerListCommand(docstoreCommand, addPathOption);
  registerRemoveCommand(docstoreCommand, addPathOption);
  registerCountCommand(docstoreCommand, addPathOption);
  registerAddCommand(docstoreCommand, addPathOption);
  registerDeleteCommand(docstoreCommand, addPathOption);
  registerGetCommand(docstoreCommand, addPathOption);
  registerListDocsCommand(docstoreCommand, addPathOption);
  registerSearchCommand(docstoreCommand, addPathOption);
  
  // Import command
  const importCommand = docstoreCommand
    .command("import")
    .description("Import documents from various sources");
  addPathOption(importCommand);
  
  // Register import subcommands
  registerNostrImportCommand(importCommand);
}