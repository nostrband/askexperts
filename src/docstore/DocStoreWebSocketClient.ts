import {
  Doc,
  DocStore,
  DocStoreClient,
  MessageType,
  Subscription,
} from "./interfaces.js";
import { generateUUID } from "../common/uuid.js";
import { createAuthTokenNip98 } from "../common/auth.js";
import { debugDocstore, debugError } from "../common/debug.js";
import { PlainKeySigner, type Signer } from "nostr-tools/signer";

/**
 * Configuration options for DocStoreWebSocketClient
 */
export interface DocStoreWebSocketClientOptions {
  /** WebSocket URL to connect to */
  url: string;
  /** Optional private key for authentication (as Uint8Array) */
  privateKey?: Uint8Array;
  /** Optional signer for authentication */
  signer?: Signer;
  /**
   * Optional token for bearer authentication
   * Can be a string or a callback function that returns a Promise<string>
   */
  token?: string | (() => Promise<string>);
  /** Optional WebSocket instance to use instead of creating a new one */
  webSocket?: WebSocket;
  /** Enable automatic reconnection on disconnect (default: true) */
  autoReconnect?: boolean;
  /** Initial reconnection delay in milliseconds (default: 1000) */
  reconnectDelay?: number;
  /** Maximum reconnection delay in milliseconds (default: 30000) */
  maxReconnectDelay?: number;
  /** Maximum number of reconnection attempts (default: Infinity) */
  maxReconnectAttempts?: number;
}

/**
 * WebSocket client for DocStoreSQLiteServer
 * Implements the DocStoreClient interface
 */
export class DocStoreWebSocketClient implements DocStoreClient {
  private ws!: WebSocket; // WebSocket instance
  private messageCallbacks: Map<string, (response: any) => void> = new Map();
  private subscriptionCallbacks: Map<string, (doc?: Doc) => Promise<void>> =
    new Map();
  private docBuffers: Map<string, Doc[]> = new Map();
  private processingSubscriptions: Set<string> = new Set();
  private connected: boolean = false;
  private connectPromise: Promise<void>;
  private connectResolve!: () => void;
  private connectReject!: (error: Error) => void;
  private privateKey?: Uint8Array;
  private signer?: Signer;
  #token?: string | (() => Promise<string>);
  private url: string;
  private authenticated: boolean = false;
  private messageHandler: (event: MessageEvent) => void;
  private openHandler: () => void;
  private closeHandler: (event: CloseEvent) => void;
  private errorHandler: (event: Event) => void;
  
  // Reconnection state
  private autoReconnect: boolean = true;
  private reconnectDelay: number = 1000;
  private maxReconnectDelay: number = 30000;
  private maxReconnectAttempts: number = Infinity;
  private reconnectAttempts: number = 0;
  private reconnectTimeout?: NodeJS.Timeout | number;
  private disposed: boolean = false;
  private customWebSocket?: WebSocket;

  /**
   * Creates a new DocStoreWebSocketClient
   * @param options - Configuration options for the client
   */
  constructor(options: DocStoreWebSocketClientOptions | string) {
    // Handle legacy constructor format (url string)
    let url: string;
    let privateKey: Uint8Array | undefined;
    let signer: Signer | undefined;
    let token: string | (() => Promise<string>) | undefined;
    let customWebSocket: WebSocket | undefined;

    if (typeof options === "string") {
      // Legacy format: constructor(url, privateKey?, token?)
      url = options;
      // Note: We can't access the other parameters in this legacy format
      // This is just for backward compatibility with code that passes only the URL
    } else {
      // New format: constructor(options)
      url = options.url;
      privateKey = options.privateKey;
      signer = options.signer;
      token = options.token;
      customWebSocket = options.webSocket;
      
      // Set reconnection options
      this.autoReconnect = options.autoReconnect ?? true;
      this.reconnectDelay = options.reconnectDelay ?? 1000;
      this.maxReconnectDelay = options.maxReconnectDelay ?? 30000;
      this.maxReconnectAttempts = options.maxReconnectAttempts ?? Infinity;
    }

    // Initialize connection promise
    this.connectPromise = new Promise<void>((resolve, reject) => {
      this.connectResolve = resolve;
      this.connectReject = reject;
    });

    // Store authentication info for later use
    this.privateKey = privateKey;
    this.signer = signer;
    this.#token = token;
    this.url = url;
    this.customWebSocket = customWebSocket;

    // Create event handlers
    this.openHandler = async () => {
      debugDocstore("Connected to DocStoreSQLiteServer");
      this.connected = true;
      
      // Reset reconnection attempts on successful connection
      this.reconnectAttempts = 0;

      // If authentication is needed, send auth message
      if (this.#token || this.privateKey || this.signer) {
        try {
          await this.sendAuthMessage();
        } catch (error) {
          debugError("Authentication error:", error);
          this.connectReject(new Error("Authentication failed"));
          return;
        }
      }

      this.connectResolve();
    };

    this.messageHandler = (event: MessageEvent) => {
      try {
        const data =
          typeof event.data === "string"
            ? event.data
            : new TextDecoder().decode(event.data);
        const message = JSON.parse(data);
        this.handleMessage(message);
      } catch (error) {
        debugError("Error parsing message:", error);
      }
    };

    this.closeHandler = (event: CloseEvent) => {
      debugDocstore("Disconnected from DocStoreSQLiteServer", event.code, event.reason);
      this.connected = false;
      this.authenticated = false;
      
      // Only attempt reconnection if not disposed and auto-reconnect is enabled
      // and the close was not initiated by the client (code 1000 is normal closure)
      if (!this.disposed && this.autoReconnect && event.code !== 1000) {
        this.scheduleReconnect();
      }
    };

    this.errorHandler = (event: Event) => {
      debugError("WebSocket error:", event);
      if (!this.connected) {
        this.connectReject(new Error("WebSocket connection error"));
        
        // Schedule reconnection on connection error if auto-reconnect is enabled
        if (!this.disposed && this.autoReconnect) {
          this.scheduleReconnect();
        }
      }
    };

    // Connect to the WebSocket server
    this.connect();
  }

  /**
   * Connect or reconnect to the WebSocket server
   */
  private connect(): void {
    // Clear any existing reconnection timeout
    if (this.reconnectTimeout) {
      clearTimeout(this.reconnectTimeout as NodeJS.Timeout);
      this.reconnectTimeout = undefined;
    }

    // Create a new connection promise for this connection attempt
    this.connectPromise = new Promise<void>((resolve, reject) => {
      this.connectResolve = resolve;
      this.connectReject = reject;
    });

    // Connect to the WebSocket server
    if (this.customWebSocket && this.reconnectAttempts === 0) {
      // Use the provided WebSocket instance only on first connection
      this.ws = this.customWebSocket;
    } else {
      // Create a new WebSocket instance
      this.ws =
        typeof globalThis.WebSocket !== "undefined"
          ? new globalThis.WebSocket(this.url)
          : new WebSocket(this.url);
    }

    // Set up event handlers
    this.ws.onopen = this.openHandler;
    this.ws.onmessage = this.messageHandler;
    this.ws.onclose = this.closeHandler;
    this.ws.onerror = this.errorHandler;
  }

  /**
   * Schedule a reconnection attempt with exponential backoff
   * This method is idempotent - it won't schedule multiple reconnections
   */
  private scheduleReconnect(): void {
    if (this.disposed || !this.autoReconnect) {
      return;
    }

    // If a reconnection is already scheduled, don't schedule another one
    if (this.reconnectTimeout) {
      return;
    }

    if (this.reconnectAttempts >= this.maxReconnectAttempts) {
      debugError(`Max reconnection attempts (${this.maxReconnectAttempts}) reached`);
      return;
    }

    this.reconnectAttempts++;
    
    // Calculate delay with exponential backoff and jitter
    const baseDelay = Math.min(
      this.reconnectDelay * Math.pow(2, this.reconnectAttempts - 1),
      this.maxReconnectDelay
    );
    
    // Add random jitter (±25% of the delay)
    const jitter = baseDelay * 0.25 * (Math.random() * 2 - 1);
    const delay = Math.max(0, baseDelay + jitter);

    debugDocstore(`Scheduling reconnection attempt ${this.reconnectAttempts} in ${Math.round(delay)}ms`);

    this.reconnectTimeout = setTimeout(() => {
      this.reconnectTimeout = undefined; // Clear the timeout reference
      if (!this.disposed && this.autoReconnect) {
        debugDocstore(`Attempting reconnection ${this.reconnectAttempts}`);
        this.connect();
      }
    }, delay);
  }

  /**
   * Manually disable automatic reconnection
   */
  disableAutoReconnect(): void {
    this.autoReconnect = false;
    if (this.reconnectTimeout) {
      clearTimeout(this.reconnectTimeout as NodeJS.Timeout);
      this.reconnectTimeout = undefined;
    }
  }

  /**
   * Manually enable automatic reconnection
   */
  enableAutoReconnect(): void {
    this.autoReconnect = true;
  }

  get token(): string | (() => Promise<string>) | undefined {
    return this.#token;
  }

  set token(value: string | (() => Promise<string>) | undefined) {
    this.#token = value;
  }

  /**
   * Send authentication message after connection
   * @returns Promise that resolves when authentication is successful
   */
  private async sendAuthMessage(): Promise<void> {
    // Generate a unique message ID
    const id = generateUUID();

    // Create headers object
    const headers: Record<string, string> = {};

    // Add authorization header based on token, signer, or privateKey
    if (this.#token) {
      // If token is a callback function, call it to get the actual token
      const tokenValue =
        typeof this.#token === "function" ? await this.#token() : this.#token;

      headers["authorization"] = tokenValue;
    } else if (this.signer || this.privateKey) {
      const signer = this.signer || new PlainKeySigner(this.privateKey!);
      const authToken = await createAuthTokenNip98({
        signer,
        url: this.url,
        method: "GET",
      });
      headers["authorization"] = authToken;
    }

    // Create a promise for the auth response
    const authPromise = new Promise<void>((resolve, reject) => {
      // Set a timeout to reject the promise if no response is received
      const timeout = setTimeout(() => {
        this.messageCallbacks.delete(id);
        reject(new Error("Timeout waiting for authentication response"));
      }, 30000); // 30 second timeout

      // Set up the callback to resolve the promise
      this.messageCallbacks.set(id, (response) => {
        clearTimeout(timeout);
        if (response.error) {
          reject(new Error(`Authentication error: ${response.error.message}`));
        } else {
          this.authenticated = true;
          debugDocstore("Authentication successful");
          resolve();
        }
      });
    });

    // Send the auth message
    const authMessage = JSON.stringify({
      id,
      type: MessageType.AUTH,
      method: "auth",
      params: {
        headers,
      },
    });
    this.ws.send(authMessage);

    // Wait for the auth response
    return authPromise;
  }

  /**
   * Wait for the connection to be established
   * @returns Promise that resolves when connected
   */
  async waitForConnection(): Promise<void> {
    return this.connectPromise;
  }

  /**
   * Handle incoming WebSocket messages
   * @param message - Parsed message
   */
  private handleMessage(message: any): void {
    const { id, type, method, params, error } = message;

    // Handle different message types
    switch (type) {
      case MessageType.RESPONSE:
        // Handle response messages
        const callback = this.messageCallbacks.get(id);
        if (callback) {
          callback(message);
          this.messageCallbacks.delete(id);
        }
        break;

      case MessageType.DOCUMENT:
        // Handle document messages for subscriptions
        const subscriptionCallback = this.subscriptionCallbacks.get(id);
        if (subscriptionCallback) {
          if (params.eof) {
            // End of feed, enqueue undefined to signal end
            this.enqueueDoc(id, undefined);
          } else if (params.doc) {
            // Document received, enqueue it for processing
            this.enqueueDoc(id, params.doc);
          }
        }
        break;

      default:
        debugDocstore(`Unhandled message type: ${type}`);
    }
  }

  /**
   * Send a message to the server and wait for a response
   * @param type - Message type
   * @param method - Method name
   * @param params - Method parameters
   * @returns Promise that resolves with the response
   */
  private async sendAndWait(
    type: MessageType,
    method: string,
    params: any
  ): Promise<any> {
    // Wait for connection if not connected
    if (!this.connected) {
      await this.waitForConnection();
    }

    // Make sure we're authenticated if authentication was required
    if ((this.#token || this.privateKey || this.signer) && !this.authenticated) {
      throw new Error("Not authenticated");
    }

    // Generate a unique message ID
    const id = generateUUID();

    // Create a promise for the response
    const responsePromise = new Promise<any>((resolve, reject) => {
      // Set a timeout to reject the promise if no response is received
      const timeout = setTimeout(() => {
        this.messageCallbacks.delete(id);
        reject(new Error(`Timeout waiting for response to ${method}`));
      }, 30000); // 30 second timeout

      // Set up the callback to resolve the promise
      this.messageCallbacks.set(id, (response) => {
        clearTimeout(timeout);
        if (response.error) {
          reject(new Error(`Error from server: ${response.error.message}`));
        } else {
          resolve(response.params);
        }
      });
    });

    // Send the message
    const messageStr = JSON.stringify({
      id,
      type,
      method,
      params,
    });
    this.ws.send(messageStr);

    // Wait for the response
    return responsePromise;
  }

  /**
   * Subscribe to documents in a docstore
   * @param options - Subscription options
   * @param onDoc - Callback function to handle each document
   * @returns Promise that resolves with a Subscription object to manage the subscription
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
    // Generate a unique subscription ID
    const subscriptionId = generateUUID();

    // Store the callback
    this.subscriptionCallbacks.set(subscriptionId, onDoc);

    // Send the subscription message
    const subscriptionMessage = JSON.stringify({
      id: subscriptionId,
      type: MessageType.SUBSCRIPTION,
      method: "subscribe",
      params: options,
    });
    this.ws.send(subscriptionMessage);

    // Return a subscription object with a close method
    return Promise.resolve({
      close: () => {
        // Send an end message to terminate the subscription
        const endMessage = JSON.stringify({
          id: subscriptionId,
          type: MessageType.END,
          method: "subscribe",
          params: {},
        });
        this.ws.send(endMessage);

        // Remove the callback
        this.subscriptionCallbacks.delete(subscriptionId);
      },
    });
  }

  /**
   * Prepare a document for serialization by converting Float32Array to regular arrays
   * @param doc - Document to prepare
   * @returns A serializable version of the document
   */
  private prepareDocForSerialization(doc: Doc): any {
    // Create a deep copy of the document
    const result: any = { ...doc };

    // Convert Float32Array embeddings to regular arrays
    if (doc.embeddings) {
      result.embeddings = doc.embeddings.map((embedding) =>
        embedding instanceof Float32Array ? Array.from(embedding) : embedding
      );
    }

    // Convert Uint8Array file to base64 string for transmission
    if (doc.file) {
      // For browser compatibility, we need to convert Uint8Array to base64 string
      // In browser environments, we need to use a different approach
      if (typeof window !== "undefined") {
        // Browser environment
        const binary = Array.from(new Uint8Array(doc.file.buffer))
          .map((b) => String.fromCharCode(b))
          .join("");
        result.file = btoa(binary);
      } else {
        // Node.js environment
        const buffer = Buffer.from(doc.file);
        result.file = buffer.toString("base64");
      }
    }

    return result;
  }

  /**
   * Upsert a document in the store
   * @param doc - Document to upsert
   * @returns Promise that resolves when the operation is complete
   */
  async upsert(doc: Doc): Promise<void> {
    // Prepare the document for serialization
    const serializedDoc = this.prepareDocForSerialization(doc);

    // Send the serialized document
    await this.sendAndWait(MessageType.REQUEST, "upsert", {
      doc: serializedDoc,
    });
  }

  /**
   * Get a document by ID
   * @param docstore_id - ID of the docstore containing the document
   * @param doc_id - ID of the document to get
   * @returns Promise that resolves with the document if found, null otherwise
   */
  async get(docstore_id: string, doc_id: string): Promise<Doc | null> {
    try {
      const response = await this.sendAndWait(MessageType.REQUEST, "get", {
        docstore_id,
        doc_id,
      });
      return response.doc;
    } catch (error) {
      return null;
    }
  }

  /**
   * Delete a document from the store
   * @param docstore_id - ID of the docstore containing the document
   * @param doc_id - ID of the document to delete
   * @returns Promise that resolves with true if document existed and was deleted, false otherwise
   */
  async delete(docstore_id: string, doc_id: string): Promise<boolean> {
    try {
      const response = await this.sendAndWait(MessageType.REQUEST, "delete", {
        docstore_id,
        doc_id,
      });
      return response.success;
    } catch (error) {
      return false;
    }
  }

  /**
   * Create a new docstore if one with the given name doesn't exist
   * @param name - Name of the docstore to create
   * @param model - Name of the embeddings model
   * @param vector_size - Size of embedding vectors
   * @param options - Options for the model, defaults to empty string
   * @returns Promise that resolves with the ID of the created or existing docstore
   */
  async createDocstore(
    name: string,
    model: string = "",
    vector_size: number = 0,
    options: string = ""
  ): Promise<string> {
    const response = await this.sendAndWait(
      MessageType.REQUEST,
      "createDocstore",
      { name, model, vector_size, options }
    );
    return response.id;
  }

  /**
   * Get a docstore by ID
   * @param id - ID of the docstore to get
   * @returns Promise that resolves with the docstore if found, undefined otherwise
   */
  async getDocstore(id: string): Promise<DocStore | undefined> {
    try {
      const response = await this.sendAndWait(
        MessageType.REQUEST,
        "getDocstore",
        { id }
      );
      return response.docstore;
    } catch (error) {
      return undefined;
    }
  }

  /**
   * List all docstores
   * @returns Promise that resolves with an array of docstore objects
   */
  async listDocstores(): Promise<DocStore[]> {
    try {
      const response = await this.sendAndWait(
        MessageType.REQUEST,
        "listDocstores",
        {}
      );
      return response.docstores;
    } catch (error) {
      return [];
    }
  }

  /**
   * List docstores by specific IDs
   * @param ids - Array of docstore IDs to retrieve
   * @returns Promise that resolves with an array of docstore objects
   */
  async listDocStoresByIds(ids: string[]): Promise<DocStore[]> {
    try {
      const response = await this.sendAndWait(
        MessageType.REQUEST,
        "listDocStoresByIds",
        { ids }
      );
      return response.docstores || [];
    } catch (error) {
      return [];
    }
  }

  /**
   * List documents by specific IDs
   * @param docstore_id - ID of the docstore containing the documents
   * @param ids - Array of document IDs to retrieve
   * @returns Promise that resolves with an array of document objects
   */
  async listDocsByIds(docstore_id: string, ids: string[]): Promise<Doc[]> {
    if (ids.length === 0) {
      return [];
    }

    try {
      const response = await this.sendAndWait(
        MessageType.REQUEST,
        "listDocsByIds",
        { docstore_id, ids }
      );
      return response.docs || [];
    } catch (error) {
      return [];
    }
  }

  /**
   * Delete a docstore and all its documents
   * @param id - ID of the docstore to delete
   * @returns Promise that resolves with true if docstore existed and was deleted, false otherwise
   */
  async deleteDocstore(id: string): Promise<boolean> {
    try {
      const response = await this.sendAndWait(
        MessageType.REQUEST,
        "deleteDocstore",
        { id }
      );
      return response.success;
    } catch (error) {
      return false;
    }
  }

  /**
   * Count documents in a docstore
   * @param docstore_id - ID of the docstore to count documents for
   * @returns Promise that resolves with the number of documents in the docstore
   */
  async countDocs(docstore_id: string): Promise<number> {
    try {
      const response = await this.sendAndWait(
        MessageType.REQUEST,
        "countDocs",
        { docstore_id }
      );
      return response.count;
    } catch (error) {
      return 0;
    }
  }

  /**
   * Enqueue a document for processing by a subscription
   * @param subId - Subscription ID
   * @param doc - Document to process, or undefined to signal end of feed
   */
  private enqueueDoc(subId: string, doc?: Doc): void {
    // Initialize buffer if it doesn't exist
    if (!this.docBuffers.has(subId)) {
      this.docBuffers.set(subId, []);
    }

    // Get the buffer
    const buffer = this.docBuffers.get(subId)!;

    // Add the document to the buffer
    if (doc !== undefined) {
      // Process the document before adding it to the buffer
      // Convert base64 string back to Uint8Array for file field
      if (doc.file && typeof doc.file === "string") {
        try {
          if (typeof window !== "undefined") {
            // Browser environment
            const binary = atob(doc.file);
            const bytes = new Uint8Array(binary.length);
            for (let i = 0; i < binary.length; i++) {
              bytes[i] = binary.charCodeAt(i);
            }
            doc.file = bytes;
          } else {
            // Node.js environment
            doc.file = Buffer.from(doc.file, "base64");
          }
        } catch (error) {
          debugError("Error converting base64 string to Uint8Array:", error);
        }
      }

      buffer.push(doc);
    } else {
      // For EOF (undefined), we add a special marker
      // We'll use null as a marker for EOF since undefined can't be stored in arrays
      buffer.push(null as unknown as Doc);
    }

    // Start processing if not already processing
    if (!this.processingSubscriptions.has(subId)) {
      this.processDocs(subId);
    }
  }

  /**
   * Process documents for a subscription sequentially
   * @param subId - Subscription ID
   */
  private async processDocs(subId: string): Promise<void> {
    // Mark as processing
    this.processingSubscriptions.add(subId);

    try {
      // Get the buffer
      const buffer = this.docBuffers.get(subId);
      if (!buffer || buffer.length === 0) {
        // No documents to process
        this.processingSubscriptions.delete(subId);
        return;
      }

      // Get the callback
      const callback = this.subscriptionCallbacks.get(subId);
      if (!callback) {
        // No callback, clear the buffer
        this.docBuffers.delete(subId);
        this.processingSubscriptions.delete(subId);
        return;
      }

      // Process the first document
      const doc = buffer.shift();

      // Check if it's the EOF marker (null)
      if (doc === null) {
        // Call with undefined to signal EOF
        await callback(undefined);
      } else {
        // Process the document
        await callback(doc);
      }

      // Continue processing if there are more documents
      if (buffer.length > 0) {
        // Process the next document
        this.processDocs(subId);
      } else {
        // No more documents, remove from processing set
        this.processingSubscriptions.delete(subId);
      }
    } catch (error) {
      debugError("Error processing document:", error);
      // Remove from processing set to allow retry
      this.processingSubscriptions.delete(subId);
    }
  }

  [Symbol.dispose](): void {
    debugDocstore("DocStoreWebSocket client dispose");
    
    // Mark as disposed to prevent reconnection
    this.disposed = true;
    
    // Clear reconnection timeout
    if (this.reconnectTimeout) {
      clearTimeout(this.reconnectTimeout as NodeJS.Timeout);
      this.reconnectTimeout = undefined;
    }
    
    // Close WebSocket connection
    if (this.ws && this.ws.readyState !== WebSocket.CLOSED) {
      this.ws.close(1000, "Client disposed"); // Normal closure
    }
    
    this.subscriptionCallbacks.clear();
    this.messageCallbacks.clear();
    this.docBuffers.clear();
    this.processingSubscriptions.clear();

    // Clean up event handlers
    if (this.ws) {
      this.ws.onopen = null;
      this.ws.onmessage = null;
      this.ws.onclose = null;
      this.ws.onerror = null;
    }
  }
}
