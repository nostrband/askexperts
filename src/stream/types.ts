/**
 * Type definitions for NIP-173 (Streaming Over Nostr) protocol
 */

import { Event } from 'nostr-tools';

/**
 * Event kinds for NIP-173 (Streaming Over Nostr)
 */
export const STREAM_METADATA_KIND = 173;
export const STREAM_CHUNK_KIND = 20173;


/**
 * Supported compression formats for NIP-173 streams
 */
export type CompressionMethod = 'none' | 'gzip' | (string & {});

/**
 * Supported encryption schemes for NIP-173 streams
 */
export type EncryptionMethod = 'none' | 'nip44' | (string & {});

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
  
  /** Protocol version (must be "1") */
  version?: string;
  
  /** Encryption scheme used for this stream */
  encryption: EncryptionMethod;
  
  /** Compression format used per chunk */
  compression: CompressionMethod;
  
  /** Whether original data is binary */
  binary?: boolean;
  
  /**
   * Public key of the receiver (only when encryption is used)
   * This is the pubkey for which the sender will encrypt the stream
   */
  receiver_pubkey?: string;
  
  /**
   * Private key for the recipient (only when encryption is used)
   * This is not part of the protocol but must be supplied by the client code
   * Not used by sender.
   * For the recipient, this is used for decryption
   */
  receiver_privkey?: Uint8Array;
  
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