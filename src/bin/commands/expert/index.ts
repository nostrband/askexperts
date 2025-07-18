import { Command } from "commander";
import { registerOpenRouterCommand } from "./openrouter.js";

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
}