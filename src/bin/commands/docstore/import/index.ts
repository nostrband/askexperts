import { Command } from "commander";
import { registerNostrImportCommand } from "./nostr.js";
import { registerMarkdownImportCommand } from "./markdown.js";
import { registerTwitterImportCommand } from "./twitter.js";
import { registerDirImportCommand } from "./dir.js";

/**
 * Register the import command with its subcommands
 * @param docstoreCommand The parent docstore command
 * @param addCommonOptions Function to add common options to commands
 */
export function registerImportCommand(
  docstoreCommand: Command,
  addCommonOptions: (cmd: Command) => Command
): void {
  // Create the import command
  const importCommand = docstoreCommand
    .command("import")
    .description("Import documents from various sources");
  
  // Add common options
  // addCommonOptions(importCommand);
  
  // Register import subcommands
  registerNostrImportCommand(importCommand, addCommonOptions);
  registerMarkdownImportCommand(importCommand, addCommonOptions);
  registerTwitterImportCommand(importCommand, addCommonOptions);
  registerDirImportCommand(importCommand, addCommonOptions);
}