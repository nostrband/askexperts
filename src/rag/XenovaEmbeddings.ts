// import { env } from "@xenova/transformers";
import { pipeline } from "@xenova/transformers";
import { Doc } from "../docstore/interfaces.js";
import { Chunk, RagEmbeddings } from "./interfaces.js";

// Looks like these don't work
// env.allowLocalModels = false;   // don’t look under /models
// env.allowRemoteModels = true;   // fetch from the Hub (default is true)

/**
 * Implementation of RagEmbeddings using Xenova transformers library.
 */
export class XenovaEmbeddings implements RagEmbeddings {
  private model: string;
  private embedder: any;
  private chunkSize: number;
  private chunkOverlap: number;
  private vectorSize: number = 0;

  public static DEFAULT_MODEL = "Xenova/all-MiniLM-L6-v2";

  /**
   * Creates a new instance of XenovaEmbeddings.
   * @param model The model name to use for embeddings
   * @param chunkSize The size of text chunks to create
   * @param chunkOverlap The amount of overlap between chunks
   */
  constructor(
    // Good multi-lingual model w/ 256-token context size
    model: string = XenovaEmbeddings.DEFAULT_MODEL, // 'nomic-ai/nomic-embed-text-v1'
    // I guess we should split by sentence?
    chunkSize: number = 400,
    chunkOverlap: number = 50
  ) {
    this.model = model;
    this.chunkSize = chunkSize;
    this.chunkOverlap = chunkOverlap;
  }

  /**
   * Initializes the embedder pipeline.
   * Must be called before using the embed method.
   * @throws Error if already initialized
   */
  public async start(): Promise<void> {
    if (this.embedder) {
      throw new Error("Embedder is already initialized");
    }
    this.embedder = await pipeline("feature-extraction", this.model);
    this.vectorSize = (await this.embedText('')).length;
  }

  /**
   * Returns the name of the model used for embeddings
   * @returns The model name
   */
  public getModelName(): string {
    return this.model;
  }

  public getVectorSize() {
    if (!this.vectorSize) throw new Error("Must be started first");
    return this.vectorSize;
  }

  /**
   * Splits text into chunks with specified size and overlap.
   * @param text The text to split
   * @returns Array of chunks
   */
  private splitTextIntoChunks(text: string): Chunk[] {
    const chunks: Chunk[] = [];
    let index = 0;

    for (let i = 0; i < text.length; i += this.chunkSize - this.chunkOverlap) {
      const end = Math.min(i + this.chunkSize, text.length);
      chunks.push({
        index,
        offset: i,
        text: text.substring(i, end),
        embedding: [],
      });
      index++;

      // If we've reached the end of the text, break
      if (end === text.length) break;
    }

    return chunks;
  }

  /**
   * Embeds a single chunk of text.
   * @param text The text to embed
   * @returns The embedding vector
   * @throws Error if start() has not been called
   */
  private async embedText(text: string): Promise<number[]> {
    if (!this.embedder) {
      throw new Error("Embedder is not initialized. Call start() first.");
    }

    try {
      const embeddings = await this.embedder(text, {
        pooling: "mean", // average over token embeddings
        normalize: true,
      });
      // Convert to regular array if it's not already
      return Array.from(embeddings.data);
    } catch (e) {
      console.error(e);
      throw e;
    }
  }

  /**
   * Embeds the given text by splitting it into chunks and generating embeddings.
   * @param text The text to embed
   * @returns Promise resolving to an array of chunks with their embeddings
   */
  async embed(text: string, onProgress?: (done: number, total: number) => void): Promise<Chunk[]> {
    const chunks = this.splitTextIntoChunks(text);
    
    const chunksWithEmbeddings: Chunk[] = [];
    for (let i = 0; i < chunks.length; i++) {
      const chunk = chunks[i];
      const embedding = await this.embedText(chunk.text);
      
      // Create a new chunk with the embedding property
      const chunkWithEmbedding: Chunk = {
        ...chunk,
        embedding,
      };
      
      chunksWithEmbeddings.push(chunkWithEmbedding);
      
      // Call the progress callback with current progress
      if (onProgress) onProgress(i, chunks.length);
    }
    
    return chunksWithEmbeddings;
  }

  /**
   * Embeds a document by processing its data field and updating its embeddings and embedding_offsets.
   * @param doc The document to embed
   * @returns Promise resolving to the document with updated embeddings and embedding_offsets
   * @throws Error if start() has not been called
   */
  async embedDoc(doc: Doc, onProgress?: (done: number, total: number) => void): Promise<Doc> {
    if (!this.embedder) {
      throw new Error("Embedder is not initialized. Call start() first.");
    }

    // Generate chunks with embeddings from the document's data
    // Pass the onProgress callback to the embed method
    const chunks = await this.embed(doc.data, onProgress);
    
    // Convert embeddings from number[][] to Float32Array[]
    const float32Embeddings = chunks.map((c) => {
      const float32Array = new Float32Array(c.embedding.length);
      for (let i = 0; i < c.embedding.length; i++) {
        float32Array[i] = c.embedding[i];
      }
      return float32Array;
    });
    
    // Create a Uint32Array of offsets from the chunks
    const offsets = new Uint32Array(chunks.length);
    for (let i = 0; i < chunks.length; i++) {
      offsets[i] = chunks[i].offset;
    }
    
    // Update the document with embeddings and offsets
    doc.embeddings = float32Embeddings;
    doc.embedding_offsets = offsets;
    
    return doc;
  }
}
