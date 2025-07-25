import { Command } from "commander";
import { registerOpenRouterCommand } from "./openrouter.js";
import { registerNostrCommand } from "./nostr.js";
import { registerCreateCommand } from "./create.js";
import { registerUpdateCommand } from "./update.js";
import { registerDeleteCommand } from "./delete.js";
import { registerRunCommand } from "./run.js";
import { registerAllCommand } from "./all.js";
import { getDB } from "../../../db/utils.js";

/**
 * Register the expert command group with the CLI
 *
 * @param program The commander program
 */
export function registerExpertCommand(program: Command): void {
  // Create the expert command group
  const expertCommand = program
    .command("expert")
    .description("Commands for managing various experts");

  // Register subcommands
  registerOpenRouterCommand(expertCommand);
  registerNostrCommand(expertCommand);
  registerCreateCommand(expertCommand);
  registerUpdateCommand(expertCommand);
  registerDeleteCommand(expertCommand);
  registerRunCommand(expertCommand);
  registerAllCommand(expertCommand);
}