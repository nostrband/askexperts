import { Doc } from "../docstore/interfaces.js";

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

  // Model name
  getModelName(): string;

  // Size of embeddings vector
  getVectorSize(): number;

  /**
   * Embeds the given text by splitting it into chunks and generating embeddings.
   * @param text The text to embed
   * @returns Promise resolving to an array of chunks with their embeddings
   * @throws Error if start() has not been called
   */
  embed(text: string, onProgress?: (done: number, total: number) => Promise<void>): Promise<Chunk[]>;
  
  /**
   * Embeds a document by processing its data field and updating its embeddings and embedding_offsets.
   * @param doc The document to embed
   * @param onProgress Optional callback function that reports progress of embedding
   * @returns Promise resolving to the document with updated embeddings and embedding_offsets
   * @throws Error if start() has not been called
   */
  embedDoc(doc: Doc, onProgress?: (done: number, total: number) => Promise<void>): Promise<Doc>;
}

export interface RagMetadata {
  doc_id: string;
  doc_metadata: string;
  doc_related_ids: string; // JSON.stringify(array)
  doc_type: string;
  doc_timestamp: number;
  doc_created_at: number;
  docstore_id: string;
  chunk: number;
  offset_start: number;
  offset_end: number;
  extra: string;
  include?: string; // Optional include field for filtering (e.g., "always")
}

/**
 * Result of a RAG search operation.
 */
export interface RagResult {
  /** Unique identifier for the vector */
  id: string;
  /** The embedding vector */
  vector: number[];
  /** Matching doc chunk */
  data: string;
  /** Additional metadata associated with the vector */
  metadata: RagMetadata;
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
  metadata: RagMetadata;
  /** Document chunk */
  data: string;
}

export interface RagSearchOptions {
  ids?: string[];
  doc_ids?: string[];
  include?: string; // Optional include field for filtering
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
  store(collectionName: string, document: RagDocument): Promise<void>;
  
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
   * @param options Extra search options
   * @returns Promise resolving to an array of RagResult objects
   */
  search(collectionName: string, vector: number[], limit: number, options?: RagSearchOptions): Promise<RagResult[]>;
  
  /**
   * Searches for similar vectors in the specified collection using multiple query vectors.
   * @param collectionName The name of the collection to search in
   * @param vectors Array of query vectors to search for
   * @param limit Maximum number of results to return per query vector
   * @param options Extra search options
   * @returns Promise resolving to an array of arrays of RagResult objects, one array per query vector
   */
  searchBatch(collectionName: string, vectors: number[][], limit: number, options?: RagSearchOptions): Promise<RagResult[][]>;

  /**
   * Get chunks by ids
   * @param collectionName The name of the collection to get from
   * @param options Search criteria
   * @returns Promise resolving to array of results
   */
  get(collectionName: string, options: RagSearchOptions): Promise<RagResult[]>;

  /**
   * Delete collection and all it's contents
   * @param collectionName collection name
   */
  deleteCollection(collectionName: string): Promise<void>;
}