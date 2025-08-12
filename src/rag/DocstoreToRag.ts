import { debugDocstore } from "../common/debug.js";
import { DocStoreClient, Doc, Subscription } from "../docstore/interfaces.js";
import { RagDB, RagDocument } from "./interfaces.js";

/**
 * Options for syncing documents from a docstore to a RagDB
 */
export interface SyncOptions {
  /** ID of the docstore to sync */
  docstore_id: string;
  /** Name of the collection to store documents in */
  collection_name: string;
  /** Optional type of documents to filter by */
  type?: string;
  /** Optional callback to call when all documents have been synced */
  onEof?: () => void;
  /** Optional callback to let client watch the docs and filter them */
  onDoc?: (doc: Doc) => Promise<boolean>;
  /** Optional callback to customize metadata for each document */
  onDocMeta?: (doc: Doc, embedding: number[]) => Promise<any>;
}

/**
 * Class to sync documents from a DocStore to a RagDB
 */
export class DocstoreToRag {
  private ragDB: RagDB;
  private docStoreClient: DocStoreClient;
  private activeSubscriptions: Set<Subscription> = new Set();

  /**
   * Creates a new DocstoreToRag instance
   * @param ragDB - The RagDB instance to store embeddings in
   * @param docStoreClient - The DocStoreClient to get documents from
   */
  constructor(ragDB: RagDB, docStoreClient: DocStoreClient) {
    this.ragDB = ragDB;
    this.docStoreClient = docStoreClient;
  }

  /**
   * Converts a Doc to an array of RagDocuments (one per embedding)
   * @param doc - The document to convert
   * @param onDocMeta - Optional callback to customize metadata
   * @returns Array of RagDocuments with vectors and metadata
   */
  private async docToRagDocuments(
    doc: Doc,
    onDocMeta?: (doc: Doc, embedding: number[]) => Promise<any>
  ): Promise<RagDocument[]> {
    // Skip documents without embeddings
    if (!doc.embeddings || doc.embeddings.length === 0) {
      return [];
    }

    try {
      // Convert Float32Array[] to regular arrays for the RAG DB
      const vectors = doc.embeddings.map((embedding) => {
        // Convert Float32Array to regular array
        return Array.from(embedding);
      });

      // Create a RagDocument for each embedding vector
      const ragDocuments: RagDocument[] = [];

      for (let i = 0; i < vectors.length; i++) {
        const vector = vectors[i];

        // Create default metadata (excluding data and embeddings)
        let metadata = {
          id: doc.id,
          docstore_id: doc.docstore_id,
          type: doc.type,
          timestamp: doc.timestamp,
          created_at: doc.created_at,
          chunk: i,
        };

        // Use custom metadata if callback provided
        if (onDocMeta) {
          metadata = await onDocMeta(doc, vector);
        }

        ragDocuments.push({
          id: `${doc.docstore_id}:${doc.id}:${i}`,
          vector,
          metadata,
        });
      }

      return ragDocuments;
    } catch (error) {
      console.error(`Error parsing embeddings for document ${doc.id}:`, error);
      return [];
    }
  }

  /**
   * Syncs documents from a docstore to the RagDB
   * @param options - Options for syncing
   * @returns Subscription with a stop method
   */
  async sync(options: SyncOptions): Promise<{ stop: () => void }> {
    const { docstore_id, collection_name, type, onDoc, onEof, onDocMeta } =
      options;

    // Batch of documents to store
    let batch: RagDocument[] = [];
    const BATCH_SIZE = 100;

    // Subscribe to the docstore
    const subscription = await this.docStoreClient.subscribe(
      { docstore_id, type },
      async (doc?: Doc) => {
        // If doc is undefined, it signals EOF
        if (!doc) {
          // Store any remaining documents in the batch
          if (batch.length > 0) {
            await this.ragDB.storeBatch(collection_name, batch);
            debugDocstore("Synced batch", batch.length);
            batch = [];
          }

          // Call the onEof callback if provided
          if (onEof) {
            onEof();
          }
        } else {
          // onDoc callback might filter this doc
          if (onDoc && !(await onDoc(doc))) return;

          // Convert the document to multiple RagDocuments (one per embedding)
          const ragDocuments = await this.docToRagDocuments(doc, onDocMeta);

          // Add the documents to the batch
          for (const ragDocument of ragDocuments) {
            batch.push(ragDocument);

            // If the batch is full, store it and reset
            if (batch.length >= BATCH_SIZE) {
              await this.ragDB.storeBatch(collection_name, batch);
              debugDocstore("Synced batch", batch.length, BATCH_SIZE);
              batch = [];
            }
          }
        }
      }
    );

    // Store the subscription
    this.activeSubscriptions.add(subscription);

    // Return an object with a stop method
    return {
      stop: () => {
        subscription.close();
        this.activeSubscriptions.delete(subscription);
      },
    };
  }

  /**
   * Closes all active subscriptions when the object is disposed
   */
  [Symbol.dispose](): void {
    // Close all active subscriptions
    for (const subscription of this.activeSubscriptions.values()) {
      subscription.close();
    }

    // Clear the subscriptions map
    this.activeSubscriptions.clear();
  }
}
