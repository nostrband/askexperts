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
import { registerServerCommand } from "./server.js";

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
  registerServerCommand(walletCommand);
}