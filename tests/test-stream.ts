/**
 * Test for NIP-173 (Streaming Over Nostr) implementation
 */

import { SimplePool, generateSecretKey, getPublicKey } from 'nostr-tools';
import { StreamMetadata, StreamWriter, StreamReader } from '../src/stream/index.js';
import { debugStream, debugError, enableAllDebug } from '../src/common/debug.js';

// Example usage of StreamWriter and StreamReader with string data
async function testStringStream() {
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
      receiver_privkey: Buffer.from(recipientPrivkey).toString('hex'), // Recipient's private key in hex format
      relays,
    };
    
    // Create a StreamWriter
    const writer = new StreamWriter(
      metadata,
      pool,
      senderPrivkey,            // Private key for signing and encryption
      {
        minChunkInterval: 10, // 10 milliseconds
        minChunkSize: 1024,     // 1KB
        maxChunkSize: 10 * 1024, // 10KB
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
          if (typeof chunk !== 'string') throw new Error("String expected");
          debugStream(`Reader: Received chunk: ${chunk}`);
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

// Test binary mode with Uint8Array data
async function testBinaryStream() {
  enableAllDebug();

  try {
    debugStream('Testing NIP-173 binary stream implementation...');
    
    // Create a SimplePool instance
    const pool = new SimplePool();
    
    // Generate a random key pair for the stream
    const senderPrivkey = generateSecretKey();
    const streamId = getPublicKey(senderPrivkey);
    
    // Generate a key pair for the recipient
    const recipientPrivkey = generateSecretKey();
    const recipientPubkey = getPublicKey(recipientPrivkey);
    
    debugStream(`Binary Stream ID: ${streamId}`);
    debugStream(`Binary Recipient pubkey: ${recipientPubkey}`);
    
    // Define relays to use
    const relays = ['wss://relay.primal.net', 'wss://relay.nostr.band'];
    
    // Create stream metadata with binary flag set to true
    const metadata: StreamMetadata = {
      streamId,
      encryption: 'none',
      compression: 'none',
      binary: true, // Set binary flag to true
      receiver_privkey: Buffer.from(recipientPrivkey).toString('hex'),
      relays,
    };
    
    // Create a StreamWriter
    const writer = new StreamWriter(
      metadata,
      pool,
      senderPrivkey,
      {
        minChunkInterval: 10,
        minChunkSize: 1024,
        maxChunkSize: 10 * 1024,
      }
    );
    
    // Create a StreamReader
    const reader = new StreamReader(
      metadata,
      pool,
      {
        maxChunks: 100,
        maxResultSize: 1024 * 1024,
        ttl: 30000,
      }
    );
    
    // Start reading in a separate async function
    (async () => {
      debugStream('Binary Reader: Starting to read stream...');
      try {
        // Iterate over chunks as they arrive
        for await (const chunk of reader) {
          if (typeof chunk === 'string') throw new Error("Bytes expected");
          debugStream(`Binary Reader: Received chunk of size: ${chunk.byteLength} bytes`);
          // Display the first few bytes for debugging
          const preview = Array.from(chunk.slice(0, Math.min(10, chunk.byteLength)))
            .map(b => b.toString(16).padStart(2, '0'))
            .join(' ');
          debugStream(`Binary Reader: First bytes: ${preview}...`);
        }
        debugStream('Binary Reader: Stream completed');
      } catch (err) {
        debugError('Binary Reader error:', err);
      }
    })();
    
    // Write some binary data to the stream
    const binaryData1 = new Uint8Array([0x48, 0x65, 0x6c, 0x6c, 0x6f]); // "Hello" in ASCII
    debugStream('Binary Writer: Writing chunk 1');
    await writer.write(binaryData1);
    
    // Wait a bit
    await new Promise(resolve => setTimeout(resolve, 1500));
    
    // Write more binary data
    const binaryData2 = new Uint8Array([0x57, 0x6f, 0x72, 0x6c, 0x64, 0x21]); // "World!" in ASCII
    debugStream('Binary Writer: Writing chunk 2');
    await writer.write(binaryData2);
    
    // Wait a bit
    await new Promise(resolve => setTimeout(resolve, 1500));
    
    // Finish the stream with a final binary chunk
    const binaryData3 = new Uint8Array([0x45, 0x6e, 0x64]); // "End" in ASCII
    debugStream('Binary Writer: Finishing stream');
    await writer.write(binaryData3, true);
    
    // Clean up
    writer[Symbol.dispose]();
    
    debugStream('Binary test completed');
  } catch (err) {
    debugError('Binary test error:', err);
  }
}

// Test error scenarios with mismatched data types
async function testErrorScenarios() {
  enableAllDebug();

  try {
    debugStream('Testing NIP-173 error scenarios...');
    
    // Create a SimplePool instance
    const pool = new SimplePool();
    
    // Generate keys
    const senderPrivkey = generateSecretKey();
    const streamId = getPublicKey(senderPrivkey);
    const recipientPrivkey = generateSecretKey();
    
    // Define relays to use
    const relays = ['wss://relay.primal.net', 'wss://relay.nostr.band'];
    
    debugStream('Scenario 1: Binary stream with string data');
    
    // Create binary stream metadata
    const binaryMetadata: StreamMetadata = {
      streamId,
      encryption: 'none',
      compression: 'none',
      binary: true, // Binary stream
      receiver_privkey: Buffer.from(recipientPrivkey).toString('hex'),
      relays,
    };
    
    // Create writers and readers
    const binaryWriter = new StreamWriter(
      binaryMetadata,
      pool,
      senderPrivkey,
      { minChunkInterval: 10 }
    );
    
    const binaryReader = new StreamReader(
      binaryMetadata,
      pool,
      { ttl: 30000 }
    );
    
    // Start reading from binary stream
    (async () => {
      debugStream('Error Test - Binary Reader: Starting to read stream...');
      try {
        for await (const chunk of binaryReader) {
          debugStream(`Error Test - Binary Reader: Received chunk of size: ${chunk.length} bytes`);
        }
      } catch (err) {
        debugError('Error Test - Binary Reader error:', err);
      }
    })();
    
    // Try to write string data to binary stream
    debugStream('Error Test - Binary Writer: Attempting to write string to binary stream');
    try {
      await binaryWriter.write('This is a string in a binary stream');
      debugStream('Error Test - Binary Writer: String write succeeded (expected to work but with type conversion)');
    } catch (err) {
      debugError('Error Test - Binary Writer error:', err);
    }
    
    // Finish the binary stream
    await binaryWriter.write(new Uint8Array([0x45, 0x6e, 0x64]), true);
    binaryWriter[Symbol.dispose]();
    
    // Wait a bit before next test
    await new Promise(resolve => setTimeout(resolve, 2000));
    
    debugStream('Scenario 2: String stream with binary data');
    
    // Create string stream metadata
    const stringMetadata: StreamMetadata = {
      streamId: getPublicKey(generateSecretKey()), // New stream ID
      encryption: 'none',
      compression: 'none',
      binary: false, // String stream (or undefined)
      receiver_privkey: Buffer.from(generateSecretKey()).toString('hex'), // New key
      relays,
    };
    
    const stringWriter = new StreamWriter(
      stringMetadata,
      pool,
      generateSecretKey(), // New sender key
      { minChunkInterval: 10 }
    );
    
    const stringReader = new StreamReader(
      stringMetadata,
      pool,
      { ttl: 30000 }
    );
    
    // Start reading from string stream
    (async () => {
      debugStream('Error Test - String Reader: Starting to read stream...');
      try {
        for await (const chunk of stringReader) {
          debugStream(`Error Test - String Reader: Received chunk: ${chunk}`);
        }
      } catch (err) {
        debugError('Error Test - String Reader error:', err);
      }
    })();
    
    // Try to write binary data to string stream
    debugStream('Error Test - String Writer: Attempting to write binary data to string stream');
    try {
      await stringWriter.write(new Uint8Array([0x48, 0x69])); // "Hi" in ASCII
      debugStream('Error Test - String Writer: Binary write succeeded (expected to work but with type conversion)');
    } catch (err) {
      debugError('Error Test - String Writer error:', err);
    }
    
    // Finish the string stream
    await stringWriter.write('End of string stream', true);
    stringWriter[Symbol.dispose]();
    
    debugStream('Error scenarios test completed');
  } catch (err) {
    debugError('Error scenarios test error:', err);
  }
}

// Run the tests
async function runAllTests() {
  try {
    // Test string stream first
    await testStringStream();
    
    // Wait a bit between tests
    await new Promise(resolve => setTimeout(resolve, 2000));
    
    // Test binary stream
    await testBinaryStream();
    
    // Wait a bit between tests
    await new Promise(resolve => setTimeout(resolve, 2000));
    
    // Test error scenarios
    await testErrorScenarios();
    
  } catch (err) {
    debugError('Test suite error:', err);
  }
}

// Run all tests
runAllTests().catch(err => debugError('Unhandled error:', err));