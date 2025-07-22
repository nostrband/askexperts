/**
 * Represents a chunk of text with its position information and embedding.
 */
export interface Chunk {
  /** Index of the chunk */
  index: number;
  /** Offset in the original text */
  offset: number;
  /** The text content of the chunk */
  text: string;
  /** The embedding vector (optional, added after embedding) */
  embedding: number[];
}

/**
 * Interface for text embedding services.
 * Responsible for splitting text into chunks and generating embeddings.
 */
export interface RagEmbeddings {
  /**
   * Initializes the embedding model.
   * Must be called before using the embed method.
   * @throws Error if already initialized
   * @returns Promise that resolves when initialization is complete
   */
  start(): Promise<void>;

  /**
   * Embeds the given text by splitting it into chunks and generating embeddings.
   * @param text The text to embed
   * @returns Promise resolving to an array of chunks with their embeddings
   * @throws Error if start() has not been called
   */
  embed(text: string): Promise<Chunk[]>;
}

/**
 * Result of a RAG search operation.
 */
export interface RagResult {
  /** Unique identifier for the vector */
  id: string;
  /** The embedding vector */
  vector: number[];
  /** Additional metadata associated with the vector */
  metadata: any;
  /** Distance/similarity score between the query vector and this result */
  distance: number;
}

/**
 * Document to be stored in the RAG database
 */
export interface RagDocument {
  /** Unique identifier for the vector */
  id: string;
  /** The embedding vector */
  vector: number[];
  /** Additional metadata to store with the vector */
  metadata: any;
}

/**
 * Interface for RAG database operations.
 * Provides methods for storing and searching vector embeddings.
 */
export interface RagDB {
  /**
   * Stores a single vector embedding with associated metadata in the specified collection.
   * @param collectionName The name of the collection to store the vector in
   * @param id Unique identifier for the vector
   * @param vector The embedding vector (array of numbers)
   * @param metadata Additional metadata to store with the vector
   */
  store(collectionName: string, id: string, vector: number[], metadata: any): Promise<void>;
  
  /**
   * Stores multiple vector embeddings with associated metadata in the specified collection.
   * @param collectionName The name of the collection to store the vectors in
   * @param documents Array of documents to store
   */
  storeBatch(collectionName: string, documents: RagDocument[]): Promise<void>;
  
  /**
   * Searches for similar vectors in the specified collection.
   * @param collectionName The name of the collection to search in
   * @param vector The query vector to search for
   * @param limit Maximum number of results to return
   * @returns Promise resolving to an array of RagResult objects
   */
  search(collectionName: string, vector: number[], limit: number): Promise<RagResult[]>;
  
  /**
   * Searches for similar vectors in the specified collection using multiple query vectors.
   * @param collectionName The name of the collection to search in
   * @param vectors Array of query vectors to search for
   * @param limit Maximum number of results to return per query vector
   * @returns Promise resolving to an array of arrays of RagResult objects, one array per query vector
   */
  searchBatch(collectionName: string, vectors: number[][], limit: number): Promise<RagResult[][]>;
}