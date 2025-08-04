import { Command } from "commander";
import { SimplePool, getPublicKey } from "nostr-tools";
import { StreamMetadata, StreamWriterConfig } from "../../../stream/types.js";
import { StreamWriter } from "../../../stream/StreamWriter.js";
import { debugError, debugStream, enableAllDebug } from "../../../common/debug.js";
import { StreamCommandOptions, commaSeparatedList } from "./index.js";

/**
 * A simple async queue that processes tasks sequentially
 */
class AsyncQueue {
  private queue: Array<() => Promise<void>> = [];
  private processing = false;

  /**
   * Add a task to the queue and start processing if not already processing
   *
   * @param task Function that returns a promise
   */
  async add(task: () => Promise<void>): Promise<void> {
    // Add the task to the queue
    this.queue.push(task);
    
    // Start processing if not already processing
    if (!this.processing) {
      await this.process();
    }
  }

  /**
   * Process tasks in the queue sequentially
   */
  private async process(): Promise<void> {
    if (this.processing) return;
    
    this.processing = true;
    
    try {
      // Process tasks until the queue is empty
      while (this.queue.length > 0) {
        const task = this.queue.shift();
        if (task) {
          try {
            await task();
          } catch (err) {
            debugError("Error processing task in queue:", err);
            // Continue processing other tasks even if one fails
          }
        }
      }
    } finally {
      this.processing = false;
    }
  }
}

/**
 * Execute the stream send command
 * 
 * @param options Command line options
 */
export async function executeStreamSendCommand(options: StreamCommandOptions): Promise<void> {
  try {
    // Require metadata option
    if (!options.metadata) {
      throw new Error("Missing --metadata option. Stream metadata is required.");
    }
    
    // Parse metadata
    let metadata: StreamMetadata;
    try {
      metadata = JSON.parse(options.metadata);
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
    
    // Get sender private key from options
    if (!options.privateKey) {
      throw new Error("Missing --private-key option. The sender's private key is required.");
    }
    
    // Parse the private key
    const senderPrivkey = Buffer.from(options.privateKey, 'hex');
    
    // Verify that the private key corresponds to the stream ID
    const derivedPublicKey = getPublicKey(Buffer.from(options.privateKey, 'hex'));
    if (derivedPublicKey !== metadata.streamId) {
      throw new Error("The provided private key does not match the stream ID in the metadata.");
    }
    
    // Create a SimplePool for relay communication
    const pool = new SimplePool();
    
    // Parse chunk size and interval options
    const maxChunkSize = options.chunkSize ? parseInt(options.chunkSize, 10) : undefined;
    const minChunkInterval = options.chunkInterval ? parseInt(options.chunkInterval, 10) : undefined;
    
    // Create writer config
    const writerConfig: StreamWriterConfig = {
      maxChunkSize,
      minChunkInterval,
    };
    
    // Validate encryption requirements
    if (metadata.encryption === "nip44" && !metadata.key) {
      throw new Error("Missing key in metadata for NIP-44 encryption");
    }
    
    debugStream("Stream metadata received. Starting to stream from stdin...");
    
    // Create stream writer
    const writer = new StreamWriter(
      metadata,
      pool,
      senderPrivkey,
      writerConfig
    );
    
    // Set up stdin to read data
    if (!metadata.binary)
      process.stdin.setEncoding('utf8');
    
    // Create an async queue to process stdin events sequentially
    const taskQueue = new AsyncQueue();
    
    // Read data from stdin and write to stream
    let index = 0;
    process.stdin.on('data', (chunk) => {
      const i = index;
      index++;
      
      // Add the task to the queue
      taskQueue.add(async () => {
        // Drop the chunk if we're already failing
        if (writer.status === 'error') return;

        debugStream(`Read chunk ${i} of ${chunk.length} bytes`);
        try {
          await writer.write(metadata.binary ? chunk : chunk.toString("utf8"));
          debugStream(`Sent chunk ${i}`);
        } catch (err) {
          debugError("Error writing to stream:", err);
          console.error(`Error: ${err instanceof Error ? err.message : String(err)}`);
        }
      });
    });
    
    // Handle end of input
    process.stdin.on('end', () => {
      // Add the end task to the queue
      taskQueue.add(async () => {
        // Drop the chunk if we're already failing
        if (writer.status === 'error') return;

        debugStream(`Read end`);
        try {
          // Write final chunk with done flag
          await writer.write("", true);
          debugStream("Stream completed successfully.");
          
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
    });
    
    // Handle errors
    process.stdin.on('error', (err) => {
      // Add the error task to the queue
      taskQueue.add(async () => {
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
    });
  } catch (err) {
    debugError("Failed to execute stream send command:", err);
    console.error(`Error: ${err instanceof Error ? err.message : String(err)}`);
    process.exit(1);
  }
}

/**
 * Register the send command
 * 
 * @param streamCommand The parent stream command
 * @param addCommonOptions Function to add common options to command
 */
export function registerSendCommand(
  streamCommand: Command,
  addCommonOptions: (cmd: Command) => Command
): void {
  const sendCommand = streamCommand
    .command("send")
    .description("Send data from stdin using an existing stream")
    .requiredOption(
      "-m, --metadata <json>",
      "Stream metadata JSON"
    )
    .requiredOption(
      "-k, --private-key <hex>",
      "Sender's private key in hex format"
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
    .action((options) => {
      if (options.debug) enableAllDebug();
      executeStreamSendCommand(options);
    });
  
  addCommonOptions(sendCommand);
}