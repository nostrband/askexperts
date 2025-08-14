import { Command } from "commander";
import { registerAddCommand } from "./add.js";
import { registerCreateCommand } from "./create.js";
import { registerUpdateCommand } from "./update.js";
import { registerDeleteCommand } from "./delete.js";
import { registerListCommand } from "./list.js";
import { registerBalanceCommand } from "./balance.js";
import { registerPayCommand } from "./pay.js";
import { registerInvoiceCommand } from "./invoice.js";
import { registerHistoryCommand } from "./history.js";

/**
 * Add debug option to a command
 * @param cmd The commander command
 * @returns The command with debug option added
 */
const addDebugOption = (cmd: Command): Command =>
  cmd.option("-d, --debug", "Enable debug output");

/**
 * Add remote options to a command
 * @param cmd The commander command
 * @returns The command with remote options added
 */
const addRemoteOptions = (cmd: Command): Command =>
  cmd
    .option("-r, --remote", "Use remote wallet client")
    .option("-u, --url <url>", "URL of remote server (default: https://api.askexperts.io)");

/**
 * Add common options to a command
 * @param cmd The commander command
 * @returns The command with common options added
 */
export const addCommonOptions = (cmd: Command): Command => {
  // Server command already has debug option, so we don't need to add it
  if (cmd.name() !== "server") {
    addDebugOption(cmd);
    addRemoteOptions(cmd);
  }
  return cmd;
};

/**
 * Register all wallet commands with the CLI
 *
 * @param program The commander program
 */
export function registerWalletCommands(program: Command): void {
  const walletCommand = program
    .command("wallet")
    .description("Manage lightning wallets");

  registerAddCommand(walletCommand);
  registerCreateCommand(walletCommand);
  registerUpdateCommand(walletCommand);
  registerDeleteCommand(walletCommand);
  registerListCommand(walletCommand);
  registerBalanceCommand(walletCommand);
  registerPayCommand(walletCommand);
  registerInvoiceCommand(walletCommand);
  registerHistoryCommand(walletCommand);
}