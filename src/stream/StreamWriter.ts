/**
 * StreamWriter implementation for NIP-173 (Streaming Over Nostr)
 */

import { SimplePool, getPublicKey } from "nostr-tools";
import {
  Compression,
  CompressionInstance,
  getCompression,
} from "./compression.js";
import { publishToRelays } from "../common/relay.js";
import { encrypt, createEvent } from "../common/crypto.js";
import { StreamMetadata, StreamWriterConfig, StreamStatus } from "./types.js";
import { CompressionMethod } from "../common/types.js";
import { debugStream, debugError } from "../common/debug.js";

/**
 * Default configuration values for StreamWriter
 */
const DEFAULT_CONFIG: Required<StreamWriterConfig> = {
  minChunkInterval: 0,
  minChunkSize: 0,
  maxChunkSize: 64 * 1024, // 64KB (NIP-44 encryption limit)
};

/**
 * StreamWriter for NIP-173 streams
 * Handles writing data to a Nostr stream, with support for batching, compression, and encryption
 */
export class StreamWriter {
  private metadata: StreamMetadata;
  private pool: SimplePool;
  private config: Required<StreamWriterConfig>;
  private compression: Compression;
  private compressor: CompressionInstance | null = null;
  private senderPrivkey: Uint8Array;
  private chunkIndex = 0;
  private batchTimer: NodeJS.Timeout | null = null;
  private isDone = false;
  private isError = false;
  private currentChunkSize: number = 0;

  /**
   * Creates a new StreamWriter
   *
   * @param metadata - Stream metadata
   * @param pool - SimplePool instance for relay communication
   * @param config - Configuration options
   * @param compression - Optional custom compression implementation
   */
  constructor(
    metadata: StreamMetadata,
    pool: SimplePool,
    senderPrivkey: Uint8Array,
    config: StreamWriterConfig = {},
    compression?: Compression
  ) {
    this.metadata = metadata;
    this.pool = pool;
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.compression = compression || getCompression();
    this.senderPrivkey = senderPrivkey;

    // Validate metadata
    if (!metadata.streamId) {
      throw new Error("Stream ID is required");
    }

    if (!metadata.relays || metadata.relays.length === 0) {
      throw new Error("At least one relay is required");
    }

    // Validate encryption requirements
    if (metadata.encryption === "nip44" && !metadata.key) {
      throw new Error(
        "Recipient private key (key) is required for NIP-44 encryption"
      );
    }
  }

  /**
   * Compresses data and updates the current chunk size
   *
   * @param data - Data to compress
   * @throws CompressionSizeLimitExceeded if the data would exceed the max chunk size
   */
  private async compress(data: Uint8Array) {
    // Initialize compressor if needed
    if (!this.compressor) {
      this.compressor = await this.compression.startCompress(
        this.metadata.compression as CompressionMethod,
        this.config.maxChunkSize
      );
      this.currentChunkSize = 0;
    }

    // Add data to compressor
    this.currentChunkSize = await this.compressor.add(data);
  }

  /**
   * Writes data to the stream
   *
   * @param data - Data to write (string or Uint8Array)
   * @param done - Whether this is the last chunk
   */
  async write(data: string | Uint8Array, done = false) {
    if (this.isError) {
      throw new Error("Stream failed");
    }

    if (this.isDone) {
      throw new Error("Stream is already closed");
    }

    // Convert string to Uint8Array if needed
    const dataBytes =
      typeof data === "string" ? new TextEncoder().encode(data) : data;

    // Clear any existing batch timer to avoid races
    if (this.batchTimer) {
      clearTimeout(this.batchTimer);
      this.batchTimer = null;
    }

    // Split data into manageable chunks to ensure each part fits into compressor
    const maxPartSize = Math.floor(this.config.maxChunkSize / 2); // Use half the max size to be safe
    const parts: Uint8Array[] = [];
    let offset = 0;
    while (offset < dataBytes.length) {
      const end = Math.min(offset + maxPartSize, dataBytes.length);
      parts.push(dataBytes.slice(offset, end));
      offset = end;
    }

    // Process each part
    for (const part of parts) {
      try {
        // Try to compress this part
        await this.compress(part);
      } catch (err) {
        // If compression fails due to size limit
        if (
          this.currentChunkSize > 0 &&
          err instanceof Error &&
          err.name === "CompressionSizeLimitExceeded"
        ) {
          // Flush it first
          await this.flushCompressor();

          // Try again with the current part,
          // if it throws then there's something wrong
          // with our logic
          await this.compress(part);
        } else {
          // For other errors, just rethrow
          throw err;
        }
      }
    }

    // Set done flag if requested
    this.isDone = done;

    // Flush if done or we've reached the minimum chunk size
    if (
      this.isDone ||
      (this.config.minChunkSize > 0 &&
        this.currentChunkSize >= this.config.minChunkSize)
    ) {
      // Send immediately
      await this.flushCompressor();

      // Clear up
      if (this.isDone) this[Symbol.dispose]();
    }

    // Set up timer for interval-based sending if not already done
    if (!this.isDone && this.config.minChunkInterval > 0 && !this.batchTimer) {
      this.batchTimer = setTimeout(async () => {
        try {
          await this.flushCompressor();
        } catch (err) {
          debugError("Error flushing compressor:", err);
          this.isError = true;
        }
      }, this.config.minChunkInterval);
    }
  }

  /**
   * Sends an error status and closes the stream
   *
   * @param code - Error code
   * @param message - Error message
   */
  async error(code: string, message: string) {
    if (this.isDone) {
      throw new Error("Stream is already done");
    }

    this.isError = true;

    // Send any pending data first
    if (this.currentChunkSize > 0) {
      try {
        await this.flushCompressor();
      } catch (err) {
        debugError("Error flushing compressor before error:", err);
      }
    }

    // Send error chunk
    const errorContent = JSON.stringify({ code, message });
    await this.sendErrorChunk(errorContent);

    // Clear itself
    this[Symbol.dispose]();
  }

  /**
   * Flushes the current compressor and sends the compressed data as a chunk
   *
   * @returns Promise resolving to the event ID of the sent chunk
   */
  private async flushCompressor() {
    if (!this.compressor) throw new Error("No compressor");

    // We're sending, clear the interval-based sender timer
    if (this.batchTimer) {
      clearTimeout(this.batchTimer);
      this.batchTimer = null;
    }

    // Get the compressed content
    const content = await this.compressor.finish();

    // Dispose of the current compressor
    this.compressor[Symbol.dispose]();
    this.currentChunkSize = 0;
    this.compressor = null;

    // Send the compressed data with appropriate status
    const status = this.isDone ? "done" : "active";
    return this.sendCompressedChunk(content, status);
  }

  /**
   * Sends a compressed chunk of data as a kind:20173 event
   *
   * @param compressedContent - Compressed content to send
   * @param status - Chunk status
   * @returns Promise resolving to the event ID
   */
  private async sendCompressedChunk(
    compressedContent: string,
    status: StreamStatus
  ): Promise<string> {
    let content = compressedContent;

    try {
      // Apply NIP-44 encryption if configured
      if (this.metadata.encryption === "nip44") {
        if (!this.metadata.key) {
          throw new Error(
            "Missing recipient private key for NIP-44 encryption"
          );
        }

        // Derive recipient's public key from the private key in metadata
        const recipientPubkey = getPublicKey(
          Buffer.from(this.metadata.key!, "hex")
        );

        // Encrypt the content using NIP-44
        content = encrypt(content, recipientPubkey, this.senderPrivkey);
      }
    } catch (err) {
      debugError("Error encrypting chunk data:", err);
      throw err;
    }

    return this.createAndPublishEvent(content, status);
  }

  /**
   * Sends an error chunk
   *
   * @param errorContent - Error content as JSON string
   * @returns Promise resolving to the event ID
   */
  private async sendErrorChunk(errorContent: string): Promise<string> {
    return this.createAndPublishEvent(errorContent, "error");
  }

  /**
   * Creates and publishes an event
   *
   * @param content - Event content
   * @param status - Chunk status
   * @returns Promise resolving to the event ID
   */
  private async createAndPublishEvent(
    content: string,
    status: StreamStatus
  ): Promise<string> {
    debugStream(
      `Sending chunk ${this.chunkIndex} stream ${getPublicKey(
        this.senderPrivkey
      )} size ${content.length}`
    );

    // Create and sign the event
    const event = createEvent(
      20173,
      content,
      [
        ["i", this.chunkIndex.toString()],
        ["status", status],
      ],
      this.senderPrivkey
    );

    // Increment chunk index for next chunk
    this.chunkIndex++;

    // Publish to relays
    const successfulRelays = await publishToRelays(
      event,
      this.metadata.relays,
      this.pool
    );

    if (successfulRelays.length === 0) {
      throw new Error("Failed to publish chunk to any relay");
    }

    return event.id;
  }

  /**
   * Disposes of the stream and releases resources
   * Implements the disposable pattern
   */
  [Symbol.dispose](): void {
    if (this.batchTimer) {
      clearTimeout(this.batchTimer);
      this.batchTimer = null;
    }

    if (this.compressor) {
      this.compressor[Symbol.dispose]();
      this.compressor = null;
    }

    this.currentChunkSize = 0;
  }
}
