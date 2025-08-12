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
  embeddings: Float32Array[]; // Array of embedding vectors
  user_id?: string; // User ID associated with the document
}

/**
 * DocStore metadata
 */
export interface DocStore {
  id: string;
  name: string;
  timestamp: number;
  model: string;       // name of embeddings model
  vector_size: number; // size of embedding vectors
  options: string;     // options of the model, '' by default
  user_id?: string;    // User ID associated with the docstore
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
 * All methods are async to support both local and remote implementations
 */
export interface DocStoreClient {
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
  ): Promise<Subscription>;
  
  /**
   * Upsert a document in the store
   * @param doc - Document to upsert
   * @returns Promise that resolves when the operation is complete
   */
  upsert(doc: Doc): Promise<void>;
  
  /**
   * Get a document by ID
   * @param docstore_id - ID of the docstore containing the document
   * @param doc_id - ID of the document to get
   * @returns Promise that resolves with the document if found, null otherwise
   */
  get(docstore_id: string, doc_id: string): Promise<Doc | null>;
  
  /**
   * Delete a document from the store
   * @param docstore_id - ID of the docstore containing the document
   * @param doc_id - ID of the document to delete
   * @returns Promise that resolves with true if document existed and was deleted, false otherwise
   */
  delete(docstore_id: string, doc_id: string): Promise<boolean>;
  
  /**
   * Create a new docstore if one with the given name doesn't exist
   * @param name - Name of the docstore to create
   * @param model - Name of the embeddings model
   * @param vector_size - Size of embedding vectors
   * @param options - Options for the model, defaults to empty string
   * @returns Promise that resolves with the ID of the created or existing docstore
   */
  createDocstore(name: string, model?: string, vector_size?: number, options?: string): Promise<string>;
  
  /**
   * Get a docstore by ID
   * @param id - ID of the docstore to get
   * @returns Promise that resolves with the docstore if found, undefined otherwise
   */
  getDocstore(id: string): Promise<DocStore | undefined>;
  
  /**
   * List all docstores
   * @returns Promise that resolves with an array of docstore objects
   */
  listDocstores(): Promise<DocStore[]>;
  
  /**
   * List docstores by specific IDs
   * @param ids - Array of docstore IDs to retrieve
   * @returns Promise that resolves with an array of docstore objects
   */
  listDocStoresByIds(ids: string[]): Promise<DocStore[]>;
  
  /**
   * List documents by specific IDs
   * @param docstore_id - ID of the docstore containing the documents
   * @param ids - Array of document IDs to retrieve
   * @returns Promise that resolves with an array of document objects
   */
  listDocsByIds(docstore_id: string, ids: string[]): Promise<Doc[]>;
  
  /**
   * Delete a docstore and all its documents
   * @param id - ID of the docstore to delete
   * @returns Promise that resolves with true if docstore existed and was deleted, false otherwise
   */
  deleteDocstore(id: string): Promise<boolean>;
  
  /**
   * Count documents in a docstore
   * @param docstore_id - ID of the docstore to count documents for
   * @returns Promise that resolves with the number of documents in the docstore
   */
  countDocs(docstore_id: string): Promise<number>;
  
  /**
   * Symbol.dispose method for releasing resources
   */
  [Symbol.dispose](): void;
}

/**
 * Message types for WebSocket communication
 */
export enum MessageType {
  REQUEST = 'request',
  RESPONSE = 'response',
  SUBSCRIPTION = 'subscription',
  DOCUMENT = 'document',
  END = 'end'
}

/**
 * Interface for WebSocket messages
 */
export interface WebSocketMessage {
  id: string;
  type: MessageType;
  method: string;
  params: Record<string, any>;
  error?: {
    code: string;
    message: string;
  };
}

/**
 * Interface for DocStore permissions
 * Used to validate user authentication and permissions
 */
export interface DocStorePerms {
  /**
   * Check if a pubkey is a valid user
   * @param pubkey - The public key of the user
   * @throws Error if the user is not valid with a custom error message
   * @returns Promise that resolves if the user is valid
   */
  checkUser(pubkey: string): Promise<void>;
  
  /**
   * Check if a user is allowed to perform an operation
   * @param pubkey - The public key of the user
   * @param message - The WebSocket message being processed
   * @throws Error if the operation is not allowed with a custom error message
   * @returns Promise that resolves with an optional object containing listIds if the operation is allowed
   */
  checkPerms(pubkey: string, message: WebSocketMessage): Promise<{ listIds?: string[] } | void>;

  /**
   * Get the user ID associated with a public key
   * @param pubkey - Public key of the user
   * @returns Promise that resolves with the user ID
   */
  getUserId(pubkey: string): Promise<string>;
}

/**
 * Interface for HTTP requests with authorization headers
 */
export interface AuthRequest {
  headers: {
    authorization?: string;
    [key: string]: any;
  };
  method: string;
  originalUrl: string;
  rawBody?: Buffer;
}
