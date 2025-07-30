/**
 * StreamReader implementation for NIP-173 (Streaming Over Nostr)
 */

import { SimplePool, Event, Filter } from "nostr-tools";
import { Compression, getCompression } from "./compression.js";
import { subscribeToRelays } from "../common/relay.js";
import { decrypt } from "../common/crypto.js";
import {
  StreamMetadata,
  StreamReaderConfig,
  StreamStatus,
  StreamError as StreamErrorType,
} from "./types.js";
import { CompressionMethod } from "../common/types.js";
import { debugStream, debugError } from "../common/debug.js";

/**
 * Default configuration values for StreamReader
 */
const DEFAULT_CONFIG: Required<StreamReaderConfig> = {
  maxChunks: 1000,
  maxResultSize: 10 * 1024 * 1024, // 10MB
  ttl: 60000, // 60 seconds
};

/**
 * Error thrown when a stream operation fails
 */
export class StreamReaderError extends Error {
  code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = "StreamError";
    this.code = code;
  }
}

/**
 * StreamReader for NIP-173 streams
 * Implements AsyncIterable to allow for iterating over chunks
 */
export class StreamReader implements AsyncIterable<Uint8Array> {
  private metadata: StreamMetadata;
  private pool: SimplePool;
  private config: Required<StreamReaderConfig>;
  private compression: Compression;
  private buffer: Map<number, Event> = new Map();
  private nextIndex = 0;
  private totalSize = 0;
  private chunkCount = 0;
  private isDone = false;
  private lastEventTime = 0;
  private subscription: { close: () => void } | null = null;
  private waitingResolvers: ((
    value: IteratorResult<Uint8Array, any>
  ) => void)[] = [];
  private waitingRejecters: ((reason: any) => void)[] = [];
  private error: Error | null = null;

  /**
   * Creates a new StreamReader
   *
   * @param metadata - Stream metadata
   * @param pool - SimplePool instance for relay communication
   * @param config - Configuration options
   * @param compression - Optional custom compression implementation
   */
  constructor(
    metadata: StreamMetadata,
    pool: SimplePool,
    config: StreamReaderConfig = {},
    compression?: Compression
  ) {
    this.metadata = metadata;
    this.pool = pool;
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.compression = compression || getCompression();

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
        "Recipient private key (key) is required for NIP-44 decryption"
      );
    }
  }

  /**
   * Starts the stream subscription
   * This is called automatically when iteration begins
   */
  private start(): void {
    if (this.subscription) {
      return; // Already started
    }

    // Create filter for the stream chunks
    const filter: Filter = {
      kinds: [20173],
      authors: [this.metadata.streamId],
    };

    // Subscribe to the stream
    this.subscription = subscribeToRelays(
      [filter],
      this.metadata.relays,
      this.pool,
      {
        onevent: (event) => this.handleEvent(event),
      }
    );

    // Set initial last event time
    this.lastEventTime = Date.now();

    // Start TTL timer
    this.startTtlTimer();
  }

  /**
   * Handles an incoming event
   *
   * @param event - The received event
   */
  private handleEvent(event: Event): void {
    // Update last event time
    this.lastEventTime = Date.now();

    // Extract index from tags
    const indexTag = event.tags.find((tag) => tag[0] === "i");
    if (!indexTag || !indexTag[1]) {
      debugStream("Received chunk without index tag:", event);
      return;
    }

    const index = parseInt(indexTag[1], 10);
    if (isNaN(index)) {
      debugStream("Received chunk with invalid index:", indexTag[1]);
      return;
    }

    // Extract status from tags
    const statusTag = event.tags.find((tag) => tag[0] === "status");
    if (!statusTag || !statusTag[1]) {
      debugStream("Received chunk without status tag:", event);
      return;
    }

    const status = statusTag[1] as StreamStatus;

    // Handle error status
    if (status === "error") {
      try {
        const errorData = JSON.parse(event.content) as StreamErrorType;
        this.setError(new StreamReaderError(errorData.code, errorData.message));
        return;
      } catch (err) {
        this.setError(
          new StreamReaderError("parse_error", "Failed to parse error content")
        );
        return;
      }
    }

    // Check if we've exceeded max chunks
    if (this.chunkCount >= this.config.maxChunks) {
      this.setError(
        new StreamReaderError(
          "max_chunks_exceeded",
          `Maximum number of chunks exceeded (${this.config.maxChunks})`
        )
      );
      return;
    }

    // Store the event in the buffer
    this.buffer.set(index, event);
    this.chunkCount++;

    // Process any events that are now in sequence
    this.processBuffer();
  }

  /**
   * Processes events from the buffer in sequence
   */
  private async processBuffer() {
    // Process events in order
    while (this.buffer.has(this.nextIndex) && !this.error) {
      const event = this.buffer.get(this.nextIndex)!;
      this.buffer.delete(this.nextIndex);

      // Extract status from tags
      const statusTag = event.tags.find((tag) => tag[0] === "status");
      const status = statusTag?.[1] as StreamStatus;

      // Process the chunk
      try {
        const chunk = await this.processChunk(event.content, status === "done");

        // Check if we've exceeded max result size
        if (this.totalSize > this.config.maxResultSize) {
          this.setError(
            new StreamReaderError(
              "max_size_exceeded",
              `Maximum result size exceeded (${this.config.maxResultSize} bytes)`
            )
          );
          return;
        }

        // Resolve waiting promises with the chunk
        if (this.waitingResolvers.length > 0) {
          const resolve = this.waitingResolvers.shift()!;
          resolve({ value: chunk, done: false });
        }

        // If this was the last chunk, resolve any remaining promises with done
        if (status === "done") {
          this.isDone = true;
          this.close();

          // Resolve any waiting promises with done
          while (this.waitingResolvers.length > 0) {
            const resolve = this.waitingResolvers.shift()!;
            resolve({ value: undefined, done: true });
          }
        }
      } catch (err: any) {
        this.setError(err);
      }

      // Move to next index
      this.nextIndex++;
    }
  }

  /**
   * Processes a chunk by decompressing and decrypting it
   *
   * @param content - The chunk content
   * @returns Promise resolving to the processed chunk
   */
  private async processChunk(
    content: string,
  ): Promise<Uint8Array> {
    try {
      // Apply NIP-44 decryption if configured
      let processedContent = content;

      if (this.metadata.encryption === "nip44") {
        if (!this.metadata.key) {
          throw new StreamReaderError(
            "missing_key",
            "Missing recipient private key (key) for NIP-44 decryption"
          );
        }

        try {
          // Convert hex key to Uint8Array
          const recipientPrivkey = Buffer.from(this.metadata.key, "hex");

          // Decrypt the content using NIP-44
          processedContent = decrypt(
            content,
            this.metadata.streamId,
            recipientPrivkey
          );
        } catch (err) {
          throw new StreamReaderError(
            "decryption_failed",
            `Failed to decrypt chunk: ${
              err instanceof Error ? err.message : String(err)
            }`
          );
        }
      }

      // Decompress the content
      const decompressed = await this.compression.decompress(
        processedContent,
        this.metadata.compression as CompressionMethod
      );

      // Convert to Uint8Array
      const chunk = new TextEncoder().encode(decompressed);

      // Update total size
      this.totalSize += chunk.length;

      return chunk;
    } catch (err) {
      debugError("Error processing chunk:", err);
      throw err instanceof Error
        ? err
        : new StreamReaderError("processing_error", String(err));
    }
  }

  /**
   * Starts the TTL timer to detect stalled streams
   */
  private startTtlTimer(): void {
    if (this.config.ttl <= 0) {
      return; // TTL disabled
    }

    const checkTtl = () => {
      if (this.isDone || this.error) {
        return; // Stream is already done or has error
      }

      const now = Date.now();
      const elapsed = now - this.lastEventTime;

      if (elapsed > this.config.ttl) {
        this.setError(
          new StreamReaderError(
            "ttl_exceeded",
            `TTL exceeded (${this.config.ttl}ms) while waiting for chunk ${this.nextIndex}`
          )
        );
        return;
      }

      // Schedule next check
      setTimeout(checkTtl, Math.min(1000, this.config.ttl / 2));
    };

    // Start checking
    setTimeout(checkTtl, Math.min(1000, this.config.ttl / 2));
  }

  /**
   * Sets an error and rejects any waiting promises
   *
   * @param err - The error
   */
  private setError(err: Error): void {
    if (this.error) {
      return; // Already have an error
    }

    this.error = err;
    this.close();

    // Reject any waiting promises
    while (this.waitingRejecters.length > 0) {
      const reject = this.waitingRejecters.shift()!;
      reject(err);
    }
  }

  /**
   * Closes the stream and releases resources
   */
  private close(): void {
    if (this.subscription) {
      this.subscription.close();
      this.subscription = null;
    }

    // Clear buffer
    this.buffer.clear();
  }

  /**
   * Implements AsyncIterable interface
   */
  [Symbol.asyncIterator](): AsyncIterator<Uint8Array> {
    // Start the subscription if not already started
    this.start();

    return {
      next: async (): Promise<IteratorResult<Uint8Array>> => {
        // If we have an error, throw it
        if (this.error) {
          throw this.error;
        }

        // If the stream is done, return done
        if (this.isDone) {
          return { value: undefined, done: true };
        }

        // If we have a buffered event for the next index, process it
        if (this.buffer.has(this.nextIndex)) {
          this.processBuffer();
        }

        // If we still have an error after processing, throw it
        if (this.error) {
          throw this.error;
        }

        // Wait for the next chunk
        return new Promise<IteratorResult<Uint8Array>>((resolve, reject) => {
          this.waitingResolvers.push(resolve);
          this.waitingRejecters.push(reject);
        });
      },

      return: async (): Promise<IteratorResult<Uint8Array>> => {
        this.close();
        return { value: undefined, done: true };
      },

      throw: async (err: any): Promise<IteratorResult<Uint8Array>> => {
        this.setError(err instanceof Error ? err : new Error(String(err)));
        this.close();
        throw this.error;
      },
    };
  }
}
