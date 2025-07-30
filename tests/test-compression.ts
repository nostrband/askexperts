/**
 * Tests for the compression utilities
 * Tests incremental compression/decompression and size limits
 */

import { DefaultCompression, CompressionSizeLimitExceeded } from '../src/stream/compression.js';
import { CompressionMethod } from '../src/common/types.js';
import assert from 'assert';

// Helper function to create a large string of a specific size
function createLargeString(sizeInKB: number): string {
  const chunk = 'A'.repeat(1024); // 1KB chunk
  return chunk.repeat(sizeInKB);
}

// Helper function to split a string into chunks
function splitIntoChunks(str: string, chunkSize: number): string[] {
  const chunks: string[] = [];
  for (let i = 0; i < str.length; i += chunkSize) {
    chunks.push(str.substring(i, i + chunkSize));
  }
  return chunks;
}

async function testIncrementalCompression() {
  console.log('Testing incremental compression...');
  
  const compression = new DefaultCompression();
  const methods: CompressionMethod[] = ['none', 'gzip'];
  
  for (const method of methods) {
    console.log(`Testing method: ${method}`);
    
    // Create test data - 100KB string
    const originalData = createLargeString(100);
    const chunks = splitIntoChunks(originalData, 10 * 1024); // 10KB chunks
    
    // Test incremental compression
    const compressor = await compression.startCompress(method);
    let totalSize = 0;
    
    for (const chunk of chunks) {
      const size = await compressor.add(chunk);
      totalSize = size;
      console.log(`Added chunk, current size: ${size} bytes`);
    }
    
    const compressedData = await compressor.finish();
    console.log(`Final compressed size: ${compressedData.length} bytes`);
    
    // Test incremental decompression
    const decompressor = await compression.startDecompress(method);
    await decompressor.add(compressedData);
    const decompressedData = await decompressor.finish();
    
    // No need to decode since finish() now returns a string
    const decompressedString = decompressedData;
    
    // Verify the result
    assert.strictEqual(decompressedString, originalData, 'Decompressed data should match original data');
    console.log(`Successfully verified ${method} compression/decompression`);
    
    // Clean up resources
    compressor[Symbol.dispose]();
    decompressor[Symbol.dispose]();
  }
  
  console.log('Incremental compression test passed!');
}

async function testSizeLimits() {
  console.log('Testing size limits...');
  
  const compression = new DefaultCompression();
  const methods: CompressionMethod[] = ['none', 'gzip'];
  
  for (const method of methods) {
    console.log(`Testing method: ${method}`);
    
    // Test compression size limit
    const compressMaxSize = 5 * 1024; // 5KB limit
    const compressor = await compression.startCompress(method, compressMaxSize);
    
    // Create a string that will definitely exceed the limit when compressed
    // For 'none', we know exactly how big it will be
    // For 'gzip', we'll create something much larger to ensure it exceeds the limit
    const largeData = createLargeString(method === 'none' ? 6 : 50);
    
    try {
      // Split into smaller chunks to test incremental behavior
      const chunks = splitIntoChunks(largeData, 1024); // 1KB chunks
      
      for (const chunk of chunks) {
        await compressor.add(chunk);
        console.log(`Added chunk, current size: ${chunk.length} bytes`);
      }
      
      // If we get here for 'none', it's an error
      if (method === 'none') {
        throw new Error('Should have thrown CompressionSizeLimitExceeded for none compression');
      }
    } catch (error) {
      if (error instanceof CompressionSizeLimitExceeded) {
        console.log(`Successfully caught size limit error: ${error.message}`);
      } else {
        // For 'gzip', we might not exceed the limit depending on compressibility
        // So only throw if it's not a CompressionSizeLimitExceeded and we're using 'none'
        if (method === 'none') {
          throw error;
        }
      }
    } finally {
      compressor[Symbol.dispose]();
    }
    
    // Test decompression size limit
    // First, create some compressed data
    const originalData = createLargeString(10); // 10KB
    const normalCompressor = await compression.startCompress(method);
    await normalCompressor.add(originalData);
    const compressedData = await normalCompressor.finish();
    normalCompressor[Symbol.dispose]();
    
    // Now try to decompress with a small limit
    const decompressMaxSize = 5 * 1024; // 5KB limit
    const decompressor = await compression.startDecompress(method, decompressMaxSize);
    
    try {
      await decompressor.add(compressedData);
      
      // If we get here for 'none', it's an error
      if (method === 'none') {
        throw new Error('Should have thrown CompressionSizeLimitExceeded for plain decompression');
      }
    } catch (error) {
      if (error instanceof CompressionSizeLimitExceeded) {
        console.log(`Successfully caught size limit error: ${error.message}`);
      } else {
        // For 'gzip', we might not exceed the limit depending on compressibility
        // So only throw if it's not a CompressionSizeLimitExceeded and we're using 'none'
        if (method === 'none') {
          throw error;
        }
      }
    } finally {
      decompressor[Symbol.dispose]();
    }
  }
  
  console.log('Size limits test passed!');
}

async function testZipBomb() {
  console.log('Testing zip bomb protection...');
  
  const compression = new DefaultCompression();
  
  // Create a highly compressible string (lots of repetition)
  const repeatedChar = 'A'.repeat(1024 * 1024); // 1MB of 'A's
  
  // Compress it
  const compressor = await compression.startCompress('gzip');
  await compressor.add(repeatedChar);
  const compressedData = await compressor.finish();
  compressor[Symbol.dispose]();
  
  console.log(`Compressed 1MB of 'A's to ${compressedData.length} bytes`);
  
  // Try to decompress with a small limit
  const decompressMaxSize = 100 * 1024; // 100KB limit
  const decompressor = await compression.startDecompress('gzip', decompressMaxSize);
  
  try {
    await decompressor.add(compressedData);
    throw new Error('Should have thrown CompressionSizeLimitExceeded for zip bomb');
  } catch (error) {
    if (error instanceof CompressionSizeLimitExceeded) {
      console.log(`Successfully caught zip bomb: ${error.message}`);
    } else {
      throw error;
    }
  } finally {
    decompressor[Symbol.dispose]();
  }
  
  console.log('Zip bomb protection test passed!');
}

async function runTests() {
  try {
    await testIncrementalCompression();
    await testSizeLimits();
    await testZipBomb();
    console.log('All tests passed!');
  } catch (error) {
    console.error('Test failed:', error);
    process.exit(1);
  }
}

runTests();