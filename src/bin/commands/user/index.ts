import { Command } from "commander";
import { registerAddCommand } from "./add.js";
import { registerListCommand } from "./list.js";
import { registerWhoamiCommand } from "./whoami.js";
import { registerSwitchCommand } from "./switch.js";

/**
 * Add debug option to a command
 * @param cmd The commander command
 * @returns The command with debug option added
 */
const addDebugOption = (cmd: Command): Command =>
  cmd.option("-d, --debug", "Enable debug output");

/**
 * Add common options to a command
 * @param cmd The commander command
 * @returns The command with common options added
 */
export const addCommonOptions = (cmd: Command): Command => {
  addDebugOption(cmd);
  return cmd;
};

/**
 * Register all user commands with the CLI
 *
 * @param program The commander program
 */
export function registerUserCommands(program: Command): void {
  const userCommand = program
    .command("user")
    .description("Manage users");

  registerAddCommand(userCommand);
  registerListCommand(userCommand);
  registerWhoamiCommand(userCommand);
  registerSwitchCommand(userCommand);
}