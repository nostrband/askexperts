/**
 * Type definitions for NIP-173 (Streaming Over Nostr) protocol
 */

import { Event } from 'nostr-tools';

/**
 * Supported encryption schemes for NIP-173 streams
 */
export type StreamEncryption = 'none' | 'nip44' | (string & {});

/**
 * Supported compression formats for NIP-173 streams
 */
export type StreamCompression = 'none' | 'gzip' | 'base64' | (string & {});

/**
 * Status of a stream chunk
 */
export type StreamStatus = 'active' | 'done' | 'error';

/**
 * Error information when a stream has status 'error'
 */
export interface StreamError {
  code: string;
  message: string;
}

/**
 * Metadata for a NIP-173 stream
 * This is extracted from a kind:173 event
 */
export interface StreamMetadata {
  /** Stream ID (sender_pubkey) */
  streamId: string;
  
  /** Encryption scheme used for this stream */
  encryption: StreamEncryption;
  
  /** Compression format used per chunk */
  compression: StreamCompression;
  
  /**
   * Hex-encoded 32-byte private key for the recipient (only when encryption is used)
   * For the sender, this is used to derive the recipient's public key for encryption
   * For the recipient, this is used directly for decryption
   */
  key?: string;
  
  /** Relays where chunk events are published */
  relays: string[];
  
  /** Original metadata event */
  event?: Event;
}

/**
 * Configuration for StreamWriter
 */
export interface StreamWriterConfig {
  /** Minimum time interval between chunks in milliseconds */
  minChunkInterval?: number;
  
  /** Minimum size of a chunk in bytes before sending */
  minChunkSize?: number;
  
  /** Maximum size of a chunk in bytes */
  maxChunkSize?: number;
}

/**
 * Configuration for StreamReader
 */
export interface StreamReaderConfig {
  /** Maximum number of chunks to process */
  maxChunks?: number;
  
  /** Maximum total size of all chunks in bytes */
  maxResultSize?: number;
  
  /** Time-to-live in milliseconds for waiting for the next chunk */
  ttl?: number;
}