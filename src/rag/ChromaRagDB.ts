import { ChromaClient, Collection } from "chromadb";
import {
  RagDB,
  RagResult,
  RagDocument,
  RagMetadata,
  RagSearchOptions,
} from "./interfaces.js";
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
  async store(collectionName: string, doc: RagDocument): Promise<void> {
    return this.storeBatch(collectionName, [doc]);
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
    // documents.map(doc => {
    //   if (doc.metadata.include) console.error("always", doc.id); 
    // });

    await collection.upsert({
      ids: documents.map((doc) => doc.id),
      embeddings: documents.map((doc) => doc.vector),
      metadatas: documents.map((doc) => doc.metadata as any),
      documents: documents.map((doc) => doc.data),
    });
  }

  /**
   * Searches for similar vectors in the specified collection.
   * @param collectionName The name of the collection to search in
   * @param vector The query vector to search for
   * @param limit Maximum number of results to return
   * @param options Extra search options
   * @returns Promise resolving to an array of matching records
   */
  async search(
    collectionName: string,
    vector: number[],
    limit: number,
    options?: RagSearchOptions
  ): Promise<RagResult[]> {
    const results = await this.searchBatch(
      collectionName,
      [vector],
      limit,
      options
    );
    return results[0];

    // const collection = await this.getCollection(collectionName);

    // const results = await collection.query({
    //   queryEmbeddings: [vector],
    //   nResults: limit,
    //   include: ["embeddings", "metadatas", "documents", "distances"],
    // });
    // const rows = results.rows()[0];
    // return rows.map((r) => ({
    //   id: r.id,
    //   vector: r.embedding!,
    //   data: r.document || "",
    //   metadata: r.metadata! as unknown as RagMetadata,
    //   distance: r.distance!,
    // }));
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
    limit: number,
    options?: RagSearchOptions
  ): Promise<RagResult[][]> {
    if (vectors.length === 0) return [];

    const collection = await this.getCollection(collectionName);

    const query: any = {
      queryEmbeddings: vectors,
      nResults: limit,
      include: ["embeddings", "metadatas", "documents", "distances"],
    };

    if (options?.ids?.length) query.ids = options.ids;

    // Build where clause for filtering
    const whereClause: any = {};
    if (options?.doc_ids?.length) {
      whereClause.doc_id = { $in: options.doc_ids };
    }
    if (options?.include !== undefined) {
      whereClause.include = options.include;
    }

    // Only add where clause if we have conditions
    if (Object.keys(whereClause).length > 0) {
      query.where = whereClause;
    }

    const results = await collection.query(query);

    return results.rows().map((rows) =>
      rows.map((r) => ({
        id: r.id,
        vector: r.embedding!,
        data: r.document || "",
        metadata: r.metadata! as unknown as RagMetadata,
        distance: r.distance!,
      }))
    );
  }

  /**
   * Get documents by their IDs from the specified collection.
   * @param collectionName The name of the collection to get from
   * @param options Search criteria
   * @returns Promise resolving to an array of RagResult objects
   */
  async get(
    collectionName: string,
    options: RagSearchOptions
  ): Promise<RagResult[]> {
    if (!options.ids?.length && !options.doc_ids?.length && !options.include)
      return [];

    const collection = await this.getCollection(collectionName);

    const query: any = {
      nResults: 1000, // FIXME wtf?
      include: ["embeddings", "metadatas", "documents"],
    };
    if (options.ids?.length) query.ids = options.ids;

    // Build where clause for filtering
    const whereClause: any = {};
    if (options.doc_ids?.length) {
      whereClause.doc_id = { $in: options.doc_ids };
    }
    if (options.include !== undefined) {
      whereClause.include = options.include;
    }

    // Only add where clause if we have conditions
    if (Object.keys(whereClause).length > 0) {
      query.where = whereClause;
    }

    const results = await collection.get(query);

    return results.rows().map((r) => ({
      id: r.id,
      vector: r.embedding!,
      data: r.document || "",
      metadata: r.metadata! as unknown as RagMetadata,
      distance: 0, // No distance is calculated for direct ID retrieval
    }));
  }

  async deleteCollection(collectionName: string) {
    this.collections.delete(collectionName);
    return this.client.deleteCollection({ name: collectionName });
  }

}
