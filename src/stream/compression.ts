/**
 * Compression utilities for NIP-174
 * Supports both browser (using Compression Streams API) and Node.js (using zlib)
 */

import { CompressionMethod } from "../common/types.js";
import { debugCompression, debugError } from "../common/debug.js";

// Compression methods
export const COMPRESSION_NONE = "none";
export const COMPRESSION_GZIP = "gzip";

// Check if we're in a browser environment with Compression Streams API
const isBrowser =
  typeof window !== "undefined" &&
  typeof window.CompressionStream !== "undefined";

// Define Node.js specific functions that will be replaced with actual implementations
// only when running in Node.js environment
let nodeGzipCompress: ((data: Uint8Array) => Promise<Uint8Array>) | null = null;
let nodeGzipDecompress: ((data: Uint8Array) => Promise<Uint8Array>) | null =
  null;
let nodeCreateGzip: (() => any) | null = null;
let nodeCreateGunzip: (() => any) | null = null;

// Track initialization status
let nodeInitialized = false;
let nodeInitPromise: Promise<void> | null = null;

// Only initialize Node.js functions if not in browser
// This code is isolated in a way that esbuild can eliminate it when targeting browser
if (!isBrowser) {
  // We're using a function that will be called only at runtime in Node.js
  // This prevents esbuild from trying to resolve the imports during bundling
  const initNodeFunctions = async () => {
    if (nodeInitialized) return;

    try {
      // Dynamic imports that will only be executed at runtime in Node.js
      const zlibModule = await import("zlib");
      const utilModule = await import("util");

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

      // Add streaming functions
      nodeCreateGzip = () => zlibModule.createGzip();
      nodeCreateGunzip = () => zlibModule.createGunzip();

      nodeInitialized = true;
    } catch (error) {
      debugError("Failed to initialize Node.js compression functions:", error);
      throw error;
    }
  };

  // Initialize Node.js functions and store the promise
  nodeInitPromise = initNodeFunctions();
}

/**
 * Ensures that Node.js compression functions are initialized
 * @returns Promise that resolves when initialization is complete
 */
async function ensureNodeInitialized(): Promise<void> {
  if (isBrowser || nodeInitialized) return;
  if (nodeInitPromise) await nodeInitPromise;
}

/**
 * Calculate the base64 encoded size of a binary data
 * @param binarySize Size of binary data in bytes
 * @returns Size of base64 encoded data in bytes
 */
function calculateBase64Size(binarySize: number): number {
  // Base64 encoding increases size by approximately 4/3
  // and may add padding characters
  return Math.ceil((binarySize * 4) / 3);
}

/**
 * Error thrown when compression or decompression result exceeds the maximum allowed size
 */
export class CompressionSizeLimitExceeded extends Error {
  constructor(currentSize: number, maxSize: number) {
    super(
      `Compression result size (${currentSize} bytes) exceeds the maximum allowed size (${maxSize} bytes)`
    );
    this.name = "CompressionSizeLimitExceeded";
  }
}

/**
 * Interface for streaming compression/decompression instance
 */
export interface CompressionInstance {
  /**
   * Adds a chunk to the compression/decompression stream
   * For gzip decompression, the input is expected to be base64 encoded
   *
   * @param chunk - The chunk to process (string or Uint8Array)
   * @returns Promise resolving to the current size of the accumulated result
   * @throws CompressionSizeLimitExceeded if the result would exceed the maximum size limit
   */
  add(chunk: string | Uint8Array): Promise<number>;

  /**
   * Finishes the compression/decompression stream and returns the result
   *
   * @returns Promise resolving to the final result as string
   *          For gzip compression, the result is base64 encoded
   */
  finish(): Promise<string>;

  /**
   * Disposes of resources used by the compression/decompression stream
   */
  [Symbol.dispose](): void;
}

/**
 * Compression interface for NIP-174
 * Defines methods for compressing and decompressing data
 * Can be implemented to support custom compression methods
 */
export interface Compression {
  /**
   * Starts a streaming compression process
   *
   * @param method - The compression method
   * @param maxResultSize - Optional maximum size (in bytes) for the compressed result string.
   *                        Note: The finish() method might produce additional data that exceeds this limit.
   *                        It's recommended to add a margin of 1KB to your actual limit to accommodate this.
   * @returns A CompressionInstance for handling the stream
   */
  startCompress(
    method: CompressionMethod,
    maxResultSize?: number
  ): Promise<CompressionInstance>;

  /**
   * Starts a streaming decompression process
   * For gzip, the input chunks are expected to be base64 encoded
   *
   * @param method - The compression method
   * @param maxResultSize - Optional maximum size (in bytes) for the decompressed result string.
   *                        Note: The finish() method might produce additional data that exceeds this limit.
   *                        It's recommended to add a margin of 1KB to your actual limit to accommodate this.
   * @returns A CompressionInstance for handling the stream
   */
  startDecompress(
    method: CompressionMethod,
    maxResultSize?: number
  ): Promise<CompressionInstance>;

  /**
   * Compresses data using the specified compression method
   *
   * @param data - The data to compress as string
   * @param method - The compression method
   * @returns Promise resolving to compressed data as string
   */
  compress(data: string, method: CompressionMethod): Promise<string>;

  /**
   * Decompresses data using the specified compression method
   *
   * @param data - The compressed data as string
   * @param method - The compression method
   * @returns Promise resolving to decompressed data as string
   */
  decompress(data: string, method: CompressionMethod): Promise<string>;

  /**
   * Returns a list of supported compression methods
   *
   * @returns Array of supported compression method names
   */
  list(): string[];
}

/**
 * Browser implementation of CompressionInstance using Compression Streams API
 */
class BrowserCompressionInstance implements CompressionInstance {
  private writer: WritableStreamDefaultWriter<Uint8Array>;
  private reader: ReadableStreamDefaultReader<Uint8Array>;
  private output: Uint8Array[] = [];
  private totalSize: number = 0;
  private maxResultSize?: number;
  private method: CompressionMethod;
  private isDecompressing: boolean;

  constructor(
    stream: CompressionStream | DecompressionStream,
    method: CompressionMethod,
    isDecompressing: boolean,
    maxResultSize?: number
  ) {
    this.writer = stream.writable.getWriter();
    this.reader = stream.readable.getReader();
    this.maxResultSize = maxResultSize;
    this.method = method;
    this.isDecompressing = isDecompressing;
  }

  async add(chunk: string | Uint8Array): Promise<number> {
    // Convert string to Uint8Array if needed
    let inputData: Uint8Array;

    if (typeof chunk === "string") {
      // For gzip decompression, decode base64 first
      if (this.method === "gzip" && this.isDecompressing) {
        inputData = Buffer.from(chunk, "base64");
      } else {
        inputData = new TextEncoder().encode(chunk);
      }
    } else {
      inputData = chunk;
    }

    await this.writer.write(inputData);

    // Read any available output
    const newChunks: Uint8Array[] = [];
    let newSize = 0;

    while (true) {
      const { value, done } = await this.reader.read();
      if (done) break;
      if (value) {
        newChunks.push(value);
        newSize += value.length;
      }
    }

    // Calculate the final size after potential base64 encoding
    const potentialTotalSize = this.totalSize + newSize;
    const finalSize =
      this.method === "gzip" && !this.isDecompressing
        ? calculateBase64Size(potentialTotalSize)
        : potentialTotalSize;

    // Check if adding these chunks would exceed the size limit
    if (this.maxResultSize !== undefined && finalSize > this.maxResultSize) {
      throw new CompressionSizeLimitExceeded(finalSize, this.maxResultSize);
    }

    // If we're here, it's safe to add the chunks
    this.output.push(...newChunks);
    this.totalSize += newSize;

    return finalSize;
  }

  async finish(): Promise<string> {
    await this.writer.close();

    // Read any remaining output
    while (true) {
      const { value, done } = await this.reader.read();
      if (done) break;
      if (value) {
        this.output.push(value);
        this.totalSize += value.length;
      }
    }

    // Concatenate all chunks
    const result = new Uint8Array(this.totalSize);
    let offset = 0;

    for (const chunk of this.output) {
      result.set(chunk, offset);
      offset += chunk.length;
    }

    // Convert to string based on method
    if (this.method === "gzip" && !this.isDecompressing) {
      return Buffer.from(result).toString("base64");
    } else {
      return new TextDecoder().decode(result);
    }
  }

  [Symbol.dispose](): void {
    // Release resources
    this.writer.releaseLock();
    this.reader.releaseLock();
    this.output = [];
  }
}

/**
 * Node.js implementation of CompressionInstance using zlib
 */
class NodeCompressionInstance implements CompressionInstance {
  private stream: any;
  private chunks: Uint8Array[] = [];
  private totalSize: number = 0;
  private streamFinished: boolean = false;
  private maxResultSize?: number;
  private method: CompressionMethod;
  private isDecompressing: boolean;
  private pendingResolvers: Array<(value: number) => void> = [];
  private pendingRejecters: Array<(reason: any) => void> = [];

  constructor(
    stream: any,
    method: CompressionMethod,
    isDecompressing: boolean,
    maxResultSize?: number
  ) {
    this.stream = stream;
    this.maxResultSize = maxResultSize;
    this.method = method;
    this.isDecompressing = isDecompressing;

    // Set up data handling
    this.stream.on("data", (chunk: Buffer) => {
      const data = new Uint8Array(chunk);

      // Calculate the final size after potential base64 encoding
      const potentialTotalSize = this.totalSize + data.length;
      const finalSize =
        this.method === "gzip" && !this.isDecompressing
          ? calculateBase64Size(potentialTotalSize)
          : potentialTotalSize;

      // Check if adding this chunk would exceed the size limit
      if (this.maxResultSize !== undefined && finalSize > this.maxResultSize) {
        const error = new CompressionSizeLimitExceeded(
          finalSize,
          this.maxResultSize
        );

        // Reject any pending promises
        for (const reject of this.pendingRejecters) {
          reject(error);
        }
        this.pendingResolvers = [];
        this.pendingRejecters = [];

        // End the stream to prevent further processing
        this.stream.end();
        return;
      }

      this.chunks.push(data);
      this.totalSize += data.length;

      // Resolve any pending promises with the final size
      for (const resolve of this.pendingResolvers) {
        resolve(finalSize);
      }
      this.pendingResolvers = [];
      this.pendingRejecters = [];
    });

    // Set up end handling
    this.stream.on("end", () => {
      this.streamFinished = true;

      // Resolve any pending promises
      for (const resolve of this.pendingResolvers) {
        const finalSize =
          this.method === "gzip" && !this.isDecompressing
            ? calculateBase64Size(this.totalSize)
            : this.totalSize;
        resolve(finalSize);
      }
      this.pendingResolvers = [];
      this.pendingRejecters = [];
    });

    // Set up error handling
    this.stream.on("error", (err: Error) => {
      // Reject any pending promises
      for (const reject of this.pendingRejecters) {
        reject(err);
      }
      this.pendingResolvers = [];
      this.pendingRejecters = [];
    });
  }

  async add(chunk: string | Uint8Array): Promise<number> {
    return new Promise<number>((resolve, reject) => {
      // Convert string to Uint8Array if needed
      let inputData: Uint8Array;

      if (typeof chunk === "string") {
        // For gzip decompression, decode base64 first
        if (this.method === "gzip" && this.isDecompressing) {
          inputData = Buffer.from(chunk, "base64");
        } else {
          inputData = new TextEncoder().encode(chunk);
        }
      } else {
        inputData = chunk;
      }

      // Store the resolvers and rejecters for later use
      this.pendingResolvers.push(resolve);
      this.pendingRejecters.push(reject);

      // Write data to the stream
      this.stream.write(Buffer.from(inputData));
    });
  }

  async finish(): Promise<string> {
    return new Promise<string>((resolve, reject) => {
      if (this.streamFinished) {
        // Stream already finished, return concatenated chunks
        const result = this.concatenateChunks();
        resolve(this.convertToString(result));
      } else {
        // End the stream and wait for the 'end' event
        this.stream.end();

        this.stream.on("end", () => {
          const result = this.concatenateChunks();
          resolve(this.convertToString(result));
        });

        this.stream.on("error", (err: Error) => {
          reject(err);
        });
      }
    });
  }

  private concatenateChunks(): Uint8Array {
    const result = new Uint8Array(this.totalSize);
    let offset = 0;

    for (const chunk of this.chunks) {
      result.set(chunk, offset);
      offset += chunk.length;
    }

    return result;
  }

  private convertToString(data: Uint8Array): string {
    if (this.method === "gzip" && !this.isDecompressing) {
      return Buffer.from(data).toString("base64");
    } else {
      return new TextDecoder().decode(data);
    }
  }

  [Symbol.dispose](): void {
    // Release resources
    if (!this.streamFinished) {
      this.stream.end();
    }
    this.chunks = [];
    this.pendingResolvers = [];
    this.pendingRejecters = [];
  }
}

/**
 * Plain text implementation of CompressionInstance (no compression)
 */
class PlainCompressionInstance implements CompressionInstance {
  private chunks: Uint8Array[] = [];
  private totalSize: number = 0;
  private maxResultSize?: number;

  constructor(maxResultSize?: number) {
    this.maxResultSize = maxResultSize;
  }

  async add(chunk: string | Uint8Array): Promise<number> {
    // Convert string to Uint8Array if needed
    const inputData =
      typeof chunk === "string" ? new TextEncoder().encode(chunk) : chunk;

    // Check if adding this chunk would exceed the size limit
    if (
      this.maxResultSize !== undefined &&
      this.totalSize + inputData.length > this.maxResultSize
    ) {
      throw new CompressionSizeLimitExceeded(
        this.totalSize + inputData.length,
        this.maxResultSize
      );
    }

    this.chunks.push(inputData);
    this.totalSize += inputData.length;
    return this.totalSize;
  }

  async finish(): Promise<string> {
    // Concatenate all chunks
    const result = new Uint8Array(this.totalSize);
    let offset = 0;

    for (const chunk of this.chunks) {
      result.set(chunk, offset);
      offset += chunk.length;
    }

    // Convert to string
    return new TextDecoder().decode(result);
  }

  [Symbol.dispose](): void {
    // Release resources
    this.chunks = [];
  }
}

/**
 * Default implementation of the Compression interface
 * Provides built-in support for 'none', 'base64' and 'gzip' compression methods
 */
export class DefaultCompression implements Compression {
  /**
   * Starts a streaming compression process
   *
   * @param method - The compression method
   * @param maxResultSize - Optional maximum size (in bytes) for the compressed result string.
   *                        Note: The finish() method might produce additional data that exceeds this limit.
   *                        It's recommended to add a margin of 1KB to your actual limit to accommodate this.
   * @returns A CompressionInstance for handling the stream
   */
  async startCompress(
    method: CompressionMethod,
    maxResultSize?: number
  ): Promise<CompressionInstance> {
    // Ensure Node.js functions are initialized if needed
    await ensureNodeInitialized();

    if (method === COMPRESSION_NONE) {
      return new PlainCompressionInstance(maxResultSize);
    } else if (method === COMPRESSION_GZIP) {
      if (isBrowser) {
        return new BrowserCompressionInstance(
          new CompressionStream("gzip"),
          method,
          false,
          maxResultSize
        );
      } else {
        if (nodeCreateGzip === null) {
          throw new Error("Node.js compression functions not initialized");
        }
        return new NodeCompressionInstance(
          nodeCreateGzip(),
          method,
          false,
          maxResultSize
        );
      }
    } else {
      throw new Error(`Unsupported compression method: ${method}`);
    }
  }

  /**
   * Starts a streaming decompression process
   * For gzip, the input chunks are expected to be base64 encoded
   *
   * @param method - The compression method
   * @param maxResultSize - Optional maximum size (in bytes) for the decompressed result string.
   *                        Note: The finish() method might produce additional data that exceeds this limit.
   *                        It's recommended to add a margin of 1KB to your actual limit to accommodate this.
   * @returns A CompressionInstance for handling the stream
   */
  async startDecompress(
    method: CompressionMethod,
    maxResultSize?: number
  ): Promise<CompressionInstance> {
    // Ensure Node.js functions are initialized if needed
    await ensureNodeInitialized();

    if (method === COMPRESSION_NONE) {
      return new PlainCompressionInstance(maxResultSize);
    } else if (method === COMPRESSION_GZIP) {
      if (isBrowser) {
        return new BrowserCompressionInstance(
          new DecompressionStream("gzip"),
          method,
          true,
          maxResultSize
        );
      } else {
        if (nodeCreateGunzip === null) {
          throw new Error("Node.js decompression functions not initialized");
        }
        return new NodeCompressionInstance(
          nodeCreateGunzip(),
          method,
          true,
          maxResultSize
        );
      }
    } else {
      throw new Error(`Unsupported compression method: ${method}`);
    }
  }

  /**
   * Compresses data using the specified compression method
   *
   * @param data - The data to compress as string
   * @param method - The compression method
   * @returns Promise resolving to compressed data as string
   */
  async compress(data: string, method: CompressionMethod): Promise<string> {
    // Use the streaming API
    const compressor = await this.startCompress(method);
    try {
      await compressor.add(data);
      const compressed = await compressor.finish();
      debugCompression(
        `Compressed ${data.length} chars to ${compressed.length} bytes`
      );
      return compressed;
    } finally {
      compressor[Symbol.dispose]();
    }
  }

  /**
   * Returns a list of supported compression methods
   *
   * @returns Array of supported compression method names
   */
  list(): string[] {
    return [COMPRESSION_NONE, COMPRESSION_GZIP];
  }

  /**
   * Decompresses data using the specified compression method
   *
   * @param data - The compressed data as string
   * @param method - The compression method
   * @returns Promise resolving to decompressed data as string
   */
  async decompress(data: string, method: CompressionMethod): Promise<string> {
    // Use the streaming API
    const decompressor = await this.startDecompress(method);
    try {
      // For gzip, the input is base64 encoded and will be decoded in add()
      await decompressor.add(data);
      const decompressed = await decompressor.finish();
      return decompressed;
    } finally {
      decompressor[Symbol.dispose]();
    }
  }
}

let compression: DefaultCompression;
export function getCompression() {
  if (!compression) compression = new DefaultCompression();
  return compression;
}
