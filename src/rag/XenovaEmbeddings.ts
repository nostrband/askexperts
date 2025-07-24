// @ts-ignore
import { pipeline } from '@xenova/transformers';
import { Chunk, RagEmbeddings } from './interfaces.js';

/**
 * Implementation of RagEmbeddings using Xenova transformers library.
 */
export class XenovaEmbeddings implements RagEmbeddings {
  private model: string;
  private embedder: any;
  private chunkSize: number;
  private chunkOverlap: number;

  /**
   * Creates a new instance of XenovaEmbeddings.
   * @param model The model name to use for embeddings
   * @param chunkSize The size of text chunks to create
   * @param chunkOverlap The amount of overlap between chunks
   */
  constructor(
    // Good multi-lingual model w/ 256-token context size
    model: string = 'Xenova/all-MiniLM-L6-v2', // 'nomic-ai/nomic-embed-text-v1'
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
      throw new Error('Embedder is already initialized');
    }
    this.embedder = await pipeline('feature-extraction', this.model);
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
        embedding: []
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
      throw new Error('Embedder is not initialized. Call start() first.');
    }
    
    try {

    const embeddings = await this.embedder(text, {
      pooling: 'mean', // average over token embeddings
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
  async embed(text: string): Promise<Chunk[]> {
    const chunks = this.splitTextIntoChunks(text);
    
    // Process chunks in parallel for better performance
    const chunksWithEmbeddings = await Promise.all(
      chunks.map(async (chunk) => {
        const embedding = await this.embedText(chunk.text);
        // Create a new chunk with the embedding property
        const chunkWithEmbedding: Chunk = {
          ...chunk,
          embedding
        };
        return chunkWithEmbedding;
      })
    );
    
    return chunksWithEmbeddings;
  }
}