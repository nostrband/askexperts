import { Command } from "commander";
import { registerOpenRouterCommand } from "./openrouter.js";
import { registerCreateCommand } from "./create.js";
import { registerUpdateCommand } from "./update.js";
import { registerDeleteCommand } from "./delete.js";
import { registerRunCommand } from "./run.js";
import { registerAllCommand } from "./all.js";
import { registerLsCommand } from "./ls.js";
import { registerSearchCommand } from "./search.js";
import { registerServerCommand } from "./server.js";
import { ExpertClient } from "../../../experts/ExpertClient.js";
import { getExpertClient } from "../../../experts/ExpertRemoteClient.js";
import { RemoteClient } from "../../../remote/index.js";
import { debugClient, debugExpert } from "../../../common/debug.js";

/**
 * Common options for expert commands
 */
export interface ExpertCommandOptions {
  remote?: boolean;
  url?: string;
  [key: string]: any; // Allow additional properties for specific commands
}

/**
 * Create an ExpertClient instance based on command options
 *
 * @param options Command options
 * @returns ExpertClient instance
 */
export function createExpertClient(options: ExpertCommandOptions): ExpertClient {
  // Use remote client if remote flag is set
  if (options.remote) {
    // Use the provided URL or default to https://expertapi.askexperts.io
    const serverUrl = options.url || "https://expertapi.askexperts.io";
    debugExpert(`Connecting to remote server at ${serverUrl}`);
    
    // Create a RemoteClient to get the private key
    const remoteClient = new RemoteClient();
    const privateKey = remoteClient.getPrivateKey();
    
    // Create a remote ExpertClient with the server URL and private key
    return getExpertClient(serverUrl, privateKey);
  } else {
    // Use local client
    return getExpertClient();
  }
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
  registerServerCommand(expertCommand);
}