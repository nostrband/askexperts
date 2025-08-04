/**
 * Tests for the compression utilities
 * Tests compression size limit exceeded error handling
 */

import {
  DefaultCompression,
  CompressionSizeLimitExceeded,
} from "../src/stream/compression.js";
import assert from "assert";
import { CompressionMethod } from "../src/stream/types.js";
import { enableAllDebug } from "../src/index.js";

// Helper function to create a string of a specific size
function createStringOfSize(sizeInBytes: number): string {
  return "A".repeat(sizeInBytes);
}

async function testCompressionSizeLimitExceeded() {
  console.log("Testing compression size limit exceeded error handling...");

  const compression = new DefaultCompression();
  const methods: CompressionMethod[] = ["none", "gzip"];

  for (const method of methods) {
    console.log(`Testing method: ${method}`);

    // Set a max result size that accounts for the internal adjustment
    // The implementation uses Math.max(64, maxResultSize - 1024) internally
    // So we need to add 1024 to our desired effective limit
    const packetSize = 2048; 
    const maxResultSize = packetSize * 2 + 1024 - 1; // -1 to trigger the limit
    console.log(`Creating compressor with configured max size: ${maxResultSize} bytes (packet: ${packetSize} bytes)`);

    // Create the compressor with the size limit
    const compressor = await compression.startCompress(
      method,
      false,
      maxResultSize
    );

    try {
      // Create first packet that's below the effective limit
      // For gzip, we need to account for compression overhead
      const firstPacketSize = method === "gzip" ? packetSize : packetSize * 2;
      const firstPacket = createStringOfSize(firstPacketSize);
      console.log(`Adding first packet of size: ${firstPacket.length} bytes`);
      
      // Add the first packet - this should succeed
      const sizeAfterFirstPacket = await compressor.add(firstPacket);
      console.log(`First packet added, current size: ${sizeAfterFirstPacket} bytes`);

      // Create second packet that will exceed the limit when added
      // For gzip, we need a larger packet to ensure it exceeds the limit after compression
      const secondPacketSize = packetSize;
      const secondPacket = createStringOfSize(secondPacketSize);
      console.log(`Adding second packet of size: ${secondPacket.length} bytes`);
      
      try {
        // Try to add the second packet - this should fail with CompressionSizeLimitExceeded
        await compressor.add(secondPacket);
        
        // If we get here, it's an error - the second packet should have been rejected
        throw new Error(`Second packet should have been rejected for ${method} compression`);
      } catch (error) {
        // Verify that we got the expected error
        if (!(error instanceof CompressionSizeLimitExceeded)) {
          throw new Error(`Expected CompressionSizeLimitExceeded but got: ${error}`);
        }
        
        console.log(`Successfully caught size limit error: ${error.message}`);
        
        // Now call finish() to get the archive with only the first packet
        const compressedData = await compressor.finish();
        
        if (typeof compressedData === "string") {
          console.log(`Compressed data size: ${compressedData.length} bytes (string)`);
        } else {
          console.log(`Compressed data size: ${compressedData.byteLength} bytes (binary)`);
        }
        
        // Now decompress the data and verify it matches the first packet
        const decompressor = await compression.startDecompress(method);
        await decompressor.add(compressedData);
        const decompressedData = await decompressor.finish();
        
        // Convert to string if it's not already
        const decompressedString =
          typeof decompressedData === "string"
            ? decompressedData
            : new TextDecoder().decode(decompressedData);
        
        // Verify the result matches the first packet
        assert.strictEqual(
          decompressedString,
          firstPacket,
          `Decompressed data should match first packet for ${method}`
        );
        
        console.log(`Successfully verified ${method} compression/decompression with size limit`);
        
        // Clean up resources
        decompressor[Symbol.dispose]();
      }
    } finally {
      // Clean up resources
      compressor[Symbol.dispose]();
    }
  }

  console.log("Compression size limit exceeded test passed!");
}

async function runTests() {
  try {
    enableAllDebug();
    
    // Set up global error handlers
    process.on("uncaughtException", (err) => {
      console.error("Uncaught Exception:", err);
    });
    
    process.on("unhandledRejection", (reason, promise) => {
      console.error("Unhandled Rejection at:", promise, "reason:", reason);
    });

    console.log("Starting compression size limit exceeded test...");
    await testCompressionSizeLimitExceeded();
    console.log("Compression size limit exceeded test completed successfully");
    
    console.log("All tests passed!");
  } catch (error) {
    console.error("Test failed:", error);
    process.exit(1);
  }
}

runTests();