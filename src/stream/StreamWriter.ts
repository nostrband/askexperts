/**
 * StreamWriter implementation for NIP-173 (Streaming Over Nostr)
 */

import { SimplePool, getPublicKey } from "nostr-tools";
import {
  Compression,
  COMPRESSION_NONE,
  CompressionInstance,
  getCompression,
} from "./compression.js";
import { Encryption, getEncryption } from "./encryption.js";
import { publishToRelays } from "../common/relay.js";
import { createEvent } from "../common/crypto.js";
import { StreamMetadata, StreamWriterConfig, StreamStatus, STREAM_CHUNK_KIND } from "./types.js";
import { debugStream, debugError, debugCompression } from "../common/debug.js";

/**
 * Default configuration values for StreamWriter
 */
const DEFAULT_CONFIG: Required<StreamWriterConfig> = {
  minChunkInterval: 0,
  minChunkSize: 64 * 1024, // 64Kb reasonable buffer size
  maxChunkSize: 256 * 1024, // 256Kb reasonable nostr event size limit
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
  private encryption: Encryption;
  private compressor: CompressionInstance | null = null;
  private senderPrivkey: Uint8Array;
  private chunkIndex = 0;
  private batchTimer: NodeJS.Timeout | null = null;
  private lastFlushTime: number = 0;
  private isDone = false;
  private isError = false;
  private currentChunkSize: number = 0;
  private publishPromises: Promise<void>[] = [];
  private lastChunkId: string | null = null;

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
    compression?: Compression,
    encryption?: Encryption
  ) {
    this.metadata = metadata;
    this.pool = pool;
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.compression = compression || getCompression();
    this.encryption = encryption || getEncryption();
    this.senderPrivkey = senderPrivkey;

    // Validate metadata
    if (!metadata.streamId) {
      throw new Error("Stream ID is required");
    }

    if (!metadata.relays || metadata.relays.length === 0) {
      throw new Error("At least one relay is required");
    }

    // Validate version
    if (metadata.version !== undefined && metadata.version !== "1") {
      throw new Error(`Unsupported protocol version: ${metadata.version}. Only version "1" is supported.`);
    }

    // Validate encryption requirements
    if (metadata.encryption === "nip44") {
      if (!metadata.receiver_pubkey) {
        throw new Error(
          "Recipient public key (receiver_pubkey) is required for NIP-44 encryption"
        );
      }
    }
  }

  get status(): StreamStatus {
    return this.isDone ? "done" : this.isError ? "error" : "active";
  }

  private isBinary() {
    return !!this.metadata.binary;
  }

  private async ensureCompressor() {
    if (!this.compressor) {
      this.compressor = await this.compression.startCompress(
        this.metadata.compression,
        this.isBinary(),
        await this.maxChunkSize()
      );
      this.currentChunkSize = 0;
    }
  }

  /**
   * Compresses data and updates the current chunk size
   *
   * @param data - Data to compress
   * @throws CompressionSizeLimitExceeded if the data would exceed the max chunk size
   */
  private async compress(data: string | Uint8Array) {
    await this.ensureCompressor();

    // Add data to compressor
    this.currentChunkSize = await this.compressor!.add(data);

    debugStream(
      `Added chunk of ${data.length} ${
        this.isBinary() ? "bytes" : "chars"
      }, current batch size ${this.currentChunkSize} bytes`
    );
  }

  /**
   * Writes data to the stream
   *
   * @param data - Data to write (string or Uint8Array)
   * @param done - Whether this is the last chunk
   */
  /**
   * Splits data into manageable chunks while preserving data type
   *
   * @param data - The data to split (string or Uint8Array)
   * @param maxPartSize - Maximum size of each part
   * @returns Array of parts with the same type as the input
   */
  private splitData(
    data: string | Uint8Array,
    maxPartSize: number
  ): (string | Uint8Array)[] {
    if (typeof data === "string") {
      // Split string by characters to preserve UTF-8 encoding
      const parts: string[] = [];
      let offset = 0;
      while (offset < data.length) {
        const end = Math.min(offset + maxPartSize, data.length);
        parts.push(data.substring(offset, end));
        offset = end;
      }
      return parts;
    } else {
      // Split binary data by bytes
      const parts: Uint8Array[] = [];
      let offset = 0;
      while (offset < data.length) {
        const end = Math.min(offset + maxPartSize, data.length);
        parts.push(data.slice(offset, end));
        offset = end;
      }
      return parts;
    }
  }

  async maxChunkSize() {
    let maxChunkSize = this.config.maxChunkSize;

    // Adjust for compression limits
    if (this.compressor) {
      const comprMaxChunkSize = await this.compressor.maxChunkSize();
      if (comprMaxChunkSize && comprMaxChunkSize < maxChunkSize)
        maxChunkSize = comprMaxChunkSize;
    }

    // Adjust for encryption limits
    const encMaxChunkSize = await this.encryption.maxChunkSize(
      this.metadata.encryption
    );
    if (encMaxChunkSize && encMaxChunkSize < maxChunkSize)
      maxChunkSize = encMaxChunkSize;

    // UTF8 may take 8 bytes per char
    if (!this.isBinary() && this.metadata.compression === "none")
      maxChunkSize = Math.floor(maxChunkSize / 8);

    return maxChunkSize;
  }

  async maxPartSize() {
    let maxPartSize = await this.maxChunkSize();

    // To allow efficient packaging of chunks we split
    // the input in 10x smaller parts to fill the chunks properly
    maxPartSize = Math.ceil(maxPartSize / 10);

    return maxPartSize;
  }

  async write(data: string | Uint8Array, done = false) {
    if (this.isError) {
      throw new Error("Stream failed");
    }

    if (this.isDone) {
      throw new Error("Stream is already closed");
    }

    // Clear any existing batch timer to avoid races
    if (this.batchTimer) {
      clearTimeout(this.batchTimer);
      this.batchTimer = null;
    }

    // Arm the timestamp
    if (!this.lastFlushTime) this.lastFlushTime = Date.now();

    // Ensure compressor is ready
    await this.ensureCompressor();

    // Split data into manageable chunks while preserving the original type
    const maxChunkSize = await this.maxPartSize();
    const maxPartSize = maxChunkSize ? maxChunkSize : data.length;
    const parts = this.splitData(data, maxPartSize);
    debugStream(
      `Writing ${data.length} ${
        this.isBinary() ? "bytes" : "chars"
      }, split into ${parts.length} parts`
    );

    // Process each part
    for (const part of parts) {
      try {
        // Try to compress this part (keeping the original type)
        await this.compress(part);
      } catch (err) {
        // If compression fails due to size limit, flush it,
        // even if currentChunkSize is 0 - compressor might
        // have buffered some data internally
        if (
          err instanceof Error &&
          err.name === "CompressionSizeLimitExceeded"
        ) {
          debugStream(`Chunk size exceeded, sending current batch`);

          // Flush it first
          await this.flushCompressor();

          // Try again with the current part
          await this.compress(part);
        } else {
          // For other errors, just rethrow
          throw err;
        }
      }
    }

    // Set done flag if requested
    this.isDone = done;

    // Flush conditions
    const alwaysFlush =
      !this.config.minChunkInterval && !this.config.minChunkSize;
    const bigChunk =
      this.config.minChunkSize > 0 &&
      this.currentChunkSize >= this.config.minChunkSize;
    const bigInterval =
      this.config.minChunkInterval > 0 &&
      this.lastFlushTime > 0 &&
      Date.now() - this.lastFlushTime >= this.config.minChunkInterval;

    // Flush if done or we've reached the minimum chunk size or the interval has passed
    if (this.isDone || bigChunk || bigInterval || alwaysFlush) {
      debugStream(
        `Sending by condition ${JSON.stringify({
          isDone: this.isDone,
          bigChunk,
          bigInterval,
          alwaysFlush,
        })}`
      );

      // Send immediately
      await this.flushCompressor();

      // Clear up
      if (this.isDone) {
        // Wait until it's all published to relays
        await this.waitPublished();

        // Clear
        this[Symbol.dispose]();
      }
    }

    // Set up timer for interval-based sending if not already done
    if (!this.isDone && this.config.minChunkInterval > 0 && !this.batchTimer) {
      this.batchTimer = setTimeout(async () => {
        // Timeout expired but we've already flushed
        if (!this.currentChunkSize) return;
        try {
          debugStream(`Sending by timeout`);
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

        // Signal that we can't send the error
        throw err;
      }
    }

    // Send error chunk
    const errorContent = JSON.stringify({ code, message });
    await this.sendErrorChunk(errorContent);

    // Wait until it's all published to relays
    await this.waitPublished();

    // Clear itself
    this[Symbol.dispose]();
  }

  private async waitPublished() {
    await Promise.allSettled(this.publishPromises);
  }

  /**
   * Flushes the current compressor and sends the compressed data as a chunk
   *
   * @returns Promise resolving to the event ID of the sent chunk
   */
  private async flushCompressor() {
    // We're sending, clear the interval-based sender timer
    if (this.batchTimer) {
      clearTimeout(this.batchTimer);
      this.batchTimer = null;
    }

    try {
      // Get the compressed content
      const compressedData = this.compressor
        ? await this.compressor.finish()
        : this.isBinary()
        ? new Uint8Array()
        : "";

      // Dispose of the current compressor
      if (this.compressor) this.compressor[Symbol.dispose]();
      this.currentChunkSize = 0;
      this.compressor = null;

      // Remember the current send time
      this.lastFlushTime = Date.now();

      // Send the compressed data with appropriate status
      const status = this.isDone ? "done" : "active";
      debugStream(
        `Sending batch of size ${compressedData.length} ${
          typeof compressedData === "string" ? "chars" : "bytes"
        }, status ${status}`
      );
      await this.sendCompressedChunk(compressedData, status);
    } catch (e) {
      this.isError = true;
      debugError("Failed to send chunk", e);
      throw e;
    }
  }

  /**
   * Sends a compressed chunk of data as a kind:20173 event
   *
   * @param compressedContent - Compressed content to send
   * @param status - Chunk status
   */
  private async sendCompressedChunk(
    compressedData: string | Uint8Array,
    status: StreamStatus
  ) {
    // Implement the 'send' logic from NIP-173 pseudocode:
    // send(data: string | Uint8Array, enc_type: string, compr_type: string): string
    try {
      const encType = this.metadata.encryption;
      const comprType = this.metadata.compression;

      // The compressedData is already compressed (zipped_data in the pseudocode)
      // Now we need to handle encryption and string conversion

      let eventContent: string;

      if (!encType || encType === "none") {
        // If no encryption, handle string or Uint8Array appropriately
        if (typeof compressedData === "string") {
          // If it's already a string, use it directly
          eventContent = compressedData;
        } else {
          // For Uint8Array, check if we need to convert to base64 or decode
          const needsStringConversion = this.isBinary() || comprType !== "none";

          if (needsStringConversion) {
            // bin2str - convert binary to base64 string
            eventContent = Buffer.from(compressedData).toString("base64");
          } else {
            // If it's already a string and no compression, just decode
            eventContent = new TextDecoder().decode(compressedData);
          }
        }
      } else {
        // If encryption is used
        if (!this.metadata.receiver_pubkey) {
          throw new Error("Missing recipient public key for encryption");
        }
        
        // Use the receiver_pubkey from metadata
        const recipientPubkey = this.metadata.receiver_pubkey;

        // Encrypt the compressed data using the encryption interface
        eventContent = await this.encryption.encrypt(
          compressedData,
          encType,
          this.senderPrivkey,
          recipientPubkey
        );
      }

      await this.createAndPublishEvent(eventContent, status);
    } catch (err) {
      debugError("Error processing chunk data:", err);
      throw err;
    }
  }

  /**
   * Sends an error chunk
   *
   * @param errorContent - Error content as JSON string
   */
  private async sendErrorChunk(errorContent: string) {
    await this.createAndPublishEvent(errorContent, "error");
  }

  /**
   * Creates and publishes an event
   *
   * @param content - Event content
   * @param status - Chunk status
   */
  private async createAndPublishEvent(content: string, status: StreamStatus) {
    // Current index
    const index = this.chunkIndex;

    // Increment chunk index for next chunk
    this.chunkIndex++;

    debugStream(
      `Sending chunk ${index} stream ${getPublicKey(this.senderPrivkey)} size ${
        content.length
      }`
    );

    // Prepare tags
    const tags = [
      ["i", index.toString()],
      ["status", status],
    ];

    // Add prev tag for all chunks except the first one
    if (index > 0 && this.lastChunkId) {
      tags.push(["prev", this.lastChunkId]);
    }

    // Create and sign the event
    const event = createEvent(STREAM_CHUNK_KIND, content, tags, this.senderPrivkey);

    // Store this event ID for the next chunk
    this.lastChunkId = event.id;

    // FIXME find the number that matches high bandwidth
    // and chunk sizes
    if (this.publishPromises.length > 10) {
      debugStream(
        `Too many pending chunks ${this.publishPromises.length}, waiting...`
      );
      // Wait for at least one publish to succeed
      await Promise.race(this.publishPromises);
    }

    // Publish to relays
    const promise = publishToRelays(
      event,
      this.metadata.relays,
      this.pool
      //      60000 // higher timeout
    )
      .then((successfulRelays) => {
        // Drop this finished promise
        this.publishPromises = this.publishPromises.filter(
          (p) => p !== promise
        );

        if (successfulRelays.length === 0) {
          this.error("RELAY_FAILURE", `Failed to send to relay chunk ${index}`);
        } else {
          debugStream(
            `Published chunk ${index} to relays ${successfulRelays.length}`
          );
        }
      })
      .catch((e) => {
        console.error("Failed to publish chunk", index, e);
        this.error("FAILED_TO_PUBLISH", `Failed to publish chunk ${index}`);
      });

    this.publishPromises.push(promise);
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
