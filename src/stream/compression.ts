/**
 * Compression utilities for NIP-174
 * Supports both browser (using Compression Streams API) and Node.js (using zlib)
 */

import { debugCompression, debugError } from "../common/debug.js";
import { CompressionMethod } from "./types.js";

// Compression methods
export const COMPRESSION_NONE = "none";
export const COMPRESSION_GZIP = "gzip";

// Check if we're in a browser environment with Compression Streams API
const isBrowser = typeof window !== "undefined";

// Define Node.js specific functions that will be replaced with actual implementations
// only when running in Node.js environment
let nodeCreateGzip: (() => any) | null = null;
let nodeCreateGunzip: (() => any) | null = null;
let nodeFlushGzip: ((stream: any) => Promise<void>) | null = null;

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

      // Add streaming functions
      nodeCreateGzip = () => zlibModule.createGzip();
      nodeCreateGunzip = () => zlibModule.createGunzip();
      nodeFlushGzip = async (stream: any) => {
        return new Promise<void>((ok) =>
          stream.flush(zlibModule.constants.Z_SYNC_FLUSH, ok)
        );
      };

      nodeInitialized = true;
      debugCompression(`Node gzip compression initialized`);
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
 * Interface for creating compression or decompression streams
 */
export interface BrowserCompressionStreamFactory {
  /**
   * Creates a new compression or decompression stream
   *
   * @returns A new CompressionStream or DecompressionStream
   */
  createStream(): CompressionStream | DecompressionStream;
}

/**
 * Interface for streaming compression instance
 */
export interface CompressionInstance {
  /**
   * Max packet size allowed to be passed to 'add' to
   * ensure maxResultSize limit
   */
  maxChunkSize(): Promise<number | undefined>;

  /**
   * Adds a chunk to the compression stream
   *
   * NOTE: if CompressionSizeLimitExceeded is thrown, this chunk wasn't
   * compressed but you can still call 'finish()' to get the buffered
   * results and send the packet. This chunk can then be compressed
   * into a new archive.
   *
   * @param chunk - The chunk to process (string or Uint8Array)
   * @returns Promise resolving to the current size of the accumulated result
   * @throws CompressionSizeLimitExceeded if the result would exceed the maximum size limit
   */
  add(chunk: string | Uint8Array): Promise<number>;

  /**
   * Finishes the compression stream and returns the result
   *
   * @returns Promise resolving to the final result as string or Uint8Array
   */
  finish(): Promise<string | Uint8Array>;

  /**
   * Disposes of resources used by the compression stream
   */
  [Symbol.dispose](): void;
}

/**
 * Interface for streaming decompression instance
 */
export interface DecompressionInstance {
  /**
   * Adds a chunk to the decompression stream
   *
   * NOTE: if CompressionSizeLimitExceeded is thrown, then these
   * buffered results aren't usable, and it's assumed client will reject
   * the whole archive, finish() will throw the same error in this case.
   *
   * @param chunk - The chunk to process as string or Uint8Array
   * @returns Promise resolving to the current size of the accumulated result
   * @throws CompressionSizeLimitExceeded if the result would exceed the maximum size limit
   * @throws Error if input type doesn't match binary flag (string for non-binary, Uint8Array for binary)
   */
  add(chunk: string | Uint8Array): Promise<number>;

  /**
   * Finishes the decompression stream and returns the result, see notes in 'add' on
   * exceptional behavior.
   *
   * @returns Promise resolving to the final result as string or Uint8Array (if binary mode)
   * @throws CompressionSizeLimitExceeded if the result would exceed the maximum size limit
   */
  finish(): Promise<string | Uint8Array>;

  /**
   * Disposes of resources used by the decompression stream
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
   * @param binary - Whether to accept binary data instead of string
   * @param maxResultSize - Optional maximum size (in bytes) for the compressed result.
   *                        Note: The finish() method might produce additional data that exceeds this limit.
   *                        It's recommended to add a margin of 1KB to your actual limit to accommodate this.
   * @returns A CompressionInstance for handling the stream
   */
  startCompress(
    method: CompressionMethod,
    binary?: boolean,
    maxResultSize?: number
  ): Promise<CompressionInstance>;

  /**
   * Starts a streaming decompression process
   *
   * @param method - The compression method
   * @param binary - Whether to return binary data instead of string
   * @param maxResultSize - Optional maximum size (in bytes) for the decompressed result.
   *                        Note: The finish() method might produce additional data that exceeds this limit.
   *                        It's recommended to add a margin of 1KB to your actual limit to accommodate this.
   * @returns A DecompressionInstance for handling the stream
   */
  startDecompress(
    method: CompressionMethod,
    binary?: boolean,
    maxResultSize?: number
  ): Promise<DecompressionInstance>;

  /**
   * Compresses data using the specified compression method
   *
   * @param data - The data to compress as string or Uint8Array
   * @param method - The compression method
   * @returns Promise resolving to compressed data as string or Uint8Array
   */
  compress(
    data: string | Uint8Array,
    method: CompressionMethod
  ): Promise<string | Uint8Array>;

  /**
   * Decompresses data using the specified compression method
   *
   * @param data - The compressed data as string or Uint8Array
   * @param method - The compression method
   * @param binary - Whether to return binary data instead of string
   * @returns Promise resolving to decompressed data as string or Uint8Array (if binary)
   * @throws Error if input type doesn't match binary flag (string for non-binary, Uint8Array for binary)
   */
  decompress(
    data: string | Uint8Array,
    method: CompressionMethod,
    binary?: boolean
  ): Promise<string | Uint8Array>;

  /**
   * Returns a list of supported compression methods
   *
   * @returns Array of supported compression method names
   */
  list(): string[];
}

/**
 * Common browser compression implementation using Compression Streams API
 */
class BrowserCompression {
  protected decompress: boolean;
  protected writer: WritableStreamDefaultWriter<Uint8Array>;
  protected reader: ReadableStreamDefaultReader<Uint8Array>;
  protected output: Uint8Array[] = [];
  protected totalSize: number = 0;
  protected bufferSize: number = 0; // Track size of data written but not yet read
  protected maxResultSize?: number;
  protected method: CompressionMethod;
  protected lastError: any;
  protected streamFactory: BrowserCompressionStreamFactory;

  // Internal: background reader task
  private pumpPromise: Promise<void>;

  constructor(
    streamFactory: BrowserCompressionStreamFactory,
    method: CompressionMethod,
    decompress: boolean,
    maxResultSize?: number
  ) {
    this.decompress = decompress;
    this.streamFactory = streamFactory;
    this.maxResultSize = maxResultSize;
    this.method = method;
    
    // Initialize the stream
    const stream = this.streamFactory.createStream();
    this.writer = stream.writable.getWriter();
    this.reader = stream.readable.getReader();

    // Start non-blocking consumption of the readable side.
    // This prevents backpressure from stalling writer.write().
    this.pumpPromise = this.pump();
  }

  async maxChunkSize() {
    return this.maxResultSizeSafe();
  }

  private maxResultSizeSafe() {
    if (!this.maxResultSize) return this.maxResultSize;
    // Allow room for ~1KB trailer, keep at least 64 bytes margin.
    return Math.max(64, this.maxResultSize - 1024);
  }

  private checkResultSize(packetSize: number) {
    const maxResultSize = this.maxResultSizeSafe();
    if (!maxResultSize) return;

    const potentialTotalSize = this.totalSize + packetSize;
    if (potentialTotalSize <= maxResultSize) return;

    this.lastError = new CompressionSizeLimitExceeded(
      potentialTotalSize,
      maxResultSize
    );
  }

  // Background reader: continuously pull output as it becomes available.
  private async pump(): Promise<void> {
    try {
      for (;;) {
        const { value, done } = await this.reader.read();
        if (done) break;

        if (value && value.length) {
          // For decompression, enforce size after seeing actual bytes.
          if (this.decompress) {
            // Check *before* mutating state so we can abort early if needed.
            const maxResultSize = this.maxResultSizeSafe();
            if (maxResultSize) {
              const projected = this.totalSize + value.length;
              if (projected > maxResultSize) {
                this.lastError = new CompressionSizeLimitExceeded(
                  projected,
                  maxResultSize
                );
                // Stop the pipeline: cancel reader and abort writer.
                try {
                  this.reader.cancel(this.lastError);
                } catch {}
                try {
                  this.writer.abort?.(this.lastError);
                } catch {}
                break;
              }
            }
          }

          this.output.push(value);
          this.totalSize += value.length;
        }
      }
    } catch (err) {
      // Surface pump errors
      this.lastError ??= err;
      try {
        this.reader.cancel(err);
      } catch {}
      try {
        this.writer.abort?.(err as any);
      } catch {}
    } finally {
    }
  }

  async write(inputData: Uint8Array): Promise<number> {
    if (this.lastError) throw this.lastError;

    // On compression, enforce limit based on *input* size heuristic
    // plus the current buffer size to prevent exceeding limits
    if (!this.decompress) {
      // Check if totalSize + bufferSize + inputData.length would exceed the limit
      const maxResultSize = this.maxResultSizeSafe();
      if (maxResultSize && (this.totalSize + this.bufferSize + inputData.length > maxResultSize)) {
        // We need to flush the current data before writing more
        await this.flush();
        
        // Restart the stream with a new one
        await this.restartStream();
        
        // Reset buffer size after restart
        this.bufferSize = 0;
      }
      
      // Now check if the new input alone would exceed the limit
      this.checkResultSize(inputData.length);
      if (this.lastError) throw this.lastError;
    }

    // Feed data; pump is concurrently draining the output.
    await this.writer.write(inputData);
    
    // Update buffer size with the size of data we just wrote
    this.bufferSize += inputData.length;
    
    // If the background pump tripped an error (e.g., decompression overflow),
    // surface it promptly.
    if (this.lastError) throw this.lastError;

    // Report how much we have so far.
    return this.totalSize;
  }
  
  /**
   * Restarts the compression stream by creating a new one
   * Only used for compression, not decompression
   */
  private async restartStream(): Promise<void> {
    // Clean up existing stream
    try {
      this.writer.releaseLock();
    } catch {}
    try {
      this.reader.cancel?.();
    } catch {}
    try {
      this.reader.releaseLock();
    } catch {}
    
    // Create a new stream
    const stream = this.streamFactory.createStream();
    this.writer = stream.writable.getWriter();
    this.reader = stream.readable.getReader();
    
    // Restart the pump
    this.pumpPromise = this.pump();
  }

  private async flush() {
        // If we already have a non-size-limit error, throw immediately.
    if (
      this.lastError &&
      !(this.lastError instanceof CompressionSizeLimitExceeded)
    ) {
      throw this.lastError;
    }

    // Close to flush trailers/footers. This allows the pump to reach `done:true`.
    try {
      await this.writer.close();
    } catch (e) {
      // If closing fails, record but still wait for pump to settle.
      this.lastError ??= e;
    }

    // Let the pump finish draining remaining bytes.
    try {
      await this.pumpPromise;
    } catch {
      // pumpPromise never rejects (we catch inside), but keep for completeness
    }

    // On decompression, enforce limit one last time (mirrors your original).
    if (
      this.decompress &&
      this.lastError instanceof CompressionSizeLimitExceeded
    ) {
      throw this.lastError;
    }

    // If any other error occurred during pumping, throw it.
    if (
      this.lastError &&
      !(this.lastError instanceof CompressionSizeLimitExceeded)
    ) {
      throw this.lastError;
    }
  }

  async finalize(): Promise<Uint8Array> {

    // Make sure compressor appends everything
    await this.flush();

    // Concatenate all chunks
    const result = new Uint8Array(this.totalSize);
    let offset = 0;
    for (const chunk of this.output) {
      result.set(chunk, offset);
      offset += chunk.length;
    }
    return result;
  }

  dispose(): void {
    // Best-effort cleanup
    try {
      this.writer.releaseLock();
    } catch {}
    try {
      this.reader.cancel?.();
    } catch {}
    try {
      this.reader.releaseLock();
    } catch {}
    this.output = [];
  }
}

/**
 * Factory for creating CompressionStream instances
 */
class CompressionStreamFactoryImpl implements BrowserCompressionStreamFactory {
  private format: CompressionFormat;
  
  constructor(format: string) {
    // TypeScript type assertion to ensure format is a valid CompressionFormat
    this.format = format as CompressionFormat;
  }
  
  createStream(): CompressionStream {
    return new CompressionStream(this.format);
  }
}

/**
 * Factory for creating DecompressionStream instances
 */
class DecompressionStreamFactoryImpl implements BrowserCompressionStreamFactory {
  private format: CompressionFormat;
  
  constructor(format: string) {
    // TypeScript type assertion to ensure format is a valid CompressionFormat
    this.format = format as CompressionFormat;
  }
  
  createStream(): DecompressionStream {
    return new DecompressionStream(this.format);
  }
}

/**
 * Browser implementation of CompressionInstance using Compression Streams API
 */
class BrowserCompressionInstance implements CompressionInstance {
  private compression: BrowserCompression;
  protected binary: boolean;

  constructor(
    format: string,
    method: CompressionMethod,
    binary: boolean,
    maxResultSize?: number
  ) {
    this.binary = binary;
    const factory = new CompressionStreamFactoryImpl(format);
    this.compression = new BrowserCompression(
      factory,
      method,
      false,
      maxResultSize
    );
  }

  async maxChunkSize() {
    return this.compression.maxChunkSize();
  }

  async add(chunk: string | Uint8Array): Promise<number> {
    if (typeof chunk === "string" && this.binary)
      throw new Error("String input in binary mode");
    if (typeof chunk !== "string" && !this.binary)
      throw new Error("Uint8Array input in binary mode");

    // Convert string to Uint8Array if needed
    const inputData =
      typeof chunk === "string" ? new TextEncoder().encode(chunk) : chunk;

    return this.compression.write(inputData);
  }

  async finish(): Promise<Uint8Array> {
    return this.compression.finalize();
  }

  [Symbol.dispose](): void {
    this.compression.dispose();
  }
}

/**
 * Browser implementation of DecompressionInstance using Compression Streams API
 */
class BrowserDecompressionInstance implements DecompressionInstance {
  private compression: BrowserCompression;
  private binary: boolean;

  constructor(
    format: string,
    method: CompressionMethod,
    binary: boolean = false,
    maxResultSize?: number
  ) {
    const factory = new DecompressionStreamFactoryImpl(format);
    this.compression = new BrowserCompression(
      factory,
      method,
      true,
      maxResultSize
    );
    this.binary = binary;
  }

  async maxChunkSize() {
    return this.compression.maxChunkSize();
  }

  async add(chunk: string | Uint8Array): Promise<number> {
    // Convert string to Uint8Array if needed for internal processing
    const inputData =
      typeof chunk === "string" ? new TextEncoder().encode(chunk) : chunk;

    return this.compression.write(inputData);
  }

  async finish(): Promise<string | Uint8Array> {
    const result = await this.compression.finalize();

    // Return binary data or convert to string
    if (this.binary) {
      return result;
    } else {
      return new TextDecoder().decode(result);
    }
  }

  [Symbol.dispose](): void {
    this.compression.dispose();
  }
}

/**
 * Common Node.js compression implementation using zlib
 */
class NodeCompression {
  protected stream: any;
  protected decompress: boolean;
  protected chunks: Uint8Array[] = [];
  protected totalSize: number = 0;
  protected streamFinished: boolean = false;
  protected maxResultSize?: number;
  protected method: CompressionMethod;
  protected lastError: Error | null = null;
  protected bufferedSize = 0;

  constructor(
    stream: any,
    method: CompressionMethod,
    decompress: boolean,
    maxResultSize?: number
  ) {
    this.stream = stream;
    this.decompress = decompress;
    this.maxResultSize = maxResultSize;
    this.method = method;

    // Set up data handling
    this.stream.on("data", this.onData.bind(this));

    // Set up error handling
    this.stream.on("error", (err: unknown) => {
      debugCompression(`Node gzip error ${err}`);
      // Store the error for later use
      this.onError(err instanceof Error ? err : new Error(String(err)));
    });
  }

  private onError(error: any) {
    this.lastError = error;
  }

  private onData(chunk: Buffer) {
    // Ignore data after we've failed
    if (this.lastError) return;

    // clear the buffered size
    this.bufferedSize = 0;

    // Current chunk
    const data = new Uint8Array(chunk);

    // Check result chunk after decompression
    if (this.decompress) {
      this.checkResultSize(data.length);
      if (this.lastError) return;
    }

    this.chunks.push(data);
    this.totalSize += data.length;
  }

  async maxChunkSize() {
    return this.maxResultSizeSafe();
  }

  private maxResultSizeSafe() {
    if (!this.maxResultSize) return this.maxResultSize;
    // Allow room for 1Kb trailer, crop to 64 from the bottom
    return Math.max(64, this.maxResultSize - 1024);
  }

  private potentialTotalSize(packetSize: number) {
    return this.totalSize + packetSize + this.bufferedSize;
  }

  private isResultTooBig(packetSize: number): {} {
    const maxResultSize = this.maxResultSizeSafe();
    if (!maxResultSize) return false;

    return this.potentialTotalSize(packetSize) > maxResultSize;
  }

  private checkResultSize(packetSize: number) {
    if (!this.isResultTooBig(packetSize)) return;

    const maxResultSize = this.maxResultSizeSafe()!;
    const potentialTotalSize = this.potentialTotalSize(packetSize);
    debugCompression(
      `Node gzip result size would be exceeded: ${potentialTotalSize} > ${maxResultSize}`
    );
    this.lastError = new CompressionSizeLimitExceeded(
      potentialTotalSize,
      maxResultSize
    );
  }

  async write(inputData: Uint8Array): Promise<number> {
    // If we already have an error or the stream is finished, reject immediately
    if (this.lastError) {
      throw this.lastError;
    }

    if (this.streamFinished) {
      throw new Error("Stream is already finished");
    }

    // Write data to the stream
    debugCompression(`Node gzip writing ${inputData.length} bytes`);

    // For compression, we check the result before compressing,
    // assume compressed input will be <= input size
    // NOTE: ideally we should compress the input first and then measure
    // the size, but we can't 'unzip' this packet, so the only
    // option left is to measure the input.
    if (!this.decompress) {
      // Try to flush the current stream if we're approaching the limit
      if (this.isResultTooBig(inputData.length) && this.bufferedSize) {
        debugCompression(`Node gzip approaching result limit, flushing...`);
        await nodeFlushGzip!(this.stream);
        debugCompression(`Node gzip flushed`);
      }

      this.checkResultSize(inputData.length);
      if (this.lastError) throw this.lastError;
    }

    // Write to compressor
    const bufferHasSpace = this.stream.write(Buffer.from(inputData));

    // If the stream is not accepting more data and we haven't gotten a data event yet,
    // we need to wait for the drain event
    if (!bufferHasSpace) {
      // Wait until 'data' events
      debugCompression("Node gzip draining...");
      await new Promise((ok) => this.stream.once("drain", ok));
      debugCompression("Node gzip drained");

      // Error might have happened
      if (this.lastError) {
        throw this.lastError;
      }
    } else {
      // Account for this input that didn't produce
      // output and thus wasn't checked
      this.bufferedSize += inputData.length;
    }

    // Return updated size
    return this.totalSize;
  }

  async finalize(): Promise<Uint8Array> {
    debugCompression(`Node gzip finalize, buffered ${this.totalSize} bytes`);

    // If we already have an error, reject immediately
    if (this.lastError) {
      if (this.lastError instanceof CompressionSizeLimitExceeded) {
        // If we rejected the previous packet for compression
        // then we should allow to try to finalize the buffered archive
        if (!this.decompress) this.lastError = undefined as any;
      } else {
        throw this.lastError;
      }
    }

    if (this.streamFinished) {
      throw new Error("Already finalized");
    }

    // Mark as finished
    this.streamFinished = true;

    // Set up one-time end and error handlers before ending the stream
    const endPromise = new Promise((ok) => this.stream.once("end", ok));

    // End the stream after handlers are attached
    this.stream.end();

    // Wait until 'end' event is received
    await endPromise;

    // Error might have happened, we throw even if it's result-size error,
    // it might only happen on decompression and client would have to
    // reject the whole packet (finalize won't return)
    if (this.lastError) {
      throw this.lastError;
    }

    debugCompression(`Node gzip finalized, total size ${this.totalSize} bytes`);

    // Return result
    return this.concatenateChunks();
  }

  protected concatenateChunks(): Uint8Array {
    const result = new Uint8Array(this.totalSize);
    let offset = 0;

    for (const chunk of this.chunks) {
      result.set(chunk, offset);
      offset += chunk.length;
    }

    return result;
  }

  dispose(): void {
    // Release resources
    if (!this.streamFinished) {
      this.stream.removeAllListeners();
      this.stream.end();
    }
    this.stream.destroy();
    this.chunks = [];
  }
}

/**
 * Node.js implementation of CompressionInstance using zlib
 */
class NodeCompressionInstance implements CompressionInstance {
  private compression: NodeCompression;
  private binary: boolean;

  constructor(
    stream: any,
    method: CompressionMethod,
    binary: boolean,
    maxResultSize?: number
  ) {
    this.binary = binary;
    this.compression = new NodeCompression(
      stream,
      method,
      false,
      maxResultSize
    );
  }

  async maxChunkSize() {
    return this.compression.maxChunkSize();
  }

  async add(chunk: string | Uint8Array): Promise<number> {
    if (typeof chunk === "string" && this.binary)
      throw new Error("String input in binary mode");
    if (typeof chunk !== "string" && !this.binary)
      throw new Error("Uint8Array input in binary mode");

    // Convert string to Uint8Array if needed
    const inputData =
      typeof chunk === "string" ? new TextEncoder().encode(chunk) : chunk;

    return this.compression.write(inputData);
  }

  async finish(): Promise<Uint8Array> {
    return this.compression.finalize();
  }

  [Symbol.dispose](): void {
    this.compression.dispose();
  }
}

/**
 * Node.js implementation of DecompressionInstance using zlib
 */
class NodeDecompressionInstance implements DecompressionInstance {
  private compression: NodeCompression;
  private binary: boolean;
  private method: CompressionMethod;

  constructor(
    stream: any,
    method: CompressionMethod,
    binary: boolean = false,
    maxResultSize?: number
  ) {
    this.compression = new NodeCompression(stream, method, true, maxResultSize);
    this.binary = binary;
    this.method = method;
  }

  async maxChunkSize() {
    return this.compression.maxChunkSize();
  }

  async add(chunk: string | Uint8Array): Promise<number> {
    // Convert string to Uint8Array if needed for internal processing
    const inputData =
      typeof chunk === "string" ? new TextEncoder().encode(chunk) : chunk;

    return this.compression.write(inputData);
  }

  async finish(): Promise<string | Uint8Array> {
    const result = await this.compression.finalize();

    // Return binary data or convert to string
    if (this.binary) {
      return result;
    } else {
      return new TextDecoder().decode(result);
    }
  }

  [Symbol.dispose](): void {
    this.compression.dispose();
  }
}

/**
 * No-compression implementation,
 * passes through whatever given (string or bytes)
 * works on bytes because it need to measure the size
 * in bytes.
 */
class NoCompression {
  protected binary: boolean;
  protected chunks: Uint8Array[] = [];
  protected totalSize: number = 0;
  protected maxResultSize?: number;
  protected lastError: any;

  constructor(binary: boolean, maxResultSize?: number) {
    this.binary = binary;
    this.maxResultSize = maxResultSize;
  }

  async maxChunkSize() {
    return this.maxResultSizeSafe();
  }

  private maxResultSizeSafe() {
    if (!this.maxResultSize) return this.maxResultSize;
    return this.maxResultSize;
  }

  private checkResultSize(packetSize: number) {
    const maxResultSize = this.maxResultSizeSafe();
    if (!maxResultSize) return;

    const potentialTotalSize = this.totalSize + packetSize;
    if (potentialTotalSize <= maxResultSize) return;

    this.lastError = new CompressionSizeLimitExceeded(
      potentialTotalSize,
      maxResultSize
    );
  }

  async write(inputData: Uint8Array): Promise<number> {
    this.checkResultSize(inputData.length);
    if (this.lastError) throw this.lastError;

    this.chunks.push(inputData);
    this.totalSize += inputData.length;
    return this.totalSize;
  }

  async finalize(): Promise<Uint8Array> {
    // If we already have an error, reject immediately
    if (
      this.lastError &&
      !(this.lastError instanceof CompressionSizeLimitExceeded)
    ) {
      throw this.lastError;
    }

    // Concatenate all chunks
    const result = new Uint8Array(this.totalSize);
    let offset = 0;

    for (const chunk of this.chunks) {
      result.set(chunk, offset);
      offset += chunk.length;
    }

    return result;
  }

  dispose(): void {
    // Release resources
    this.chunks = [];
  }
}

/**
 * No-compression implementation of CompressionInstance (no compression),
 * same algo for both directions since those are equivalent (pass-through)
 */
class NoCompressionDecompressionInstance implements CompressionInstance {
  private compression: NoCompression;
  private binary: boolean;

  constructor(binary: boolean, maxResultSize?: number) {
    this.compression = new NoCompression(binary, maxResultSize);
    this.binary = binary;
  }

  async maxChunkSize() {
    return this.compression.maxChunkSize();
  }

  async add(chunk: string | Uint8Array): Promise<number> {
    if (typeof chunk === "string" && this.binary)
      throw new Error("String input in binary mode");
    if (typeof chunk !== "string" && !this.binary)
      throw new Error("Uint8Array input in binary mode");

    // Convert string to Uint8Array if needed for internal processing
    const inputData =
      typeof chunk === "string" ? new TextEncoder().encode(chunk) : chunk;
    return this.compression.write(inputData);
  }

  async finish(): Promise<string | Uint8Array> {
    const result = await this.compression.finalize();

    // Return binary data or convert to string
    if (this.binary) {
      return result;
    } else {
      return new TextDecoder().decode(result);
    }
  }

  [Symbol.dispose](): void {
    this.compression.dispose();
  }
}

/**
 * Default implementation of the Compression interface
 * Provides built-in support for 'none' and 'gzip' compression methods
 */
export class DefaultCompression implements Compression {
  /**
   * Starts a streaming compression process
   *
   * @param method - The compression method
   * @param binary - Binary mode
   * @param maxResultSize - Optional maximum size (in bytes) for the compressed result.
   *                        Note: The finish() method might produce additional data that exceeds this limit.
   *                        It's recommended to add a margin of 1KB to your actual limit to accommodate this.
   * @returns A CompressionInstance for handling the stream
   */
  async startCompress(
    method: CompressionMethod,
    binary: boolean = false,
    maxResultSize?: number
  ): Promise<CompressionInstance> {
    // Ensure Node.js functions are initialized if needed
    await ensureNodeInitialized();

    if (method === COMPRESSION_NONE) {
      return new NoCompressionDecompressionInstance(binary, maxResultSize);
    } else if (method === COMPRESSION_GZIP) {
      if (isBrowser) {
        if (typeof window.CompressionStream === "undefined")
          throw new Error(
            "Browser CompressionStream for gzip is not available"
          );

        return new BrowserCompressionInstance(
          "gzip",
          method,
          binary,
          maxResultSize
        );
      } else {
        if (nodeCreateGzip === null) {
          throw new Error("Node.js compression functions not initialized");
        }
        return new NodeCompressionInstance(
          nodeCreateGzip(),
          method,
          binary,
          maxResultSize
        );
      }
    } else {
      throw new Error(`Unsupported compression method: ${method}`);
    }
  }

  /**
   * Starts a streaming decompression process
   *
   * @param method - The compression method
   * @param binary - Whether to return binary data instead of string
   * @param maxResultSize - Optional maximum size (in bytes) for the decompressed result.
   *                        Note: The finish() method might produce additional data that exceeds this limit.
   *                        It's recommended to add a margin of 1KB to your actual limit to accommodate this.
   * @returns A DecompressionInstance for handling the stream
   */
  async startDecompress(
    method: CompressionMethod,
    binary: boolean = false,
    maxResultSize?: number
  ): Promise<DecompressionInstance> {
    // Ensure Node.js functions are initialized if needed
    await ensureNodeInitialized();

    if (method === COMPRESSION_NONE) {
      return new NoCompressionDecompressionInstance(binary, maxResultSize);
    } else if (method === COMPRESSION_GZIP) {
      if (isBrowser) {
        if (typeof window.CompressionStream === "undefined")
          throw new Error(
            "Browser CompressionStream for gzip is not available"
          );

        return new BrowserDecompressionInstance(
          "gzip",
          method,
          binary,
          maxResultSize
        );
      } else {
        if (nodeCreateGunzip === null) {
          throw new Error("Node.js decompression functions not initialized");
        }
        return new NodeDecompressionInstance(
          nodeCreateGunzip(),
          method,
          binary,
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
   * @param data - The data to compress as string or Uint8Array
   * @param method - The compression method
   * @returns Promise resolving to compressed data as Uint8Array
   */
  async compress(
    data: string | Uint8Array,
    method: CompressionMethod
  ): Promise<string | Uint8Array> {
    // Use the streaming API
    const compressor = await this.startCompress(method);
    try {
      await compressor.add(data);
      const compressed = await compressor.finish();

      // Debug logging needs to handle both string and Uint8Array
      if (typeof compressed === "string") {
        debugCompression(
          `Compressed ${
            typeof data === "string" ? data.length : data.byteLength
          } bytes to ${compressed.length} bytes`
        );
      } else {
        debugCompression(
          `Compressed ${
            typeof data === "string" ? data.length : data.byteLength
          } bytes to ${compressed.byteLength} bytes`
        );
      }

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
   * @param data - The compressed data as Uint8Array
   * @param method - The compression method
   * @param binary - Whether to return binary data instead of string
   * @returns Promise resolving to decompressed data as string or Uint8Array (if binary)
   */
  async decompress(
    data: string | Uint8Array,
    method: CompressionMethod,
    binary: boolean = false
  ): Promise<string | Uint8Array> {
    // Use the streaming API
    const decompressor = await this.startDecompress(method, binary);
    try {
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
