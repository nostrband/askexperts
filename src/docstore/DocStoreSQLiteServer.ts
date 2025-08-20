import { WebSocketServer } from "ws";
import WebSocket from "ws";
import http from "http";
import {
  Doc,
  DocStore,
  Subscription,
  DocStorePerms,
  WebSocketMessage,
  UserInfo,
} from "./interfaces.js";
import { MessageType } from "./interfaces.js";
import { DocStoreSQLite } from "./DocStoreSQLite.js";
import { debugDocstore, debugError } from "../common/debug.js";
import { parseAuthToken, AuthRequest } from "../common/auth.js";

/**
 * Extended WebSocket interface with subscriptions property
 */
interface ExtendedWebSocket {
  subscriptions?: Set<string>;
  readyState: number;
  send: (data: string) => void;
  close: () => void;
  on: (event: string, listener: (...args: any[]) => void) => void;
  pubkey?: string; // Added pubkey for authenticated connections
  user_info?: UserInfo; // Added user_info for authenticated connections
}

/**
 * Error codes for WebSocket responses
 */
export enum ErrorCode {
  INVALID_REQUEST = "invalid_request",
  METHOD_NOT_FOUND = "method_not_found",
  INVALID_PARAMS = "invalid_params",
  DOCSTORE_NOT_FOUND = "docstore_not_found",
  DOCUMENT_NOT_FOUND = "document_not_found",
  INTERNAL_ERROR = "internal_error",
  PERMISSION_DENIED = "permission_denied",
  UNAUTHORIZED = "unauthorized",
}

/**
 * DocStoreSQLiteServer class that exposes DocStoreSQLite functionality via WebSocket
 */
/**
 * Configuration options for DocStoreSQLiteServer
 */
export interface DocStoreSQLiteServerOptions {
  /** Path to the SQLite database file */
  dbPath: string;
  /** Port to listen on */
  port?: number;
  /** Host to bind to */
  host?: string;
  /** Server origin for auth token validation (e.g. 'https://yourdomain.com') */
  origin?: string;
  /** Optional permissions interface for authentication and authorization */
  perms?: DocStorePerms;
}

export class DocStoreSQLiteServer {
  private wss: WebSocketServer;
  private server: http.Server;
  private docStore: DocStoreSQLite;
  private subscriptions: Map<string, Subscription> = new Map();
  private clients: Set<ExtendedWebSocket> = new Set();
  private perms?: DocStorePerms; // Optional permissions interface
  private serverOrigin: string;
  private port: number;
  private host: string;

  /**
   * Creates a new DocStoreSQLiteServer
   * @param options - Configuration options
   */
  constructor(options: DocStoreSQLiteServerOptions) {
    const { dbPath, port = 8080, host = "localhost", origin, perms } = options;

    this.port = port;
    this.host = host;

    debugDocstore(
      `Initializing DocStoreSQLiteServer with database at: ${dbPath}`
    );

    // Initialize the DocStoreSQLite instance
    this.docStore = new DocStoreSQLite(dbPath);

    // Store the permissions interface if provided
    this.perms = perms;

    // Set server origin for auth token validation
    this.serverOrigin = origin || `http://${host}:${port}`;

    // Create an HTTP server
    this.server = http.createServer(
      (req: http.IncomingMessage, res: http.ServerResponse) => {
        res.writeHead(200, { "Content-Type": "text/plain" });
        res.end("DocStoreSQLiteServer is running");
      }
    );

    // Initialize the WebSocket server with noServer option
    this.wss = new WebSocketServer({ noServer: true });

    // Handle upgrade requests
    this.server.on("upgrade", async (request, socket, head) => {
      // Always handle the upgrade without authentication first
      // Authentication will be handled via WebSocket messages if perms is provided
      this.wss.handleUpgrade(request, socket, head, (ws: ExtendedWebSocket) => {
        // Set a flag to indicate if authentication is required
        (ws as any).authRequired = !!this.perms;
        // Set a flag to indicate if the client has authenticated
        (ws as any).authenticated = !this.perms;
        this.wss.emit("connection", ws, request);
      });
    });

    // Set up event handlers
    this.setupWebSocketServer();
  }

  /**
   * Start the server and begin listening for connections
   */
  public start(): void {
    // Start the HTTP server
    this.server.listen(this.port, this.host, () => {
      debugDocstore(`Server listening on ${this.host}:${this.port}`);
    });
  }

  /**
   * Set up WebSocket server event handlers
   */
  private setupWebSocketServer(): void {
    this.wss.on("connection", (ws: ExtendedWebSocket) => {
      debugDocstore("New WebSocket connection established");

      // Add client to the set
      this.clients.add(ws);

      // Set up message handler
      ws.on("message", async (data: Buffer) => {
        try {
          const message = JSON.parse(data.toString()) as WebSocketMessage;

          // Check if authentication is required but not yet completed
          if ((ws as any).authRequired && !(ws as any).authenticated) {
            // Only allow auth messages if not authenticated
            if (message.type !== MessageType.AUTH) {
              debugError(
                "Authentication required: Received non-auth message before authentication"
              );
              this.sendErrorResponse(
                ws,
                message,
                ErrorCode.UNAUTHORIZED,
                "Authentication required"
              );
              ws.close();
              return;
            }

            // Handle auth message
            await this.handleAuthMessage(ws, message);
          } else {
            // Already authenticated or no auth required, process the message
            await this.handleMessage(ws, message);
          }
        } catch (error) {
          debugError("Error parsing message:", error);
          this.sendErrorResponse(
            ws,
            {
              id: "unknown",
              type: MessageType.RESPONSE,
              method: "unknown",
              params: {},
            },
            ErrorCode.INVALID_REQUEST,
            "Invalid message format"
          );
        }
      });

      // Set up close handler
      ws.on("close", () => {
        debugDocstore("WebSocket connection closed");

        // Remove client from the set
        this.clients.delete(ws);

        // Clean up any subscriptions associated with this client
        this.cleanupClientSubscriptions(ws);
      });

      // Set up error handler
      ws.on("error", (error: Error) => {
        debugError("WebSocket error:", error);

        // Remove client from the set
        this.clients.delete(ws);

        // Clean up any subscriptions associated with this client
        this.cleanupClientSubscriptions(ws);
      });
    });

    // Set up server error handler
    this.wss.on("error", (error: Error) => {
      debugError("WebSocket server error:", error);
    });

    debugDocstore("WebSocket server initialized");
  }

  /**
   * Handle incoming WebSocket messages
   * @param ws - WebSocket connection
   * @param message - Parsed message
   */
  /**
   * Handle authentication message
   * @param ws - WebSocket connection
   * @param message - Auth message
   */
  private async handleAuthMessage(
    ws: ExtendedWebSocket,
    message: WebSocketMessage
  ): Promise<void> {
    try {
      // Validate message format
      if (
        !message.id ||
        message.type !== MessageType.AUTH ||
        !message.params.headers
      ) {
        this.sendErrorResponse(
          ws,
          message,
          ErrorCode.INVALID_REQUEST,
          "Invalid auth message format"
        );
        ws.close();
        return;
      }

      // Create AuthRequest from the message
      const authReq: AuthRequest = {
        headers: message.params.headers,
        method: "GET", // Use GET as the method for WebSocket connections
        originalUrl: "/",
        cookies: {},
      };

      // Parse the auth token
      const pubkey = this.perms
        ? await this.perms.parseAuthToken(this.serverOrigin, authReq)
        : await parseAuthToken(this.serverOrigin, authReq);

      // If pubkey is empty, authentication failed
      if (!pubkey) {
        debugError(
          "Authentication failed: Invalid or missing token, message: ",
          message
        );
        this.sendErrorResponse(
          ws,
          message,
          ErrorCode.UNAUTHORIZED,
          "Invalid or missing token"
        );
        ws.close();
        return;
      }

      // Get user_id (this will also validate the user)
      let user_info: UserInfo;
      try {
        user_info = await this.perms!.getUserInfo(pubkey);
      } catch (error) {
        const errorMessage =
          error instanceof Error
            ? error.message
            : "User is not allowed or failed to get user ID";
        debugError(`Authentication failed: ${errorMessage}`);
        this.sendErrorResponse(
          ws,
          message,
          ErrorCode.PERMISSION_DENIED,
          errorMessage
        );
        ws.close();
        return;
      }

      // Authentication successful
      ws.pubkey = pubkey;
      ws.user_info = user_info;
      (ws as any).authenticated = true;

      debugDocstore(
        `Authenticated user ${pubkey} with user_id ${user_info.user_id}`
      );

      // Send success response
      this.sendResponse(ws, {
        id: message.id,
        type: MessageType.RESPONSE,
        method: "auth",
        params: {
          success: true,
        },
      });
    } catch (error) {
      debugError("Authentication error:", error);
      this.sendErrorResponse(
        ws,
        message,
        ErrorCode.INTERNAL_ERROR,
        "Authentication error"
      );
      ws.close();
    }
  }

  private async handleMessage(
    ws: ExtendedWebSocket,
    message: WebSocketMessage
  ): Promise<void> {
    // debugDocstore(`Received message: ${JSON.stringify(message)}`);

    // Validate message format
    if (!message.id || !message.type || !message.method) {
      return this.sendErrorResponse(
        ws,
        message,
        ErrorCode.INVALID_REQUEST,
        "Missing required fields"
      );
    }

    // Check permissions if perms is provided and user_id is available
    if (this.perms && ws.user_info) {
      try {
        // Store the result of checkPerms in the message
        const permsResult = await this.perms.checkPerms(ws.user_info, message);
        message.perms = permsResult || {};
      } catch (error) {
        debugError("Permission check error:", error);
        const errorMessage =
          error instanceof Error
            ? error.message
            : "Permission denied for this operation";
        return this.sendErrorResponse(
          ws,
          message,
          ErrorCode.PERMISSION_DENIED,
          errorMessage
        );
      }
    }

    // Handle message based on type
    switch (message.type) {
      case MessageType.REQUEST:
        await this.handleRequestMessage(ws, message);
        break;
      case MessageType.SUBSCRIPTION:
        await this.handleSubscriptionMessage(ws, message);
        break;
      case MessageType.END:
        this.handleEndMessage(ws, message);
        break;
      default:
        this.sendErrorResponse(
          ws,
          message,
          ErrorCode.INVALID_REQUEST,
          `Invalid message type: ${message.type}`
        );
    }
  }

  /**
   * Handle request messages
   * @param ws - WebSocket connection
   * @param message - Request message
   */
  private async handleRequestMessage(
    ws: ExtendedWebSocket,
    message: WebSocketMessage
  ): Promise<void> {
    // Handle different methods
    switch (message.method) {
      case "upsert":
        await this.handleUpsert(ws, message);
        break;
      case "get":
        await this.handleGet(ws, message);
        break;
      case "delete":
        await this.handleDelete(ws, message);
        break;
      case "createDocstore":
        await this.handleCreateDocstore(ws, message);
        break;
      case "getDocstore":
        await this.handleGetDocstore(ws, message);
        break;
      case "listDocstores":
        await this.handleListDocstores(ws, message);
        break;
      case "deleteDocstore":
        await this.handleDeleteDocstore(ws, message);
        break;
      case "countDocs":
        await this.handleCountDocs(ws, message);
        break;
      default:
        this.sendErrorResponse(
          ws,
          message,
          ErrorCode.METHOD_NOT_FOUND,
          `Method not found: ${message.method}`
        );
    }
  }

  /**
   * Handle subscription messages
   * @param ws - WebSocket connection
   * @param message - Subscription message
   */
  private async handleSubscriptionMessage(
    ws: ExtendedWebSocket,
    message: WebSocketMessage
  ): Promise<void> {
    // Currently only the subscribe method is supported
    if (message.method === "subscribe") {
      await this.handleSubscribe(ws, message);
    } else {
      this.sendErrorResponse(
        ws,
        message,
        ErrorCode.METHOD_NOT_FOUND,
        `Subscription method not found: ${message.method}`
      );
    }
  }

  /**
   * Handle end messages
   * @param ws - WebSocket connection
   * @param message - End message
   */
  private handleEndMessage(
    ws: ExtendedWebSocket,
    message: WebSocketMessage
  ): void {
    // Currently only ending subscriptions is supported
    if (message.method === "subscribe") {
      this.handleEndSubscription(ws, message);
    } else {
      this.sendErrorResponse(
        ws,
        message,
        ErrorCode.METHOD_NOT_FOUND,
        `End method not found: ${message.method}`
      );
    }
  }

  /**
   * Handle upsert method
   * @param ws - WebSocket connection
   * @param message - Request message
   */
  /**
   * Convert regular arrays to Float32Array for embeddings
   * @param doc - Document with potentially regular array embeddings
   * @returns Document with Float32Array embeddings
   */
  private prepareDocForUpsert(doc: any): Doc {
    const result = { ...doc } as Doc;

    // Convert regular arrays to Float32Array for embeddings
    if (Array.isArray(result.embeddings)) {
      result.embeddings = result.embeddings.map((embedding: any) => {
        if (Array.isArray(embedding)) {
          return new Float32Array(embedding);
        }
        return embedding;
      });
    }

    return result;
  }

  /**
   * Convert Float32Array to regular arrays for serialization
   * @param doc - Document with Float32Array embeddings
   * @returns Document with regular array embeddings for serialization
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

    return result;
  }

  private async handleUpsert(
    ws: ExtendedWebSocket,
    message: WebSocketMessage
  ): Promise<void> {
    try {
      // Validate parameters
      if (!message.params.doc) {
        return this.sendErrorResponse(
          ws,
          message,
          ErrorCode.INVALID_PARAMS,
          "Missing doc parameter"
        );
      }

      const rawDoc = message.params.doc;

      // Validate doc fields
      if (
        !rawDoc.id ||
        !rawDoc.docstore_id ||
        !rawDoc.type ||
        rawDoc.timestamp === undefined
      ) {
        return this.sendErrorResponse(
          ws,
          message,
          ErrorCode.INVALID_PARAMS,
          "Invalid doc object"
        );
      }

      // Set created_at if not provided
      if (rawDoc.created_at === undefined) {
        rawDoc.created_at = Math.floor(Date.now() / 1000);
      }

      // Set user_id if available in the WebSocket connection
      if (ws.user_info) {
        rawDoc.user_id = ws.user_info.user_id;
      }

      // Convert regular arrays to Float32Array for embeddings
      const doc = this.prepareDocForUpsert(rawDoc);

      // Upsert the document with user_id from WebSocket connection
      await this.docStore.upsert(doc, ws.user_info?.user_id);

      // Send success response
      this.sendResponse(ws, {
        id: message.id,
        type: MessageType.RESPONSE,
        method: message.method,
        params: {
          success: true,
        },
      });
    } catch (error: unknown) {
      debugError("Error in upsert:", error);
      const errorMessage =
        error instanceof Error ? error.message : "Unknown error";
      this.sendErrorResponse(
        ws,
        message,
        ErrorCode.INTERNAL_ERROR,
        `Error upserting document: ${errorMessage}`
      );
    }
  }

  /**
   * Handle get method
   * @param ws - WebSocket connection
   * @param message - Request message
   */
  private async handleGet(
    ws: ExtendedWebSocket,
    message: WebSocketMessage
  ): Promise<void> {
    try {
      // Validate parameters
      if (!message.params.docstore_id || !message.params.doc_id) {
        return this.sendErrorResponse(
          ws,
          message,
          ErrorCode.INVALID_PARAMS,
          "Missing docstore_id or doc_id parameter"
        );
      }

      // Get the document
      const doc = await this.docStore.get(
        message.params.docstore_id,
        message.params.doc_id,
        ws.user_info?.user_id
      );

      if (!doc) {
        return this.sendErrorResponse(
          ws,
          message,
          ErrorCode.DOCUMENT_NOT_FOUND,
          "Document not found"
        );
      }

      // Prepare the document for serialization
      const serializedDoc = this.prepareDocForSerialization(doc);

      // Send response with the serialized document
      this.sendResponse(ws, {
        id: message.id,
        type: MessageType.RESPONSE,
        method: message.method,
        params: {
          doc: serializedDoc,
        },
      });
    } catch (error: unknown) {
      debugError("Error in get:", error);
      const errorMessage =
        error instanceof Error ? error.message : "Unknown error";
      this.sendErrorResponse(
        ws,
        message,
        ErrorCode.INTERNAL_ERROR,
        `Error getting document: ${errorMessage}`
      );
    }
  }

  /**
   * Handle delete method
   * @param ws - WebSocket connection
   * @param message - Request message
   */
  private async handleDelete(
    ws: ExtendedWebSocket,
    message: WebSocketMessage
  ): Promise<void> {
    try {
      // Validate parameters
      if (!message.params.docstore_id || !message.params.doc_id) {
        return this.sendErrorResponse(
          ws,
          message,
          ErrorCode.INVALID_PARAMS,
          "Missing docstore_id or doc_id parameter"
        );
      }

      // Delete the document
      const success = await this.docStore.delete(
        message.params.docstore_id,
        message.params.doc_id,
        ws.user_info?.user_id
      );

      // Send response
      this.sendResponse(ws, {
        id: message.id,
        type: MessageType.RESPONSE,
        method: message.method,
        params: {
          success,
        },
      });
    } catch (error: unknown) {
      debugError("Error in delete:", error);
      const errorMessage =
        error instanceof Error ? error.message : "Unknown error";
      this.sendErrorResponse(
        ws,
        message,
        ErrorCode.INTERNAL_ERROR,
        `Error deleting document: ${errorMessage}`
      );
    }
  }

  /**
   * Handle createDocstore method
   * @param ws - WebSocket connection
   * @param message - Request message
   */
  private async handleCreateDocstore(
    ws: ExtendedWebSocket,
    message: WebSocketMessage
  ): Promise<void> {
    try {
      // Validate parameters
      if (!message.params.name) {
        return this.sendErrorResponse(
          ws,
          message,
          ErrorCode.INVALID_PARAMS,
          "Missing name parameter"
        );
      }

      // Create the docstore
      const id = await this.docStore.createDocstore(
        message.params.name,
        message.params.model || "",
        message.params.vector_size || 0,
        message.params.options || "",
        ws.user_info?.user_id
      );

      // If perms is provided and pubkey is available, update the docstore with user_id
      if (this.perms && ws.pubkey) {
        try {
          // Get the docstore
          const docstore = await this.docStore.getDocstore(id);

          if (docstore) {
            // Use the user_id from the WebSocket connection
            if (ws.user_info) {
              // Update the docstore with user_id
              // Note: We need to add a method to update docstore in DocStoreSQLite
              // For now, we'll use a workaround by directly updating the docstore in the database
              const stmt = this.docStore["db"].prepare(
                "UPDATE docstores SET user_id = ? WHERE id = ?"
              );
              stmt.run(ws.user_info.user_id, id);
            }
          }
        } catch (error) {
          debugError("Error updating docstore with user_id:", error);
          // Continue without user_id if there's an error
        }
      }

      // Send response with the docstore ID
      this.sendResponse(ws, {
        id: message.id,
        type: MessageType.RESPONSE,
        method: message.method,
        params: {
          id,
        },
      });
    } catch (error: unknown) {
      debugError("Error in createDocstore:", error);
      const errorMessage =
        error instanceof Error ? error.message : "Unknown error";
      this.sendErrorResponse(
        ws,
        message,
        ErrorCode.INTERNAL_ERROR,
        `Error creating docstore: ${errorMessage}`
      );
    }
  }

  /**
   * Handle getDocstore method
   * @param ws - WebSocket connection
   * @param message - Request message
   */
  private async handleGetDocstore(
    ws: ExtendedWebSocket,
    message: WebSocketMessage
  ): Promise<void> {
    try {
      // Validate parameters
      if (!message.params.id) {
        return this.sendErrorResponse(
          ws,
          message,
          ErrorCode.INVALID_PARAMS,
          "Missing id parameter"
        );
      }

      // Get the docstore
      const docstore = await this.docStore.getDocstore(
        message.params.id,
        ws.user_info?.user_id
      );

      if (!docstore) {
        return this.sendErrorResponse(
          ws,
          message,
          ErrorCode.DOCSTORE_NOT_FOUND,
          "Docstore not found"
        );
      }

      // Send response with the docstore
      this.sendResponse(ws, {
        id: message.id,
        type: MessageType.RESPONSE,
        method: message.method,
        params: {
          docstore,
        },
      });
    } catch (error: unknown) {
      debugError("Error in getDocstore:", error);
      const errorMessage =
        error instanceof Error ? error.message : "Unknown error";
      this.sendErrorResponse(
        ws,
        message,
        ErrorCode.INTERNAL_ERROR,
        `Error getting docstore: ${errorMessage}`
      );
    }
  }

  /**
   * Handle listDocstores method
   * @param ws - WebSocket connection
   * @param message - Request message
   */
  private async handleListDocstores(
    ws: ExtendedWebSocket,
    message: WebSocketMessage
  ): Promise<void> {
    try {
      let docstores: DocStore[];

      // Check if we have listIds in the message perms object
      if (message.perms?.listIds && message.perms.listIds.length > 0) {
        // List docstores by IDs with user_id
        docstores = await this.docStore.listDocStoresByIds(
          message.perms.listIds,
          ws.user_info?.user_id
        );
        debugDocstore(
          `Listing docstores by IDs: ${message.perms.listIds.join(", ")}`
        );
      } else {
        // List all docstores with user_id
        docstores = await this.docStore.listDocstores(ws.user_info?.user_id);
        debugDocstore("Listing all docstores");
      }

      // Send response with the docstores
      this.sendResponse(ws, {
        id: message.id,
        type: MessageType.RESPONSE,
        method: message.method,
        params: {
          docstores,
        },
      });
    } catch (error: unknown) {
      debugError("Error in listDocstores:", error);
      const errorMessage =
        error instanceof Error ? error.message : "Unknown error";
      this.sendErrorResponse(
        ws,
        message,
        ErrorCode.INTERNAL_ERROR,
        `Error listing docstores: ${errorMessage}`
      );
    }
  }

  /**
   * Handle deleteDocstore method
   * @param ws - WebSocket connection
   * @param message - Request message
   */
  private async handleDeleteDocstore(
    ws: ExtendedWebSocket,
    message: WebSocketMessage
  ): Promise<void> {
    try {
      // Validate parameters
      if (!message.params.id) {
        return this.sendErrorResponse(
          ws,
          message,
          ErrorCode.INVALID_PARAMS,
          "Missing id parameter"
        );
      }

      // Delete the docstore
      const success = await this.docStore.deleteDocstore(
        message.params.id,
        ws.user_info?.user_id
      );

      // Send response
      this.sendResponse(ws, {
        id: message.id,
        type: MessageType.RESPONSE,
        method: message.method,
        params: {
          success,
        },
      });
    } catch (error: unknown) {
      debugError("Error in deleteDocstore:", error);
      const errorMessage =
        error instanceof Error ? error.message : "Unknown error";
      this.sendErrorResponse(
        ws,
        message,
        ErrorCode.INTERNAL_ERROR,
        `Error deleting docstore: ${errorMessage}`
      );
    }
  }

  /**
   * Handle countDocs method
   * @param ws - WebSocket connection
   * @param message - Request message
   */
  private async handleCountDocs(
    ws: ExtendedWebSocket,
    message: WebSocketMessage
  ): Promise<void> {
    try {
      // Validate parameters
      if (!message.params.docstore_id) {
        return this.sendErrorResponse(
          ws,
          message,
          ErrorCode.INVALID_PARAMS,
          "Missing docstore_id parameter"
        );
      }

      // Count the documents
      const count = await this.docStore.countDocs(
        message.params.docstore_id,
        ws.user_info?.user_id
      );

      // Send response with the count
      this.sendResponse(ws, {
        id: message.id,
        type: MessageType.RESPONSE,
        method: message.method,
        params: {
          count,
        },
      });
    } catch (error: unknown) {
      debugError("Error in countDocs:", error);
      const errorMessage =
        error instanceof Error ? error.message : "Unknown error";
      this.sendErrorResponse(
        ws,
        message,
        ErrorCode.INTERNAL_ERROR,
        `Error counting documents: ${errorMessage}`
      );
    }
  }

  /**
   * Handle subscribe method
   * @param ws - WebSocket connection
   * @param message - Subscription message
   */
  private async handleSubscribe(
    ws: ExtendedWebSocket,
    message: WebSocketMessage
  ): Promise<void> {
    try {
      // Validate parameters
      if (!message.params.docstore_id) {
        return this.sendErrorResponse(
          ws,
          message,
          ErrorCode.INVALID_PARAMS,
          "Missing docstore_id parameter"
        );
      }

      // Create a subscription ID based on the message ID
      const subscriptionId = message.id;

      // Check if this subscription already exists
      if (this.subscriptions.has(subscriptionId)) {
        return this.sendErrorResponse(
          ws,
          message,
          ErrorCode.INVALID_REQUEST,
          "Subscription already exists"
        );
      }

      // Create the subscription
      const subscription = await this.docStore.subscribe(
        {
          docstore_id: message.params.docstore_id,
          type: message.params.type,
          since: message.params.since,
          until: message.params.until,
          user_id: ws.user_info?.user_id,
        },
        async (doc?: Doc) => {
          try {
            if (doc) {
              // Prepare the document for serialization (convert Float32Array to regular arrays)
              const serializedDoc = this.prepareDocForSerialization(doc);

              // Send document message
              this.sendResponse(ws, {
                id: subscriptionId,
                type: MessageType.DOCUMENT,
                method: "subscribe",
                params: {
                  doc: serializedDoc,
                },
              });
            } else {
              // Send EOF message
              this.sendResponse(ws, {
                id: subscriptionId,
                type: MessageType.DOCUMENT,
                method: "subscribe",
                params: {
                  eof: true,
                },
              });
            }
          } catch (error) {
            debugError("Error in subscription callback:", error);
          }
        }
      );

      // Store the subscription
      this.subscriptions.set(subscriptionId, subscription);

      // Associate the subscription with the WebSocket connection
      if (!ws.subscriptions) {
        ws.subscriptions = new Set<string>();
      }
      ws.subscriptions.add(subscriptionId);

      debugDocstore(
        `Created subscription ${subscriptionId} for docstore ${message.params.docstore_id}`
      );
    } catch (error: unknown) {
      debugError("Error in subscribe:", error);
      const errorMessage =
        error instanceof Error ? error.message : "Unknown error";
      this.sendErrorResponse(
        ws,
        message,
        ErrorCode.INTERNAL_ERROR,
        `Error creating subscription: ${errorMessage}`
      );
    }
  }

  /**
   * Handle end subscription message
   * @param ws - WebSocket connection
   * @param message - End message
   */
  private handleEndSubscription(
    ws: ExtendedWebSocket,
    message: WebSocketMessage
  ): void {
    try {
      const subscriptionId = message.id;

      // Check if the subscription exists
      if (!this.subscriptions.has(subscriptionId)) {
        return this.sendErrorResponse(
          ws,
          message,
          ErrorCode.INVALID_REQUEST,
          "Subscription not found"
        );
      }

      // Close the subscription
      const subscription = this.subscriptions.get(subscriptionId);
      if (subscription) {
        subscription.close();
      }

      // Remove the subscription
      this.subscriptions.delete(subscriptionId);

      // Remove the subscription from the WebSocket connection
      if (ws.subscriptions) {
        ws.subscriptions.delete(subscriptionId);
      }

      debugDocstore(`Closed subscription ${subscriptionId}`);

      // Send success response
      this.sendResponse(ws, {
        id: message.id,
        type: MessageType.RESPONSE,
        method: message.method,
        params: {
          success: true,
        },
      });
    } catch (error: unknown) {
      debugError("Error in endSubscription:", error);
      const errorMessage =
        error instanceof Error ? error.message : "Unknown error";
      this.sendErrorResponse(
        ws,
        message,
        ErrorCode.INTERNAL_ERROR,
        `Error ending subscription: ${errorMessage}`
      );
    }
  }

  /**
   * Clean up subscriptions associated with a WebSocket connection
   * @param ws - WebSocket connection
   */
  private cleanupClientSubscriptions(ws: ExtendedWebSocket): void {
    if (ws.subscriptions) {
      for (const subscriptionId of ws.subscriptions) {
        if (this.subscriptions.has(subscriptionId)) {
          const subscription = this.subscriptions.get(subscriptionId);
          if (subscription) {
            subscription.close();
          }
          this.subscriptions.delete(subscriptionId);
          debugDocstore(`Cleaned up subscription ${subscriptionId}`);
        }
      }
      ws.subscriptions.clear();
    }
  }

  /**
   * Send a response message
   * @param ws - WebSocket connection
   * @param message - Response message
   */
  private sendResponse(ws: ExtendedWebSocket, message: WebSocketMessage): void {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(message));
    }
  }

  /**
   * Send an error response
   * @param ws - WebSocket connection
   * @param originalMessage - Original message that caused the error
   * @param code - Error code
   * @param message - Error message
   */
  private sendErrorResponse(
    ws: ExtendedWebSocket,
    originalMessage: WebSocketMessage,
    code: ErrorCode,
    message: string
  ): void {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(
        JSON.stringify({
          id: originalMessage.id,
          type: MessageType.RESPONSE,
          method: originalMessage.method,
          error: {
            code,
            message,
          },
        })
      );
    }
  }

  /**
   * Close the server and release resources
   */
  public close(): void {
    debugDocstore("Closing DocStoreSQLiteServer");

    // Close all subscriptions
    for (const subscription of this.subscriptions.values()) {
      subscription.close();
    }
    this.subscriptions.clear();

    // Close all WebSocket connections
    for (const client of this.clients) {
      client.close();
    }
    this.clients.clear();

    // Close the WebSocket server and HTTP server
    this.wss.close();
    this.server.close();

    // Release DocStoreSQLite resources
    this.docStore[Symbol.dispose]();

    debugDocstore("DocStoreSQLiteServer closed");
  }
}
