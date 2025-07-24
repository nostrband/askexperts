/**
 * Document store interfaces
 */

/**
 * Document interface representing a stored document
 */
export interface Doc {
  id: string;
  docstore_id: string;
  timestamp: number; // unix timestamp of doc insert time
  created_at: number; // unix timestamp of doc creation time (for imported docs)
  type: string;
  data: string;
  embeddings: string;
}

/**
 * DocStore metadata
 */
export interface DocStore {
  id: string;
  name: string;
  timestamp: number;
}

/**
 * Subscription interface for handling document streams
 */
export interface Subscription {
  /**
   * Terminates the subscription
   */
  close(): void;
}

/**
 * DocStoreClient interface for interacting with document stores
 */
export interface DocStoreClient {
  /**
   * Subscribe to documents in a docstore
   * @param docstore_id - ID of the docstore to subscribe to
   * @param type - Type of documents to filter by
   * @param since - Start timestamp for filtering documents
   * @param until - End timestamp for filtering documents
   * @param onDoc - Async callback function to handle each document
   * @returns Subscription object to manage the subscription
   */
  /**
   * Subscribe to documents in a docstore
   * @param options - Subscription options
   * @param options.docstore_id - ID of the docstore to subscribe to
   * @param options.type - Optional type of documents to filter by
   * @param options.since - Optional start timestamp for filtering documents
   * @param options.until - Optional end timestamp for filtering documents
   * @param onDoc - Async callback function to handle each document. When called with undefined doc, it signals end of feed (EOF)
   * @returns Subscription object to manage the subscription
   */
  subscribe(
    options: {
      docstore_id: string;
      type?: string;
      since?: number;
      until?: number;
    },
    onDoc: (doc?: Doc) => Promise<void>
  ): Subscription;
  
  /**
   * Upsert a document in the store
   * @param doc - Document to upsert
   */
  upsert(doc: Doc): void;
  
  /**
   * Get a document by ID
   * @param docstore_id - ID of the docstore containing the document
   * @param doc_id - ID of the document to get
   * @returns The document if found, null otherwise
   */
  get(docstore_id: string, doc_id: string): Doc | null;
  
  /**
   * Delete a document from the store
   * @param docstore_id - ID of the docstore containing the document
   * @param doc_id - ID of the document to delete
   * @returns true if document existed and was deleted, false otherwise
   */
  delete(docstore_id: string, doc_id: string): boolean;
  
  /**
   * Create a new docstore if one with the given name doesn't exist
   * @param name - Name of the docstore to create
   * @returns ID of the created or existing docstore
   */
  createDocstore(name: string): string;
  
  /**
   * List all docstores
   * @returns Array of docstore objects
   */
  listDocstores(): DocStore[];
  
  /**
   * Delete a docstore and all its documents
   * @param id - ID of the docstore to delete
   * @returns true if docstore existed and was deleted, false otherwise
   */
  deleteDocstore(id: string): boolean;
  
  /**
   * Count documents in a docstore
   * @param docstore_id - ID of the docstore to count documents for
   * @returns Number of documents in the docstore
   */
  countDocs(docstore_id: string): number;
  
  /**
   * Symbol.dispose method for releasing resources
   */
  [Symbol.dispose](): void;
}