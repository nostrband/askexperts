import WebSocket from 'ws';
import { Doc, DocStore, DocStoreClient, MessageType, Subscription } from './interfaces.js';
import crypto from 'crypto';
import { createAuthToken } from '../common/auth.js';

/**
 * Serializable version of Doc with regular arrays instead of Float32Array
 */
interface SerializableDoc extends Omit<Doc, 'embeddings'> {
  embeddings: number[][];
}

/**
 * WebSocket client for DocStoreSQLiteServer
 * Implements the DocStoreClient interface
 */
export class DocStoreWebSocketClient implements DocStoreClient {
  private ws: any; // Using any type for WebSocket to avoid type conflicts
  private messageCallbacks: Map<string, (response: any) => void> = new Map();
  private subscriptionCallbacks: Map<string, (doc?: Doc) => Promise<void>> = new Map();
  private connected: boolean = false;
  private connectPromise: Promise<void>;
  private connectResolve!: () => void;
  private connectReject!: (error: Error) => void;

  /**
   * Creates a new DocStoreWebSocketClient
   * @param url - WebSocket URL to connect to
   * @param privateKey - Optional private key for authentication (as Uint8Array)
   */
  constructor(url: string, privateKey?: Uint8Array) {
    // Initialize connection promise
    this.connectPromise = new Promise<void>((resolve, reject) => {
      this.connectResolve = resolve;
      this.connectReject = reject;
    });

    // Create connection options
    const options: WebSocket.ClientOptions = {};
    
    // If privateKey is provided, add authorization header with NIP-98 token
    if (privateKey) {
      const authToken = createAuthToken(privateKey, url, 'GET');
      options.headers = {
        'Authorization': authToken
      };
    }

    // Connect to the WebSocket server with options
    this.ws = new WebSocket(url, options);

    // Set up event handlers
    this.ws.on('open', () => {
      console.log('Connected to DocStoreSQLiteServer');
      this.connected = true;
      this.connectResolve();
    });

    this.ws.on('message', (data: Buffer) => {
      try {
        const message = JSON.parse(data.toString());
        this.handleMessage(message);
      } catch (error) {
        console.error('Error parsing message:', error);
      }
    });

    this.ws.on('close', () => {
      console.log('Disconnected from DocStoreSQLiteServer');
      this.connected = false;
    });

    this.ws.on('error', (error: Error) => {
      console.error('WebSocket error:', error);
      if (!this.connected) {
        this.connectReject(error);
      }
    });
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
            // End of feed, call with undefined
            subscriptionCallback(undefined);
          } else if (params.doc) {
            // Document received, call with the document
            subscriptionCallback(params.doc);
          }
        }
        break;

      default:
        console.warn(`Unhandled message type: ${type}`);
    }
  }

  /**
   * Send a message to the server and wait for a response
   * @param type - Message type
   * @param method - Method name
   * @param params - Method parameters
   * @returns Promise that resolves with the response
   */
  private async sendAndWait(type: MessageType, method: string, params: any): Promise<any> {
    // Wait for connection if not connected
    if (!this.connected) {
      await this.waitForConnection();
    }

    // Generate a unique message ID
    const id = crypto.randomUUID();

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
    this.ws.send(JSON.stringify({
      id,
      type,
      method,
      params
    }));

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
    const subscriptionId = crypto.randomUUID();

    // Store the callback
    this.subscriptionCallbacks.set(subscriptionId, onDoc);

    // Send the subscription message
    this.ws.send(JSON.stringify({
      id: subscriptionId,
      type: MessageType.SUBSCRIPTION,
      method: 'subscribe',
      params: options
    }));

    // Return a subscription object with a close method
    return Promise.resolve({
      close: () => {
        // Send an end message to terminate the subscription
        this.ws.send(JSON.stringify({
          id: subscriptionId,
          type: MessageType.END,
          method: 'subscribe',
          params: {}
        }));

        // Remove the callback
        this.subscriptionCallbacks.delete(subscriptionId);
      }
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
      result.embeddings = doc.embeddings.map(embedding =>
        embedding instanceof Float32Array ? Array.from(embedding) : embedding
      );
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
    await this.sendAndWait(MessageType.REQUEST, 'upsert', { doc: serializedDoc });
  }

  /**
   * Get a document by ID
   * @param docstore_id - ID of the docstore containing the document
   * @param doc_id - ID of the document to get
   * @returns Promise that resolves with the document if found, null otherwise
   */
  async get(docstore_id: string, doc_id: string): Promise<Doc | null> {
    try {
      const response = await this.sendAndWait(MessageType.REQUEST, 'get', { docstore_id, doc_id });
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
      const response = await this.sendAndWait(MessageType.REQUEST, 'delete', { docstore_id, doc_id });
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
  async createDocstore(name: string, model: string = "", vector_size: number = 0, options: string = ""): Promise<string> {
    const response = await this.sendAndWait(MessageType.REQUEST, 'createDocstore', { name, model, vector_size, options });
    return response.id;
  }

  /**
   * Get a docstore by ID
   * @param id - ID of the docstore to get
   * @returns Promise that resolves with the docstore if found, undefined otherwise
   */
  async getDocstore(id: string): Promise<DocStore | undefined> {
    try {
      const response = await this.sendAndWait(MessageType.REQUEST, 'getDocstore', { id });
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
      const response = await this.sendAndWait(MessageType.REQUEST, 'listDocstores', {});
      return response.docstores;
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
      const response = await this.sendAndWait(MessageType.REQUEST, 'deleteDocstore', { id });
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
      const response = await this.sendAndWait(MessageType.REQUEST, 'countDocs', { docstore_id });
      return response.count;
    } catch (error) {
      return 0;
    }
  }

  /**
   * Close the WebSocket connection
   */
  [Symbol.dispose](): void {
    this.ws.close();
  }

}