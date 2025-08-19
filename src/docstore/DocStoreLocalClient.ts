import { Doc, DocStore, DocStoreClient, Subscription } from "./interfaces.js";
import { DocStoreSQLite } from "./DocStoreSQLite.js";
import { getCurrentUserId } from "../common/users.js";

/**
 * Local client implementation of DocStoreClient that encapsulates DocStoreSQLite
 */
export class DocStoreLocalClient implements DocStoreClient {
  private docStore: DocStoreSQLite;
  private userId: string | undefined;

  /**
   * Creates a new DocStoreLocalClient instance
   * @param dbPath - Path to the SQLite database file
   */
  constructor(dbPath: string) {
    this.docStore = new DocStoreSQLite(dbPath);
    
    // Try to get the current user ID
    try {
      this.userId = getCurrentUserId();
    } catch (error) {
      // If getCurrentUserId throws an error, leave userId as undefined
      console.warn("No current user set, user filtering will be disabled");
    }
  }

  /**
   * Subscribe to documents in a docstore
   * @param options - Subscription options
   * @param options.docstore_id - ID of the docstore to subscribe to
   * @param options.type - Optional type of documents to filter by
   * @param options.since - Optional start timestamp for filtering documents
   * @param options.until - Optional end timestamp for filtering documents
   * @param onDoc - Async callback function to handle each document
   * @returns Subscription object to manage the subscription
   */
  async subscribe(
    options: {
      docstore_id: string;
      type?: string;
      since?: number;
      until?: number;
    },
    onDoc: (doc?: Doc) => Promise<void>
  ): Promise<Subscription> {
    return this.docStore.subscribe({...options, user_id: this.userId}, onDoc);
  }

  /**
   * Upsert a document in the store
   * @param doc - Document to upsert
   * @returns Promise that resolves when the operation is complete
   */
  async upsert(doc: Doc): Promise<void> {
    return this.docStore.upsert(doc, this.userId);
  }

  /**
   * Get a document by ID
   * @param docstore_id - ID of the docstore containing the document
   * @param doc_id - ID of the document to get
   * @returns Promise that resolves with the document if found, null otherwise
   */
  async get(docstore_id: string, doc_id: string): Promise<Doc | null> {
    return this.docStore.get(docstore_id, doc_id, this.userId);
  }

  /**
   * Delete a document from the store
   * @param docstore_id - ID of the docstore containing the document
   * @param doc_id - ID of the document to delete
   * @returns Promise that resolves with true if document existed and was deleted, false otherwise
   */
  async delete(docstore_id: string, doc_id: string): Promise<boolean> {
    return this.docStore.delete(docstore_id, doc_id, this.userId);
  }

  /**
   * Create a new docstore if one with the given name doesn't exist
   * @param name - Name of the docstore to create
   * @param model - Name of the embeddings model
   * @param vector_size - Size of embedding vectors
   * @param options - Options for the model, defaults to empty string
   * @returns Promise that resolves with the ID of the created or existing docstore
   */
  async createDocstore(name: string, model?: string, vector_size?: number, options?: string): Promise<string> {
    return this.docStore.createDocstore(name, model, vector_size, options, this.userId);
  }

  /**
   * Get a docstore by ID
   * @param id - ID of the docstore to get
   * @returns Promise that resolves with the docstore if found, undefined otherwise
   */
  async getDocstore(id: string): Promise<DocStore | undefined> {
    return this.docStore.getDocstore(id, this.userId);
  }

  /**
   * List all docstores
   * @returns Promise that resolves with an array of docstore objects
   */
  async listDocstores(): Promise<DocStore[]> {
    return this.docStore.listDocstores(this.userId);
  }

  /**
   * List docstores by specific IDs
   * @param ids - Array of docstore IDs to retrieve
   * @returns Promise that resolves with an array of docstore objects
   */
  async listDocStoresByIds(ids: string[]): Promise<DocStore[]> {
    return this.docStore.listDocStoresByIds(ids, this.userId);
  }

  /**
   * List documents by specific IDs
   * @param docstore_id - ID of the docstore containing the documents
   * @param ids - Array of document IDs to retrieve
   * @returns Promise that resolves with an array of document objects
   */
  async listDocsByIds(docstore_id: string, ids: string[]): Promise<Doc[]> {
    return this.docStore.listDocsByIds(docstore_id, ids);
  }

  /**
   * Delete a docstore and all its documents
   * @param id - ID of the docstore to delete
   * @returns Promise that resolves with true if docstore existed and was deleted, false otherwise
   */
  async deleteDocstore(id: string): Promise<boolean> {
    return this.docStore.deleteDocstore(id, this.userId);
  }

  /**
   * Count documents in a docstore
   * @param docstore_id - ID of the docstore to count documents for
   * @returns Promise that resolves with the number of documents in the docstore
   */
  async countDocs(docstore_id: string): Promise<number> {
    return this.docStore.countDocs(docstore_id, this.userId);
  }

  /**
   * Symbol.dispose method for releasing resources
   */
  [Symbol.dispose](): void {
    this.docStore[Symbol.dispose]();
  }
}