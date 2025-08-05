/**
 * Interfaces for NIP-173 streaming implementation
 */

import { SimplePool } from "nostr-tools";
import { StreamMetadata, StreamStatus, StreamWriterConfig, StreamReaderConfig } from "./types.js";

/**
 * Interface for StreamWriter
 * Defines methods for writing data to a Nostr stream
 */
export interface StreamWriterInterface {
  /**
   * Gets the current status of the stream
   */
  readonly status: StreamStatus;

  /**
   * Writes data to the stream
   *
   * @param data - Data to write (string or Uint8Array)
   * @param done - Whether this is the last chunk
   * @returns Promise that resolves when the data is written
   */
  write(data: string | Uint8Array, done?: boolean): Promise<void>;

  /**
   * Sends an error status and closes the stream
   *
   * @param code - Error code
   * @param message - Error message
   * @returns Promise that resolves when the error is sent
   */
  error(code: string, message: string): Promise<void>;

  /**
   * Disposes of the stream and releases resources
   */
  [Symbol.dispose](): void;
}

/**
 * Interface for StreamFactory
 * Defines methods for creating StreamReader and StreamWriter instances
 */
export interface StreamFactory {
  /**
   * Creates a StreamReader for reading from a stream
   *
   * @param metadata - Stream metadata
   * @param pool - SimplePool instance for relay communication
   * @param config - Configuration options
   * @returns Promise resolving to an AsyncIterable of string or Uint8Array
   */
  createReader(
    metadata: StreamMetadata,
    pool: SimplePool,
    config?: StreamReaderConfig
  ): Promise<AsyncIterable<string | Uint8Array>>;

  /**
   * Creates a StreamWriter for writing to a stream
   *
   * @param metadata - Stream metadata
   * @param pool - SimplePool instance for relay communication
   * @param senderPrivkey - Private key for signing stream events
   * @param config - Configuration options
   * @returns Promise resolving to a StreamWriterInterface
   */
  createWriter(
    metadata: StreamMetadata,
    pool: SimplePool,
    senderPrivkey: Uint8Array,
    config?: StreamWriterConfig
  ): Promise<StreamWriterInterface>;
}