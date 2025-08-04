import { Command } from "commander";
import { registerSendCommand } from "./send.js";
import { registerReceiveCommand } from "./receive.js";
import { registerCreateCommand } from "./create.js";

/**
 * Options for stream commands
 */
export interface StreamCommandOptions {
  relays?: string[];
  encryption?: string;
  compression?: string;
  binary?: boolean;
  debug?: boolean;
  chunkSize?: string;
  chunkInterval?: string;
  metadata?: string;
  ttl?: string;
  maxChunks?: string;
  maxSize?: string;
  privateKey?: string;
}

/**
 * Helper function to parse comma-separated lists
 * @param value The comma-separated string
 * @returns Array of trimmed strings
 */
export function commaSeparatedList(value: string): string[] {
  return value.split(",").map((item) => item.trim());
}

/**
 * Register the stream command with the CLI
 * 
 * @param program The commander program
 */
export function registerStreamCommand(program: Command): void {
  const streamCommand = program
    .command("stream")
    .description("Stream data over Nostr");

  // Add debug option to all subcommands
  const addDebugOption = (cmd: Command) =>
    cmd.option("-d, --debug", "Enable debug logging");

  // Helper to add all common options
  const addCommonOptions = (cmd: Command) => {
    addDebugOption(cmd);
    return cmd;
  };

  // Register all subcommands
  registerCreateCommand(streamCommand, addCommonOptions);
  registerSendCommand(streamCommand, addCommonOptions);
  registerReceiveCommand(streamCommand, addCommonOptions);
}