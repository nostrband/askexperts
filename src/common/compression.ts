/**
 * Compression utilities for NIP-174
 * Supports both browser (using Compression Streams API) and Node.js (using zlib)
 */

import { CompressionMethod } from '../client/types.js';

// Check if we're in a browser environment with Compression Streams API
const isBrowser = typeof window !== 'undefined' && typeof window.CompressionStream !== 'undefined';

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
    // Node.js implementation using zlib
    const zlib = await import('zlib');
    const util = await import('util');
    const gzipPromise = util.promisify(zlib.gzip);
    return await gzipPromise(inputData);
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
    // Node.js implementation using zlib
    const zlib = await import('zlib');
    const util = await import('util');
    const gunzipPromise = util.promisify(zlib.gunzip);
    return await gunzipPromise(data);
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
