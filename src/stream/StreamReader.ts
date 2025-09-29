/**
 * StreamReader implementation for NIP-173 (Streaming Over Nostr)
 */

import { SimplePool, Event, Filter, getPublicKey } from "nostr-tools";
import { Compression, getCompression } from "./compression.js";
import { Encryption, getEncryption } from "./encryption.js";
import { subscribeToRelays } from "../common/relay.js";
import {
  StreamMetadata,
  StreamReaderConfig,
  StreamStatus,
  StreamError as StreamErrorType,
  STREAM_CHUNK_KIND,
} from "./types.js";
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
export class StreamReader implements AsyncIterable<string | Uint8Array> {
  private metadata: StreamMetadata;
  private pool: SimplePool;
  private config: Required<StreamReaderConfig>;
  private compression: Compression;
  private encryption: Encryption;
  private buffer: Map<string, Event> = new Map();
  private resultBuffer: IteratorResult<string | Uint8Array, any>[] = [];
  private nextRef = "";
  private totalSize = 0;
  private chunkCount = 0;
  private isDone = false;
  private lastEventTime = 0;
  private subscription: { close: () => void } | null = null;
  private waitingPromiseHandlers: Array<{
    resolve: (value: IteratorResult<string | Uint8Array, any>) => void;
    reject: (reason: any) => void;
  }> = [];
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
    compression?: Compression,
    encryption?: Encryption
  ) {
    this.metadata = metadata;
    this.pool = pool;
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.compression = compression || getCompression();
    this.encryption = encryption || getEncryption();

    // Validate metadata
    if (!metadata.streamId) {
      throw new Error("Stream ID is required");
    }

    if (!metadata.relays || metadata.relays.length === 0) {
      throw new Error("At least one relay is required");
    }

    // Validate version
    if (metadata.version !== undefined && metadata.version !== "1") {
      throw new Error(
        `Unsupported protocol version: ${metadata.version}. Only version "1" is supported.`
      );
    }

    if (metadata.encryption === "") {
      throw new Error("Unspecified encryption");
    }

    if (metadata.compression === "") {
      throw new Error("Unspecified compression");
    }

    // Validate encryption requirements
    if (metadata.encryption !== "none") {
      if (!metadata.receiver_privkey) {
        throw new Error(
          "Recipient private key (receiver_privkey) is required for decryption"
        );
      }

      if (!metadata.receiver_pubkey) {
        throw new Error(
          "Recipient public key (receiver_pubkey) is required for decryption"
        );
      }

      // Validate that the receiver_pubkey matches the public key derived from receiver_privkey
      const derivedPubkey = getPublicKey(metadata.receiver_privkey);
      if (derivedPubkey !== metadata.receiver_pubkey) {
        throw new Error(
          "Recipient public key (receiver_pubkey) does not match the key derived from receiver_privkey"
        );
      }
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
      kinds: [STREAM_CHUNK_KIND],
      authors: [this.metadata.streamId],
    };

    // Subscribe to the stream
    this.subscription = subscribeToRelays(
      filter,
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

    // Extract index from tags (still needed for validation and logging)
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

    // Extract prev tag (empty string for first chunk)
    const prevTag = event.tags.find((tag) => tag[0] === "prev");
    const prevRef = index && prevTag ? prevTag[1] : "";
    if (index > 0 && !prevRef) {
      debugError(`Skipping chunk index ${index} without prev tag`);
      return;
    }

    // Store the event in the buffer using prev tag as key
    this.buffer.set(prevRef, event);
    this.chunkCount++;
    debugStream(
      `Received chunk index ${index} with prev='${prevRef}' payload size ${event.content.length} buffered count ${this.buffer.size} of total ${this.chunkCount}`
    );

    // Process any events that are now in sequence
    this.processBuffer();
  }

  /**
   * Processes events from the buffer in sequence
   */
  private async processBuffer() {
    // Process events in order based on prev tag chain
    while (this.buffer.has(this.nextRef) && !this.error && !this.isDone) {
      const event = this.buffer.get(this.nextRef)!;

      // Extract index for logging
      const indexTag = event.tags.find((tag) => tag[0] === "i");
      const index = indexTag ? indexTag[1] : "unknown";

      debugStream(
        `Processing chunk index ${index} with nextRef=${this.nextRef} payload ${event.content.length}`
      );

      // Remove from buffer
      this.buffer.delete(this.nextRef);

      // Extract status from tags
      const statusTag = event.tags.find((tag) => tag[0] === "status");
      const status = statusTag?.[1] as StreamStatus;

      // Process the chunk
      try {
        const chunk = await this.processChunk(event.content);

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
        const result = { value: chunk, done: false };
        if (this.waitingPromiseHandlers.length > 0) {
          if (this.resultBuffer.length > 0)
            throw new Error("Bad iterator state");
          const handler = this.waitingPromiseHandlers.shift()!;
          handler.resolve(result);
        } else {
          this.resultBuffer.push(result);
        }

        // If this was the last chunk
        if (status === "done") {
          this.isDone = true;
          this.close();

          // Resolve all pending promises with 'done'.
          // NOTE: resultBuffer should be empty if there are
          // waiting promises.
          while (this.waitingPromiseHandlers.length > 0) {
            const handler = this.waitingPromiseHandlers.shift()!;
            handler.resolve({ value: undefined, done: true });
          }
        }
      } catch (err: any) {
        this.setError(err);
      }

      // Update nextRef to current event ID for chain continuation
      this.nextRef = event.id;
    }
  }

  /**
   * Processes a chunk by decompressing and decrypting it
   *
   * @param content - The chunk content
   * @returns Promise resolving to the processed chunk
   */
  private async processChunk(content: string): Promise<string | Uint8Array> {
    try {
      // Implement the 'recv' logic from NIP-173
      const isBinary = !!this.metadata.binary;
      const encType = this.metadata.encryption;
      const comprType = this.metadata.compression;

      // Following the pseudocode from NIP-173:
      // recv(data: string, binary: boolean, enc_type: string, compr_type: string): string | Uint8Array

      // Step 1: Determine if we need binary handling based on binary flag or compression
      const binaryOrCompr = isBinary || comprType !== "none";

      // Step 2: Decode the data if needed (when no encryption but binary or compressed)
      let decodedData: string | Uint8Array;
      if (encType === "none" && binaryOrCompr) {
        // str2bin - convert base64 string to binary
        try {
          decodedData = Buffer.from(content, "base64");
        } catch (err) {
          throw new StreamReaderError(
            "decode_failed",
            `Failed to decode base64 content: ${
              err instanceof Error ? err.message : String(err)
            }`
          );
        }
      } else {
        decodedData = content;
      }

      // Step 3: Decrypt the data if encryption is used
      let decryptedData: string | Uint8Array;
      if (encType !== "none") {
        try {
          // Convert hex key to Uint8Array
          const recipientPrivkey = this.metadata.receiver_privkey!;

          // Decrypt using the encryption interface
          decryptedData = await this.encryption.decrypt(
            decodedData as string,
            encType as any,
            binaryOrCompr,
            recipientPrivkey,
            this.metadata.streamId
          );
        } catch (err) {
          throw new StreamReaderError(
            "decryption_failed",
            `Failed to decrypt chunk: ${
              err instanceof Error ? err.message : String(err)
            }`
          );
        }
      } else {
        decryptedData = decodedData;
      }

      // Step 4: Decompress the data if compression is used
      let result: string | Uint8Array;
      if (comprType !== "none") {
        result = await this.compression.decompress(
          decryptedData,
          comprType,
          isBinary
        );
      } else {
        result = decryptedData;
      }

      // Update total size
      this.totalSize += result.length;

      return result;
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
            `TTL exceeded (${this.config.ttl}ms) while waiting for next chunk in chain`
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
    while (this.waitingPromiseHandlers.length > 0) {
      const handler = this.waitingPromiseHandlers.shift()!;
      handler.reject(err);
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
  [Symbol.asyncIterator](): AsyncIterator<string | Uint8Array> {
    // Start the subscription if not already started
    this.start();

    return {
      next: async (): Promise<IteratorResult<string | Uint8Array>> => {
        // If we have an error, throw it
        if (this.error) {
          throw this.error;
        }

        // If the stream is done, return done
        if (this.isDone && !this.resultBuffer.length) {
          return { value: undefined, done: true };
        }

        // Return next buffered result
        if (this.resultBuffer.length) {
          return this.resultBuffer.shift()!;
        }

        // Wait for the next chunk
        return new Promise<IteratorResult<string | Uint8Array>>(
          (resolve, reject) => {
            this.waitingPromiseHandlers.push({ resolve, reject });
          }
        );
      },

      return: async (): Promise<IteratorResult<string | Uint8Array>> => {
        this.close();
        return { value: undefined, done: true };
      },

      throw: async (err: any): Promise<IteratorResult<string | Uint8Array>> => {
        this.setError(err instanceof Error ? err : new Error(String(err)));
        this.close();
        throw this.error;
      },
    };
  }

  [Symbol.dispose](): void {
    this.close();
    this.resultBuffer.length = 0;
  }
}
