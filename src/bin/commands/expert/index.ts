import { Command } from "commander";
import { registerOpenRouterCommand } from "./openrouter.js";
import { registerCreateCommand } from "./create.js";
import { registerUpdateCommand } from "./update.js";
import { registerDeleteCommand } from "./delete.js";
import { registerRunCommand } from "./run.js";
import { registerAllCommand } from "./all.js";
import { registerLsCommand } from "./ls.js";
import { registerSearchCommand } from "./search.js";

/**
 * Common options for expert commands
 */
export interface ExpertCommandOptions {
  remote?: boolean;
  url?: string;
  [key: string]: any; // Allow additional properties for specific commands
}

/**
 * Add remote options to a command
 *
 * @param cmd The command to add options to
 * @returns The command with options added
 */
export function addRemoteOptions(cmd: Command): Command {
  return cmd
    .option("-r, --remote", "Use remote client")
    .option("-u, --url <url>", "URL of remote server (default: https://expertapi.askexperts.io)");
}

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
  registerCreateCommand(expertCommand);
  registerUpdateCommand(expertCommand);
  registerDeleteCommand(expertCommand);
  registerRunCommand(expertCommand);
  registerAllCommand(expertCommand);
  registerLsCommand(expertCommand);
  registerSearchCommand(expertCommand);
}