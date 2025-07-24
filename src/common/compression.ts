/**
 * Compression utilities for NIP-174
 * Supports both browser (using Compression Streams API) and Node.js (using zlib)
 */

import { CompressionMethod } from './types.js';
import { debugError } from './debug.js';

// Check if we're in a browser environment with Compression Streams API
const isBrowser = typeof window !== 'undefined' && typeof window.CompressionStream !== 'undefined';

// Define Node.js specific functions that will be replaced with actual implementations
// only when running in Node.js environment
let nodeGzipCompress: ((data: Uint8Array) => Promise<Uint8Array>) | null = null;
let nodeGzipDecompress: ((data: Uint8Array) => Promise<Uint8Array>) | null = null;

// Only initialize Node.js functions if not in browser
// This code is isolated in a way that esbuild can eliminate it when targeting browser
if (!isBrowser) {
  // We're using a function that will be called only at runtime in Node.js
  // This prevents esbuild from trying to resolve the imports during bundling
  const initNodeFunctions = async () => {
    try {
      // Dynamic imports that will only be executed at runtime in Node.js
      const zlibModule = await import('zlib');
      const utilModule = await import('util');
      
      // Create promisified versions of zlib functions
      const gzipPromise = utilModule.promisify(zlibModule.gzip);
      const gunzipPromise = utilModule.promisify(zlibModule.gunzip);
      
      // Assign the implementations
      nodeGzipCompress = async (data: Uint8Array): Promise<Uint8Array> => {
        return await gzipPromise(data);
      };
      
      nodeGzipDecompress = async (data: Uint8Array): Promise<Uint8Array> => {
        return await gunzipPromise(data);
      };
    } catch (error) {
      debugError('Failed to initialize Node.js compression functions:', error);
    }
  };
  
  // Initialize Node.js functions
  initNodeFunctions();
}

/**
 * Compresses data using gzip
 *
 * @param data - The data to compress (string or Uint8Array)
 * @returns Promise resolving to compressed data as Uint8Array
 */
async function gzipCompress(data: string | Uint8Array): Promise<Uint8Array> {
  // Convert string to Uint8Array if needed
  const inputData = typeof data === 'string'
    ? new TextEncoder().encode(data)
    : data;

  if (isBrowser) {
    // Browser implementation using Compression Streams API
    const cs = new CompressionStream('gzip');
    const writer = cs.writable.getWriter();
    writer.write(inputData);
    writer.close();
    
    const output = [];
    const reader = cs.readable.getReader();
    
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      output.push(value);
    }
    
    // Concatenate all chunks
    const totalLength = output.reduce((acc, val) => acc + val.length, 0);
    const result = new Uint8Array(totalLength);
    let offset = 0;
    
    for (const chunk of output) {
      result.set(chunk, offset);
      offset += chunk.length;
    }
    
    return result;
  } else {
    // Node.js implementation
    if (nodeGzipCompress === null) {
      throw new Error('Node.js compression functions not initialized');
    }
    return await nodeGzipCompress(inputData);
  }
}

/**
 * Decompresses gzipped data
 *
 * @param data - The compressed data as Uint8Array
 * @returns Promise resolving to decompressed data as Uint8Array
 */
async function gzipDecompress(data: Uint8Array): Promise<Uint8Array> {
  if (isBrowser) {
    // Browser implementation using Compression Streams API
    const ds = new DecompressionStream('gzip');
    const writer = ds.writable.getWriter();
    writer.write(data);
    writer.close();
    
    const output = [];
    const reader = ds.readable.getReader();
    
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      output.push(value);
    }
    
    // Concatenate all chunks
    const totalLength = output.reduce((acc, val) => acc + val.length, 0);
    const result = new Uint8Array(totalLength);
    let offset = 0;
    
    for (const chunk of output) {
      result.set(chunk, offset);
      offset += chunk.length;
    }
    
    return result;
  } else {
    // Node.js implementation
    if (nodeGzipDecompress === null) {
      throw new Error('Node.js decompression functions not initialized');
    }
    return await nodeGzipDecompress(data);
  }
}

/**
 * Compression interface for NIP-174
 * Defines methods for compressing and decompressing data
 * Can be implemented to support custom compression methods
 */
export interface Compression {
  /**
   * Compresses data using the specified compression method
   * For gzip, the data is compressed and then base64 encoded
   *
   * @param data - The data to compress as string
   * @param method - The compression method
   * @returns Promise resolving to compressed data as string
   */
  compress(
    data: string,
    method: CompressionMethod
  ): Promise<string>;

  /**
   * Decompresses data using the specified compression method
   * For gzip, the data is base64 decoded and then decompressed
   *
   * @param data - The compressed data as string
   * @param method - The compression method
   * @returns Promise resolving to decompressed data as string
   */
  decompress(
    data: string,
    method: CompressionMethod
  ): Promise<string>;
  
  /**
   * Returns a list of supported compression methods
   *
   * @returns Array of supported compression method names
   */
  list(): string[];
}

/**
 * Default implementation of the Compression interface
 * Provides built-in support for 'plain' and 'gzip' compression methods
 */
export class DefaultCompression implements Compression {
  /**
   * Compresses data using the specified compression method
   * For gzip, the data is compressed and then base64 encoded
   *
   * @param data - The data to compress as string
   * @param method - The compression method
   * @returns Promise resolving to compressed data as string
   */
  async compress(
    data: string,
    method: CompressionMethod
  ): Promise<string> {
    if (method === 'plain') {
      return data;
    } else if (method === 'gzip') {
      const binaryData = new TextEncoder().encode(data);
      const compressed = await gzipCompress(binaryData);
      return Buffer.from(compressed).toString('base64');
    } else {
      throw new Error(`Unsupported compression method: ${method}`);
    }
  }
  
  /**
   * Returns a list of supported compression methods
   *
   * @returns Array of supported compression method names
   */
  list(): string[] {
    return ['plain', 'gzip'];
  }

  /**
   * Decompresses data using the specified compression method
   * For gzip, the data is base64 decoded and then decompressed
   *
   * @param data - The compressed data as string
   * @param method - The compression method
   * @returns Promise resolving to decompressed data as string
   */
  async decompress(
    data: string,
    method: CompressionMethod
  ): Promise<string> {
    if (method === 'plain') {
      return data;
    } else if (method === 'gzip') {
      const binaryData = Buffer.from(data, 'base64');
      const decompressed = await gzipDecompress(binaryData);
      return new TextDecoder().decode(decompressed);
    } else {
      throw new Error(`Unsupported compression method: ${method}`);
    }
  }
}
