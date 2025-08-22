/**
 * NIP-173 (Streaming Over Nostr) implementation
 */

// Export types
export * from './types.js';

// Export StreamWriter
export { StreamWriter } from './StreamWriter.js';

// Export StreamReader and StreamReaderError
export { StreamReader, StreamReaderError } from './StreamReader.js';

// Export StreamFactory
export { DefaultStreamFactory, getStreamFactory } from './DefaultStreamFactory.js';
export type { StreamFactory } from './interfaces.js';

// Export Compression
export {
  DefaultCompression,
  getCompression,
  COMPRESSION_NONE,
  COMPRESSION_GZIP
} from './compression.js';

// Export Encryption
export {
  DefaultEncryption,
  getEncryption,
  ENCRYPTION_NONE,
  ENCRYPTION_NIP44
} from './encryption.js';

// Export Metadata functions
export {
  createStreamMetadataEvent,
  parseStreamMetadataEvent
} from './metadata.js';