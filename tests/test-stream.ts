/**
 * Test for NIP-173 (Streaming Over Nostr) implementation
 */

import { SimplePool, generateSecretKey, getPublicKey } from 'nostr-tools';
import { StreamMetadata, StreamWriter, StreamReader } from '../src/stream/index.js';
import { debugStream, debugError, enableAllDebug } from '../src/common/debug.js';

// Example usage of StreamWriter and StreamReader
async function testStream() {
  enableAllDebug();

  try {
    debugStream('Testing NIP-173 stream implementation...');
    
    // Create a SimplePool instance
    const pool = new SimplePool();
    
    // Generate a random key pair for the stream
    const senderPrivkey = generateSecretKey();
    const streamId = getPublicKey(senderPrivkey);
    
    // Generate a key pair for the recipient
    const recipientPrivkey = generateSecretKey();
    const recipientPubkey = getPublicKey(recipientPrivkey);
    
    debugStream(`Stream ID: ${streamId}`);
    debugStream(`Recipient pubkey: ${recipientPubkey}`);
    
    // Define relays to use
    const relays = ['wss://relay.primal.net', 'wss://relay.nostr.band'];
    
    // Create stream metadata
    const metadata: StreamMetadata = {
      streamId,
      encryption: 'none',
      compression: 'none',
      key: Buffer.from(recipientPrivkey).toString('hex'), // Recipient's private key in hex format
      relays,
    };
    
    // Create a StreamWriter
    const writer = new StreamWriter(
      metadata,
      pool,
      senderPrivkey,            // Private key for signing and encryption
      {
        minChunkInterval: 10, // 1 second
        minChunkSize: 1024,     // 1KB
        maxChunkSize: 10,
      },
      undefined                 // Use default compression
    );
    
    // Create a StreamReader
    const reader = new StreamReader(
      metadata,
      pool,
      {
        maxChunks: 100,
        maxResultSize: 1024 * 1024, // 1MB
        ttl: 30000,                 // 30 seconds
      },
      undefined                     // Use default compression
    );
    
    // Start reading in a separate async function
    (async () => {
      debugStream('Reader: Starting to read stream...');
      try {
        // Iterate over chunks as they arrive
        for await (const chunk of reader) {
          const text = new TextDecoder().decode(chunk);
          debugStream(`Reader: Received chunk: ${text}`);
        }
        debugStream('Reader: Stream completed');
      } catch (err) {
        debugError('Reader error:', err);
      }
    })();
    
    // Write some data to the stream
    debugStream('Writer: Writing chunk 1');
    await writer.write('Hello, ');
    
    // Wait a bit
    await new Promise(resolve => setTimeout(resolve, 1500));
    
    // Write more data
    debugStream('Writer: Writing chunk 2');
    await writer.write('Nostr!Nostr!Nostr!');
    
    // Wait a bit
    await new Promise(resolve => setTimeout(resolve, 1500));
    
    // Finish the stream
    debugStream('Writer: Finishing stream');
    await writer.write('This is the end of the stream.', true);
    
    // Clean up
    writer[Symbol.dispose]();
    
    debugStream('Test completed');
  } catch (err) {
    debugError('Test error:', err);
  }
}

// Run the test
testStream().catch(err => debugError('Unhandled error:', err));