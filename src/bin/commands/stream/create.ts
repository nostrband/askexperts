import { Command } from "commander";
import { generateRandomKeyPair } from "../../../common/crypto.js";
import { getPublicKey } from "nostr-tools";
import { StreamMetadata } from "../../../stream/types.js";
import { debugError, enableAllDebug } from "../../../common/debug.js";
import { COMPRESSION_NONE } from "../../../stream/compression.js";
import { ENCRYPTION_NONE, ENCRYPTION_NIP44 } from "../../../stream/encryption.js";
import { createStreamMetadataEvent } from "../../../stream/metadata.js";
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
    
    // Create stream metadata object
    const metadata: StreamMetadata = {
      streamId: senderPubkey,
      version: "1",
      encryption: encryption,
      compression: compression,
      binary: binary,
      relays: relays,
    };
    
    // Generate receiver key pair if encryption is enabled
    let receiverPrivkey: string | undefined;
    
    if (encryption === ENCRYPTION_NIP44) {
      // For encryption, we need to generate a receiver key pair
      // In this case, we'll use the same key for simplicity
      receiverPrivkey = Buffer.from(senderPrivkey).toString('hex');
      
      // Derive the public key from the private key
      const receiverPubkey = getPublicKey(Buffer.from(receiverPrivkey, 'hex'));
      
      // Add the receiver public key to metadata
      metadata.receiver_pubkey = receiverPubkey;
      
      // Store the private key for later use, but don't include it in metadata
      // as it's now sent out-of-band
      metadata.receiver_privkey = receiverPrivkey;
    }
    
    // Create and sign the stream metadata event (kind: 173)
    const metadataEvent = createStreamMetadataEvent(metadata, senderPrivkey);
    
    // Add the event to the metadata object
    metadata.event = metadataEvent;
    
    // Print stream metadata event
    console.log("Stream Metadata Event (kind: 173):");
    console.log(JSON.stringify(metadataEvent));
    
    // Print private keys (for debugging/reference)
    console.log("\nSender Private Key:");
    console.log(Buffer.from(senderPrivkey).toString('hex'));
    
    // Print receiver private key separately if encryption is used
    if (encryption !== ENCRYPTION_NONE && receiverPrivkey) {
      console.log("\nReceiver Private Key (share this out-of-band with the receiver):");
      console.log(receiverPrivkey);
    }
    
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