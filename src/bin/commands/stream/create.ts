import { Command } from "commander";
import { generateRandomKeyPair } from "../../../common/crypto.js";
import { StreamMetadata } from "../../../stream/types.js";
import { debugError, enableAllDebug } from "../../../common/debug.js";
import { COMPRESSION_NONE } from "../../../stream/compression.js";
import { ENCRYPTION_NONE, ENCRYPTION_NIP44 } from "../../../stream/encryption.js";
import { StreamCommandOptions, commaSeparatedList } from "./index.js";

/**
 * Execute the stream create command
 * 
 * @param options Command line options
 */
export async function executeStreamCreateCommand(options: StreamCommandOptions): Promise<void> {
  try {
    // Create a private key for the stream
    const { privateKey: senderPrivkey, publicKey: senderPubkey } = generateRandomKeyPair();
    
    // Parse relays from options or environment variables
    let relays: string[] = options.relays || [];
    if (relays.length === 0 && process.env.DISCOVERY_RELAYS) {
      relays = process.env.DISCOVERY_RELAYS.split(",").map((relay) => relay.trim());
    }
    
    if (relays.length === 0) {
      throw new Error("No relays specified. Use --relays or set DISCOVERY_RELAYS environment variable.");
    }
    
    // Parse encryption option
    const encryption = options.encryption || ENCRYPTION_NONE;
    
    // Parse compression option
    const compression = options.compression || COMPRESSION_NONE;
    
    // Parse binary option
    const binary = options.binary || false;
    
    // Create stream metadata
    const metadata: StreamMetadata = {
      streamId: senderPubkey,
      encryption: encryption,
      compression: compression,
      binary: binary,
      relays: relays,
    };
    
    // If encryption is enabled, generate a key
    if (encryption === ENCRYPTION_NIP44) {
      metadata.key = Buffer.from(senderPrivkey).toString('hex');
    }
    
    // Print stream metadata
    console.log("Stream Metadata:");
    console.log(JSON.stringify(metadata));
    
    // Print private key (for debugging/reference)
    console.log("\nPrivate Key (for sender):");
    console.log(Buffer.from(senderPrivkey).toString('hex'));
    
  } catch (err) {
    debugError("Failed to execute stream create command:", err);
    console.error(`Error: ${err instanceof Error ? err.message : String(err)}`);
    process.exit(1);
  }
}

/**
 * Register the create command
 * 
 * @param streamCommand The parent stream command
 * @param addCommonOptions Function to add common options to command
 */
export function registerCreateCommand(
  streamCommand: Command,
  addCommonOptions: (cmd: Command) => Command
): void {
  const createCommand = streamCommand
    .command("create")
    .description("Create a new stream and output its metadata")
    .option(
      "-r, --relays <items>",
      "Comma-separated list of relays",
      commaSeparatedList
    )
    .option(
      "-e, --encryption <type>",
      "Encryption type (none, nip44)",
      ENCRYPTION_NONE
    )
    .option(
      "-c, --compression <type>",
      "Compression type (none, gzip)",
      COMPRESSION_NONE
    )
    .option(
      "-b, --binary",
      "Treat data as binary",
      false
    )
    .action((options) => {
      if (options.debug) enableAllDebug();
      executeStreamCreateCommand(options);
    });
  
  addCommonOptions(createCommand);
}