import { ChromaClient, Collection } from "chromadb";
import { RagDB, RagResult, RagDocument } from "./interfaces.js";
import { OpenAIEmbeddingFunction } from "@chroma-core/openai";

/**
 * Implementation of RagDB using ChromaDB.
 */
export class ChromaRagDB implements RagDB {
  private client: ChromaClient;
  private collections: Map<string, Collection> = new Map();

  /**
   * Creates a new instance of ChromaRagDB.
   */
  constructor(host?: string, port?: number, database?: string) {
    this.client = new ChromaClient({
      host,
      port,
      database,
    });
  }

  /**
   * Gets or creates a collection in ChromaDB.
   * @param collectionName The name of the collection
   * @returns The collection object
   */
  private async getCollection(collectionName: string): Promise<Collection> {
    if (!this.collections.has(collectionName)) {
      const collection = await this.client.getOrCreateCollection({
        name: collectionName,
        // NOTE: we can't disable built-in embedder, and the default one
        // interferes with our own (same) embedder, so we provide a fake one here.
        embeddingFunction: new OpenAIEmbeddingFunction({
          modelName: "text-embedding-3-small",
          apiKey: "dummy", 
        }),
      });
      this.collections.set(collectionName, collection);
      return collection;
    }
    return this.collections.get(collectionName)!;
  }

  /**
   * Stores a vector embedding with associated metadata in the specified collection.
   * @param collectionName The name of the collection to store the vector in
   * @param id Unique identifier for the vector
   * @param vector The embedding vector (array of numbers)
   * @param metadata Additional metadata to store with the vector
   */
  async store(
    collectionName: string,
    id: string,
    vector: number[],
    metadata: any
  ): Promise<void> {
    const collection = await this.getCollection(collectionName);

    await collection.add({
      ids: [id],
      embeddings: [vector],
      metadatas: [metadata],
    });
  }

  /**
   * Stores multiple vector embeddings with associated metadata in the specified collection.
   * @param collectionName The name of the collection to store the vectors in
   * @param documents Array of documents to store
   */
  async storeBatch(
    collectionName: string,
    documents: RagDocument[]
  ): Promise<void> {
    if (documents.length === 0) return;
    
    const collection = await this.getCollection(collectionName);

    await collection.add({
      ids: documents.map(doc => doc.id),
      embeddings: documents.map(doc => doc.vector),
      metadatas: documents.map(doc => doc.metadata),
    });
  }

  /**
   * Searches for similar vectors in the specified collection.
   * @param collectionName The name of the collection to search in
   * @param vector The query vector to search for
   * @param limit Maximum number of results to return
   * @returns Promise resolving to an array of matching records
   */
  async search(
    collectionName: string,
    vector: number[],
    limit: number
  ): Promise<RagResult[]> {
    const collection = await this.getCollection(collectionName);

    const results = await collection.query({
      queryEmbeddings: [vector],
      nResults: limit,
      include: ["embeddings", "metadatas", "distances"],
    });
    const rows = results.rows()[0];
    return rows.map((r) => ({
      id: r.id,
      vector: r.embedding!,
      metadata: r.metadata!,
      distance: r.distance!,
    }));
  }

  /**
   * Searches for similar vectors in the specified collection using multiple query vectors.
   * @param collectionName The name of the collection to search in
   * @param vectors Array of query vectors to search for
   * @param limit Maximum number of results to return per query vector
   * @returns Promise resolving to an array of arrays of RagResult objects, one array per query vector
   */
  async searchBatch(
    collectionName: string,
    vectors: number[][],
    limit: number
  ): Promise<RagResult[][]> {
    if (vectors.length === 0) return [];
    
    const collection = await this.getCollection(collectionName);

    const results = await collection.query({
      queryEmbeddings: vectors,
      nResults: limit,
      include: ["embeddings", "metadatas", "distances"],
    });
    
    return results.rows().map(rows =>
      rows.map(r => ({
        id: r.id,
        vector: r.embedding!,
        metadata: r.metadata!,
        distance: r.distance!,
      }))
    );
  }
}
