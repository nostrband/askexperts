import { Command } from "commander";
import { SimplePool } from "nostr-tools";
import * as readline from "readline";
import { generateRandomKeyPair } from "../../common/crypto.js";
import { StreamMetadata, StreamWriterConfig } from "../../stream/types.js";
import { StreamWriter } from "../../stream/StreamWriter.js";
import { StreamReader } from "../../stream/StreamReader.js";
import { debugError, enableAllDebug } from "../../common/debug.js";
import { COMPRESSION_NONE } from "../../stream/compression.js";
import { ENCRYPTION_NONE, ENCRYPTION_NIP44 } from "../../stream/encryption.js";

/**
 * Options for the stream send command
 */
interface StreamSendOptions {
  relays?: string[];
  encryption?: string;
  compression?: string;
  binary?: boolean;
  debug?: boolean;
  chunkSize?: string;
  chunkInterval?: string;
}

/**
 * Options for the stream receive command
 */
interface StreamReceiveOptions {
  metadata?: string;
  debug?: boolean;
  ttl?: string;
  maxChunks?: string;
  maxSize?: string;
}

/**
 * Helper function to parse comma-separated lists
 * @param value The comma-separated string
 * @returns Array of trimmed strings
 */
function commaSeparatedList(value: string): string[] {
  return value.split(",").map((item) => item.trim());
}

/**
 * Execute the stream send command
 * 
 * @param options Command line options
 */
async function executeStreamSendCommand(options: StreamSendOptions): Promise<void> {
  try {
    // Create a private key for the stream
    const { privateKey: senderPrivkey, publicKey: senderPubkey } = generateRandomKeyPair();
    
    // Create a SimplePool for relay communication
    const pool = new SimplePool();
    
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
      metadata.receiver_privkey = Buffer.from(senderPrivkey).toString('hex');
    }
    
    // Parse chunk size and interval options
    const maxChunkSize = options.chunkSize ? parseInt(options.chunkSize, 10) : undefined;
    const minChunkInterval = options.chunkInterval ? parseInt(options.chunkInterval, 10) : undefined;
    
    // Create writer config
    const writerConfig: StreamWriterConfig = {
      maxChunkSize,
      minChunkInterval,
    };
    
    // Print stream metadata
    console.log("Stream Metadata:");
    console.log(JSON.stringify(metadata, null, 2));
    
    // Wait for user to press enter
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
    });
    
    await new Promise<void>((resolve) => {
      rl.question("Press enter to start streaming...", () => {
        rl.close();
        resolve();
      });
    });
    
    console.log("Streaming started. Press Ctrl+D to end input.");
    
    // Create stream writer
    const writer = new StreamWriter(
      metadata,
      pool,
      senderPrivkey,
      writerConfig
    );
    
    // Set up stdin to read data
    process.stdin.setEncoding('utf8');
    
    // Read data from stdin and write to stream
    process.stdin.on('data', async (chunk) => {
      try {
        await writer.write(chunk.toString());
      } catch (err) {
        debugError("Error writing to stream:", err);
        console.error(`Error: ${err instanceof Error ? err.message : String(err)}`);
      }
    });
    
    // Handle end of input
    process.stdin.on('end', async () => {
      try {
        // Write final chunk with done flag
        await writer.write("", true);
        console.log("Stream completed successfully.");
        
        // Clean up resources
        writer[Symbol.dispose]();
        pool.destroy();
        
        process.exit(0);
      } catch (err) {
        debugError("Error completing stream:", err);
        console.error(`Error: ${err instanceof Error ? err.message : String(err)}`);
        process.exit(1);
      }
    });
    
    // Handle errors
    process.stdin.on('error', async (err) => {
      debugError("Error reading from stdin:", err);
      console.error(`Error: ${err instanceof Error ? err.message : String(err)}`);
      
      try {
        // Send error status
        await writer.error("stdin_error", err.message || "Error reading from stdin");
      } catch (writeErr) {
        debugError("Error sending error status:", writeErr);
      }
      
      // Clean up resources
      writer[Symbol.dispose]();
      pool.destroy();
      
      process.exit(1);
    });
  } catch (err) {
    debugError("Failed to execute stream send command:", err);
    console.error(`Error: ${err instanceof Error ? err.message : String(err)}`);
    process.exit(1);
  }
}

/**
 * Execute the stream receive command
 * 
 * @param options Command line options
 */
async function executeStreamReceiveCommand(options: StreamReceiveOptions): Promise<void> {
  try {
    let metadataJson: string;
    
    // Get metadata from options or stdin
    if (options.metadata) {
      metadataJson = options.metadata;
    } else {
      // Read metadata from stdin
      metadataJson = await new Promise<string>((resolve, reject) => {
        let data = '';
        
        process.stdin.on('data', (chunk) => {
          data += chunk;
        });
        
        process.stdin.on('end', () => {
          resolve(data);
        });
        
        process.stdin.on('error', (err) => {
          reject(err);
        });
      });
    }
    
    // Parse metadata
    let metadata: StreamMetadata;
    try {
      metadata = JSON.parse(metadataJson);
    } catch (err) {
      throw new Error(`Invalid metadata JSON: ${err instanceof Error ? err.message : String(err)}`);
    }
    
    // Validate required fields
    if (!metadata.streamId) {
      throw new Error("Missing streamId in metadata");
    }
    
    if (!metadata.relays || metadata.relays.length === 0) {
      throw new Error("Missing relays in metadata");
    }
    
    // Create a SimplePool for relay communication
    const pool = new SimplePool();
    
    // Parse reader options
    const ttl = options.ttl ? parseInt(options.ttl, 10) : undefined;
    const maxChunks = options.maxChunks ? parseInt(options.maxChunks, 10) : undefined;
    const maxResultSize = options.maxSize ? parseInt(options.maxSize, 10) : undefined;
    
    // Create reader config
    const readerConfig = {
      ttl,
      maxChunks,
      maxResultSize,
    };
    
    // Create stream reader
    const reader = new StreamReader(metadata, pool, readerConfig);
    
    console.error(`[${new Date().toISOString()}] Stream receive started`);
    const startTime = Date.now();
    
    let totalBytes = 0;
    let chunkCount = 0;
    
    // Read data from stream and write to stdout
    try {
      for await (const chunk of reader) {
        chunkCount++;
        totalBytes += chunk.length;
        
        // Log chunk info to stderr
        console.error(`[${new Date().toISOString()}] Received chunk ${chunkCount}, size: ${chunk.length} bytes`);
        
        // Write chunk to stdout
        process.stdout.write(chunk);
      }
      
      const endTime = Date.now();
      const duration = endTime - startTime;
      
      console.error(`[${new Date().toISOString()}] Stream completed`);
      console.error(`Total chunks: ${chunkCount}`);
      console.error(`Total bytes: ${totalBytes}`);
      console.error(`Total time: ${duration}ms`);
      
      // Clean up resources
      pool.destroy();
      
      process.exit(0);
    } catch (err) {
      const endTime = Date.now();
      const duration = endTime - startTime;
      
      console.error(`[${new Date().toISOString()}] Stream error: ${err instanceof Error ? err.message : String(err)}`);
      console.error(`Partial chunks: ${chunkCount}`);
      console.error(`Partial bytes: ${totalBytes}`);
      console.error(`Time until error: ${duration}ms`);
      
      // Clean up resources
      pool.destroy();
      
      process.exit(1);
    }
  } catch (err) {
    debugError("Failed to execute stream receive command:", err);
    console.error(`Error: ${err instanceof Error ? err.message : String(err)}`);
    process.exit(1);
  }
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
  
  // Register send subcommand
  streamCommand
    .command("send")
    .description("Send data from stdin as a stream")
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
    .option(
      "--chunk-size <bytes>",
      "Maximum chunk size in bytes",
      "65536"
    )
    .option(
      "--chunk-interval <ms>",
      "Minimum interval between chunks in milliseconds",
      "0"
    )
    .option(
      "-d, --debug",
      "Enable debug logging",
      false
    )
    .action((options) => {
      if (options.debug) enableAllDebug();
      executeStreamSendCommand(options);
    });
  
  // Register receive subcommand
  streamCommand
    .command("receive")
    .description("Receive stream data and output to stdout")
    .option(
      "-m, --metadata <json>",
      "Stream metadata JSON (if not provided, read from stdin)"
    )
    .option(
      "--ttl <ms>",
      "Time-to-live in milliseconds for waiting for the next chunk",
      "60000"
    )
    .option(
      "--max-chunks <number>",
      "Maximum number of chunks to process",
      "1000"
    )
    .option(
      "--max-size <bytes>",
      "Maximum total size of all chunks in bytes",
      "10485760"
    )
    .option(
      "-d, --debug",
      "Enable debug logging",
      false
    )
    .action((options) => {
      if (options.debug) enableAllDebug();
      executeStreamReceiveCommand(options);
    });
}