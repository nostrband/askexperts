import { Command } from "commander";
import { SimplePool, Event } from "nostr-tools";
import { StreamMetadata } from "../../../stream/types.js";
import { StreamReader } from "../../../stream/StreamReader.js";
import {
  debugStream,
  debugError,
  enableAllDebug,
} from "../../../common/debug.js";
import { StreamCommandOptions } from "./index.js";
import { parseStreamMetadataEvent } from "../../../stream/metadata.js";

/**
 * Execute the stream receive command
 *
 * @param options Command line options
 */
export async function executeStreamReceiveCommand(
  options: StreamCommandOptions
): Promise<void> {
  try {
    let metadataJson: string;

    // Get metadata from options or stdin
    if (options.metadata) {
      metadataJson = options.metadata;
    } else {
      // Read metadata from stdin
      metadataJson = await new Promise<string>((resolve, reject) => {
        let data = "";

        process.stdin.on("data", (chunk) => {
          data += chunk;
        });

        process.stdin.on("end", () => {
          resolve(data);
        });

        process.stdin.on("error", (err) => {
          reject(err);
        });
      });
    }

    // Parse metadata event
    let metadataEvent: Event;
    try {
      metadataEvent = JSON.parse(metadataJson);
    } catch (err) {
      throw new Error(
        `Invalid metadata event JSON: ${
          err instanceof Error ? err.message : String(err)
        }`
      );
    }

    // Parse and validate the metadata event
    const metadata = parseStreamMetadataEvent(metadataEvent);

    // Create a SimplePool for relay communication
    const pool = new SimplePool();

    // Parse reader options
    const ttl = options.ttl ? parseInt(options.ttl, 10) : undefined;
    const maxChunks = options.maxChunks
      ? parseInt(options.maxChunks, 10)
      : undefined;
    const maxResultSize = options.maxSize
      ? parseInt(options.maxSize, 10)
      : undefined;

    // Create reader config
    const readerConfig = {
      ttl,
      maxChunks,
      maxResultSize,
    };

    // Create stream reader
    const reader = new StreamReader(metadata, pool, readerConfig);

    console.error(`[${new Date().toISOString()}] Stream receive started`);
    let startTime: number = 0;

    let totalBytes = 0;
    let chunkCount = 0;

    // Read data from stream and write to stdout
    try {
      for await (const chunk of reader) {
        if (!startTime) startTime = Date.now();
        totalBytes += chunk.length;

        // Log chunk info to stderr
        console.error(
          `[${new Date().toISOString()}] Received chunk ${chunkCount}, size: ${
            chunk.length
          } bytes`
        );
        chunkCount++;

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

      console.error(
        `[${new Date().toISOString()}] Stream error: ${
          err instanceof Error ? err.message : String(err)
        }`
      );
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
 * Register the receive command
 *
 * @param streamCommand The parent stream command
 * @param addCommonOptions Function to add common options to command
 */
export function registerReceiveCommand(
  streamCommand: Command,
  addCommonOptions: (cmd: Command) => Command
): void {
  const receiveCommand = streamCommand
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
    .action((options) => {
      if (options.debug) enableAllDebug();
      executeStreamReceiveCommand(options);
    });

  addCommonOptions(receiveCommand);
}
