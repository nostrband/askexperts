import { Command } from "commander";
import { registerSignupCommand } from "./signup.js";
import { registerBalanceCommand } from "./balance.js";
import { registerInvoiceCommand } from "./invoice.js";
import { registerPayCommand } from "./pay.js";

/**
 * Register all remote commands with the CLI
 *
 * @param program The commander program
 */
export function registerRemoteCommands(program: Command): void {
  const remoteCommand = program
    .command("remote")
    .description("Interact with askexperts.io remote services");

  registerSignupCommand(remoteCommand);
  registerBalanceCommand(remoteCommand);
  registerInvoiceCommand(remoteCommand);
  registerPayCommand(remoteCommand);
}