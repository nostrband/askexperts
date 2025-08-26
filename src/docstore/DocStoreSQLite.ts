import { DatabaseSync } from "node:sqlite";
import { Doc, DocStore, Subscription } from "./interfaces.js";
import crypto from "crypto";
import { debugDocstore, debugError } from "../common/debug.js";

/**
 * SQLite implementation
 */
export class DocStoreSQLite {
  private db: DatabaseSync;
  private readonly BATCH_SIZE = 1000;
  private readonly RETRY_INTERVAL_MS = 10000; // 10 seconds

  /**
   * Creates a new DocStoreSQLite instance
   * @param dbPath - Path to the SQLite database file
   */
  constructor(dbPath: string) {
    debugDocstore(`Initializing DocStoreSQLite with database at: ${dbPath}`);
    this.db = new DatabaseSync(dbPath);
    this.initDatabase();
  }

  /**
   * Initialize the database by creating required tables if they don't exist
   */
  private initDatabase(): void {

    // Allow concurrent readers
    this.db.exec('PRAGMA journal_mode = WAL;');
    // Wait up to 3 seconds for locks
    this.db.exec('PRAGMA busy_timeout = 3000;');

    // Create docstores table with new fields for embeddings model
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS docstores (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        timestamp INTEGER NOT NULL,
        model TEXT,
        vector_size INTEGER,
        options TEXT
      )
    `);

    // Create docs table with auto-incremented aid field and BLOB for embeddings
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS docs (
        aid INTEGER PRIMARY KEY AUTOINCREMENT,
        id TEXT NOT NULL,
        docstore_id TEXT NOT NULL,
        timestamp INTEGER NOT NULL,
        created_at INTEGER NOT NULL,
        type TEXT NOT NULL,
        data TEXT NOT NULL,
        embeddings BLOB,
        file BLOB,
        metadata TEXT DEFAULT '',
        UNIQUE(docstore_id, id)
      )
    `);

    // Create indexes for better query performance
    this.db.exec(
      "CREATE INDEX IF NOT EXISTS idx_docs_docstore_id ON docs (docstore_id)"
    );
    this.db.exec(
      "CREATE INDEX IF NOT EXISTS idx_docs_timestamp ON docs (timestamp)"
    );
    this.db.exec("CREATE INDEX IF NOT EXISTS idx_docs_type ON docs (type)");

    // Migration: Add user_id column to docstores table if it doesn't exist
    try {
      // Check if user_id column exists in docstores table
      const docstoreColumns = this.db.prepare("PRAGMA table_info(docstores)").all();
      const hasUserIdColumn = docstoreColumns.some((col: any) => col.name === 'user_id');
      
      if (!hasUserIdColumn) {
        debugDocstore("Adding user_id column to docstores table");
        this.db.exec("ALTER TABLE docstores ADD COLUMN user_id TEXT NOT NULL DEFAULT ''");
        this.db.exec("CREATE INDEX IF NOT EXISTS idx_docstores_user_id ON docstores (user_id)");
      }
    } catch (error) {
      debugError("Error adding user_id column to docstores table:", error);
    }

    // Migration: Add user_id column to docs table if it doesn't exist
    try {
      // Check if user_id column exists in docs table
      const docsColumns = this.db.prepare("PRAGMA table_info(docs)").all();
      const hasUserIdColumn = docsColumns.some((col: any) => col.name === 'user_id');
      
      if (!hasUserIdColumn) {
        debugDocstore("Adding user_id column to docs table");
        this.db.exec("ALTER TABLE docs ADD COLUMN user_id TEXT NOT NULL DEFAULT ''");
        this.db.exec("CREATE INDEX IF NOT EXISTS idx_docs_user_id ON docs (user_id)");
      }
    } catch (error) {
      debugError("Error adding user_id column to docs table:", error);
    }

    // Migration: Add file column to docs table if it doesn't exist
    try {
      // Check if file column exists in docs table
      const docsColumns = this.db.prepare("PRAGMA table_info(docs)").all();
      const hasFileColumn = docsColumns.some((col: any) => col.name === 'file');
      
      if (!hasFileColumn) {
        debugDocstore("Adding file column to docs table");
        this.db.exec("ALTER TABLE docs ADD COLUMN file BLOB");
      }
    } catch (error) {
      debugError("Error adding file column to docs table:", error);
    }

    // Migration: Add metadata column to docs table if it doesn't exist
    try {
      // Check if metadata column exists in docs table
      const docsColumns = this.db.prepare("PRAGMA table_info(docs)").all();
      const hasMetadataColumn = docsColumns.some((col: any) => col.name === 'metadata');
      
      if (!hasMetadataColumn) {
        debugDocstore("Adding metadata column to docs table");
        this.db.exec("ALTER TABLE docs ADD COLUMN metadata TEXT NOT NULL DEFAULT ''");
      }
    } catch (error) {
      debugError("Error adding metadata column to docs table:", error);
    }
  }

  /**
   * Subscribe to documents in a docstore with batched queries
   * @param docstore_id - ID of the docstore to subscribe to
   * @param type - Type of documents to filter by
   * @param since - Start timestamp for filtering documents
   * @param until - End timestamp for filtering documents
   * @param onDoc - Callback function to handle each document
   * @returns Subscription object to manage the subscription
   */
  async subscribe(
    options: {
      docstore_id: string;
      type?: string;
      since?: number;
      until?: number;
      user_id?: string;
    },
    onDoc: (doc?: Doc) => Promise<void>
  ): Promise<Subscription> {
    let isActive = true;
    let pauseTimeout: any;
    let lastAid = 0; // Use aid for pagination instead of id
    const { docstore_id, type, since, until, user_id } = options;
    
    debugDocstore(`Subscribing to docstore: ${docstore_id}, type: ${type || 'all'}, since: ${since || 'beginning'}, until: ${until || 'now'}, user_id: ${user_id || 'all'}`);

    // Function to convert row to Doc interface
    const rowToDoc = (row: Record<string, any>): Doc => {
      // Convert embeddings from BLOB to Float32Array[]
      let embeddingsArray: Float32Array[] = [];
      if (row.embeddings) {
        embeddingsArray = this.blobToFloat32Arrays(row.embeddings as Buffer, row.docstore_id.toString());
      }
  
      return {
        id: row.id?.toString() || "",
        docstore_id: row.docstore_id?.toString() || "",
        timestamp: Number(row.timestamp || 0),
        created_at: Number(row.created_at || 0),
        type: row.type?.toString() || "",
        data: row.data?.toString() || "",
        embeddings: embeddingsArray,
        user_id: row.user_id?.toString() || "",
        file: row.file ? (row.file as Buffer) : undefined,
        metadata: row.metadata?.toString() || "",
        // aid is not included in the returned Doc object as it's an internal implementation detail
      };
    };

    // Function to fetch a batch of documents
    const fetchBatch = async () => {
      if (!isActive) return;

      // Build query dynamically based on provided filters
      let query = `
        SELECT * FROM docs
        WHERE docstore_id = ?
      `;

      const queryParams: any[] = [docstore_id];

      // Add user_id filter if defined
      if (user_id !== undefined) {
        query += ` AND user_id = ?`;
        queryParams.push(user_id);
      }

      // Add type filter if defined
      if (type !== undefined) {
        query += ` AND type = ?`;
        queryParams.push(type);
      }

      // Add since filter if defined
      if (since !== undefined) {
        query += ` AND timestamp >= ?`;
        queryParams.push(since);
      }

      // Add until filter if defined
      if (until !== undefined) {
        query += ` AND timestamp <= ?`;
        queryParams.push(until);
      }

      // Use aid for pagination instead of id
      query += `
        AND aid > ?
        ORDER BY aid ASC
        LIMIT ?
      `;

      queryParams.push(lastAid, this.BATCH_SIZE);

      const stmt = this.db.prepare(query);
      const rows = stmt.all(...queryParams);

      // Process the batch sequentially to respect backpressure
      for (let i = 0; i < rows.length; i++) {
        if (!isActive) return;

        const row = rows[i];
        const doc = rowToDoc(row);

        await onDoc(doc);
        // Ensure lastAid is always a number
        lastAid = row.aid ? Number(row.aid) : 0;
      }

      // onDoc might close the sub

      // Not full batch returned, signal EOF
      if (isActive && rows.length < this.BATCH_SIZE)
        await onDoc(undefined);

      // Schedule next batch
      if (isActive) {
        // If we got a partial batch, wait before checking for new docs
        if (rows.length < this.BATCH_SIZE) {
          pauseTimeout = setTimeout(() => fetchBatch(), this.RETRY_INTERVAL_MS);
        } else {
          // If we got a full batch, immediately fetch the next batch.
          // Use setImmediate to avoid stack overflow with large result sets
          setImmediate(() => fetchBatch());
        }
      }
    };

    // Start fetching documents asynchronously to let this
    // function return the subscription which might be
    // accessed in onDoc callback
    setImmediate(async () => {
      try {
        await fetchBatch();
      } catch (err) {
        debugError("Error in DocStoreSQLite subscription:", err);
      }
    });

    // Create subscription object with close method
    const subscription = {
      close: () => {
        isActive = false;
        if (pauseTimeout) clearTimeout(pauseTimeout);
      },
    };
    
    // Return Promise that resolves with the subscription
    return Promise.resolve(subscription);
  }

  /**
   * Upsert a document in the store using a single atomic operation
   * @param doc - Document to upsert
   */
  /**
   * Convert Float32Array[] to a single Uint8Array for storage
   * @param embeddings - Array of Float32Array embeddings
   * @param vectorSize - Size of each embedding vector
   * @returns Uint8Array containing all embeddings
   */
  private float32ArraysToBlob(embeddings: Float32Array[], vector_size: number): Uint8Array {
    // Check that we don't exceed the maximum number of vectors (2^16)
    if (embeddings.length >= (1 << 16)) {
      throw new Error(`Too many embeddings: ${embeddings.length}, maximum is ${(1 << 16) - 1}`);
    }

    // Check that each embedding has the correct size
    for (let i = 0; i < embeddings.length; i++) {
      if (embeddings[i].length !== vector_size) {
        throw new Error(`Embedding at index ${i} has incorrect size: ${embeddings[i].length}, expected ${vector_size}`);
      }
    }

    // Calculate total size: 2 bytes for count + (vector_size * 4 bytes per float32) * number of embeddings
    const totalSize = 2 + (vector_size * 4 * embeddings.length);
    const result = new Uint8Array(totalSize);
    
    // Write number of vectors as uint16 (2 bytes)
    result[0] = embeddings.length & 0xFF;
    result[1] = (embeddings.length >> 8) & 0xFF;
    
    // Write each embedding
    let offset = 2;
    for (const embedding of embeddings) {
      const byteArray = new Uint8Array(embedding.buffer);
      result.set(byteArray, offset);
      offset += byteArray.length;
    }
    
    return result;
  }

  /**
   * Convert a Uint8Array blob back to an array of Float32Array embeddings
   * @param blob - Uint8Array blob containing embeddings
   * @param docstore_id - ID of the docstore the blob belongs to
   * @returns Array of Float32Array embeddings
   */
  private blobToFloat32Arrays(blob: Buffer | Uint8Array, docstore_id: string): Float32Array[] {
    // Get the docstore to determine vector_size
    const docstore = this.getDocstoreSync(docstore_id);
    if (!docstore || !docstore.vector_size) {
      return [];
    }
    
    const vector_size = docstore.vector_size;
    
    // Validate blob size - ensure it has at least 2 bytes
    if (!blob || blob.length < 2) {
      debugError(`Invalid blob size: ${blob ? blob.length : 'null'}, expected at least 2 bytes`);
      return [];
    }
    
    // Parse the blob
    // First 2 bytes are the count of vectors
    const count = blob[0] | (blob[1] << 8);
    
    // Each vector is vector_size * 4 bytes (4 bytes per float32)
    const bytesPerVector = vector_size * 4;
    
    // Calculate expected blob size
    const expectedSize = 2 + (count * bytesPerVector);
    
    // Validate blob size - ensure it has the expected size
    if (blob.length !== expectedSize) {
      debugError(`Invalid blob size: ${blob.length}, expected ${expectedSize} bytes for ${count} vectors of size ${vector_size}`);
      return [];
    }
    
    // Create an array to hold the embeddings
    const embeddings: Float32Array[] = [];
    
    // Extract each embedding
    let offset = 2;
    for (let i = 0; i < count; i++) {
      // Create a view into the blob for this embedding using subarray
      const vectorBytes = blob.subarray(offset, offset + bytesPerVector);
      
      // Convert to Float32Array
      const embedding = new Float32Array(vectorBytes.buffer.slice(vectorBytes.byteOffset, vectorBytes.byteOffset + vectorBytes.byteLength));
      
      embeddings.push(embedding);
      offset += bytesPerVector;
    }
    
    return embeddings;
  }

  // This method is no longer needed as we pass docstore_id directly to blobToFloat32Arrays

  /**
   * Get a docstore by ID
   * @param id - ID of the docstore to get
   * @returns The docstore if found, null otherwise
   */
  getDocstoreSync(id: string, user_id?: string): DocStore | undefined {
    let query = "SELECT * FROM docstores WHERE id = ?";
    const params = [id];
    
    // Add user_id filter if provided
    if (user_id !== undefined) {
      query += " AND user_id = ?";
      params.push(user_id);
    }
    
    const stmt = this.db.prepare(query);
    const row = stmt.get(...params);
    
    if (!row) {
      return undefined;
    }
    
    return {
      id: String(row.id || ""),
      name: String(row.name || ""),
      timestamp: Number(row.timestamp || 0),
      model: String(row.model || ""),
      vector_size: Number(row.vector_size || 0),
      options: String(row.options || ""),
      user_id: String(row.user_id || "")
    };
  }

  async getDocstore(id: string, user_id?: string): Promise<DocStore | undefined> {
    return Promise.resolve(this.getDocstoreSync(id, user_id));
  }

  async upsert(doc: Doc, user_id?: string): Promise<void> {
    debugDocstore(`Upserting document: ${doc.id} in docstore: ${doc.docstore_id}, type: ${doc.type}, user_id: ${user_id || doc.user_id || 'none'}`);

    if (user_id && doc.user_id !== user_id) throw new Error("Wrong doc user");

    // Get the docstore to check vector_size
    const docstore = this.getDocstoreSync(doc.docstore_id);
    if (!docstore) {
      throw new Error(`Docstore not found: ${doc.docstore_id}`);
    }
    
    if (!docstore.vector_size) {
      throw new Error(`Docstore ${doc.docstore_id} has no vector_size defined`);
    }
    
    // Convert embeddings to blob if present
    let embeddingsBlob: Uint8Array | null = null;
    if (doc.embeddings && doc.embeddings.length > 0) {
      embeddingsBlob = this.float32ArraysToBlob(doc.embeddings, docstore.vector_size);
    }
    
    // Use INSERT OR REPLACE to handle both insert and update in a single atomic operation
    const stmt = this.db.prepare(`
      INSERT OR REPLACE INTO docs (
        id, docstore_id, timestamp, created_at, type, data, embeddings, user_id, file, metadata
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    stmt.run(
      doc.id,
      doc.docstore_id,
      doc.timestamp,
      doc.created_at,
      doc.type,
      doc.data,
      embeddingsBlob,
      user_id || doc.user_id || "",
      doc.file || null,
      doc.metadata || ""
    );
    
    return Promise.resolve();
  }

  /**
   * Get a document by ID
   * @param docstore_id - ID of the docstore containing the document
   * @param doc_id - ID of the document to get
   * @returns The document if found, null otherwise
   */
  async get(docstore_id: string, doc_id: string, user_id?: string): Promise<Doc | null> {
    let query = "SELECT * FROM docs WHERE docstore_id = ? AND id = ?";
    const params = [docstore_id, doc_id];
    
    // Add user_id filter if provided
    if (user_id !== undefined) {
      query += " AND user_id = ?";
      params.push(user_id);
    }
    
    const stmt = this.db.prepare(query);
    const row = stmt.get(...params);

    if (!row) {
      return Promise.resolve(null);
    }

    // Convert embeddings from BLOB to Float32Array[]
    let embeddingsArray: Float32Array[] = [];
    if (row.embeddings) {
      embeddingsArray = this.blobToFloat32Arrays(row.embeddings as Buffer, docstore_id);
    }

    // Convert row to Doc interface
    const doc = {
      id: row.id?.toString() || "",
      docstore_id: row.docstore_id?.toString() || "",
      timestamp: Number(row.timestamp || 0),
      created_at: Number(row.created_at || 0),
      type: row.type?.toString() || "",
      data: row.data?.toString() || "",
      embeddings: embeddingsArray,
      user_id: row.user_id?.toString() || "",
      file: row.file ? (row.file as Buffer) : undefined,
      metadata: row.metadata?.toString() || "",
    };
    
    return Promise.resolve(doc);
  }

  /**
   * Delete a document from the store
   * @param docstore_id - ID of the docstore containing the document
   * @param doc_id - ID of the document to delete
   * @returns true if document existed and was deleted, false otherwise
   */
  async delete(docstore_id: string, doc_id: string, user_id?: string): Promise<boolean> {
    let query = "DELETE FROM docs WHERE docstore_id = ? AND id = ?";
    const params = [docstore_id, doc_id];
    
    // Add user_id filter if provided
    if (user_id !== undefined) {
      query += " AND user_id = ?";
      params.push(user_id);
    }
    
    const stmt = this.db.prepare(query);
    const result = stmt.run(...params);

    // Return true if a row was affected (document was deleted)
    return Promise.resolve(result.changes > 0);
  }

  /**
   * Create a new docstore if one with the given name doesn't exist
   * @param name - Name of the docstore to create
   * @param model - Name of the embeddings model
   * @param vector_size - Size of embedding vectors
   * @param options - Options for the model, defaults to empty string
   * @returns Promise that resolves with the ID of the created or existing docstore
   */
  async createDocstore(name: string, model: string = "", vector_size: number = 0, options: string = "", user_id?: string): Promise<string> {
    debugDocstore(`Creating docstore with name: ${name}, model: ${model}, vector_size: ${vector_size}, user_id: ${user_id || 'none'}`);
    // Check if docstore with this name already exists
    let query = "SELECT id FROM docstores WHERE name = ?";
    const params = [name];
    
    // Add user_id filter if provided
    if (user_id !== undefined) {
      query += " AND user_id = ?";
      params.push(user_id);
    }
    
    const existingDocstore = this.db
      .prepare(query)
      .get(...params);

    if (existingDocstore && existingDocstore.id !== null) {
      debugDocstore(`Docstore with name ${name} already exists with ID: ${existingDocstore.id}`);
      return Promise.resolve(existingDocstore.id.toString());
    }

    // Create new docstore with UUID
    const timestamp = Math.floor(Date.now() / 1000);
    const id = crypto.randomUUID();

    const stmt = this.db.prepare(
      "INSERT INTO docstores (id, name, timestamp, model, vector_size, options, user_id) VALUES (?, ?, ?, ?, ?, ?, ?)"
    );

    stmt.run(id, name, timestamp, model, vector_size, options, user_id || "");
    debugDocstore(`Created new docstore with name: ${name}, ID: ${id}, model: ${model}, vector_size: ${vector_size}`);
    return Promise.resolve(id);
  }

  /**
   * List all docstores
   * @returns Promise that resolves with an array of docstore objects
   */
  async listDocstores(user_id?: string): Promise<DocStore[]> {
    let query = "SELECT * FROM docstores";
    const params: any[] = [];
    
    // Add user_id filter if provided
    if (user_id !== undefined) {
      query += " WHERE user_id = ?";
      params.push(user_id);
    }
    
    query += " ORDER BY id ASC";
    
    const stmt = this.db.prepare(query);
    const rows = stmt.all(...params);

    const docstores = rows.map(
      (row: Record<string, any>): DocStore => ({
        id: String(row.id || ""),
        name: String(row.name || ""),
        timestamp: Number(row.timestamp || 0),
        model: String(row.model || ""),
        vector_size: Number(row.vector_size || 0),
        options: String(row.options || ""),
        user_id: String(row.user_id || ""),
      })
    );
    
    return Promise.resolve(docstores);
  }

  /**
   * List docstores by specific IDs
   * @param ids - Array of docstore IDs to retrieve
   * @returns Promise that resolves with an array of docstore objects
   */
  async listDocStoresByIds(ids: string[], user_id?: string): Promise<DocStore[]> {
    if (ids.length === 0) {
      return Promise.resolve([]);
    }

    // Create placeholders for the IN clause
    const placeholders = ids.map(() => '?').join(',');
    
    let query = `SELECT * FROM docstores WHERE id IN (${placeholders})`;
    const params = [...ids];
    
    // Add user_id filter if provided
    if (user_id !== undefined) {
      query += " AND user_id = ?";
      params.push(user_id);
    }
    
    query += " ORDER BY id ASC";
    
    const stmt = this.db.prepare(query);
    const rows = stmt.all(...params);

    const docstores = rows.map(
      (row: Record<string, any>): DocStore => ({
        id: String(row.id || ""),
        name: String(row.name || ""),
        timestamp: Number(row.timestamp || 0),
        model: String(row.model || ""),
        vector_size: Number(row.vector_size || 0),
        options: String(row.options || ""),
        user_id: String(row.user_id || ""),
      })
    );
    
    return Promise.resolve(docstores);
  }

  /**
   * List documents by specific IDs
   * @param docstore_id - ID of the docstore containing the documents
   * @param ids - Array of document IDs to retrieve
   * @returns Promise that resolves with an array of document objects
   */
  async listDocsByIds(docstore_id: string, ids: string[]): Promise<Doc[]> {
    if (ids.length === 0) {
      return Promise.resolve([]);
    }

    // Create placeholders for the IN clause
    const placeholders = ids.map(() => '?').join(',');
    
    // Prepare the query with docstore_id and the list of document IDs
    const query = `SELECT * FROM docs WHERE docstore_id = ? AND id IN (${placeholders}) ORDER BY id ASC`;
    
    // Create the parameter array with docstore_id as the first parameter
    const params = [docstore_id, ...ids];
    
    const stmt = this.db.prepare(query);
    const rows = stmt.all(...params);

    // Convert rows to Doc objects
    const docs = rows.map((row: Record<string, any>): Doc => {
      // Convert embeddings from BLOB to Float32Array[]
      let embeddingsArray: Float32Array[] = [];
      if (row.embeddings) {
        embeddingsArray = this.blobToFloat32Arrays(row.embeddings as Buffer, docstore_id);
      }

      return {
        id: row.id?.toString() || "",
        docstore_id: row.docstore_id?.toString() || "",
        timestamp: Number(row.timestamp || 0),
        created_at: Number(row.created_at || 0),
        type: row.type?.toString() || "",
        data: row.data?.toString() || "",
        embeddings: embeddingsArray,
        user_id: row.user_id?.toString() || "",
        file: row.file ? (row.file as Buffer) : undefined,
        metadata: row.metadata?.toString() || "",
      };
    });
    
    return Promise.resolve(docs);
  }

  /**
   * Delete a docstore and all its documents
   * @param id - ID of the docstore to delete
   * @returns Promise that resolves with true if docstore existed and was deleted, false otherwise
   */
  async deleteDocstore(id: string, user_id?: string): Promise<boolean> {
    // Use a transaction to ensure atomicity
    this.db.exec("BEGIN TRANSACTION");

    try {
      // Delete all documents in the docstore
      let docsQuery = "DELETE FROM docs WHERE docstore_id = ?";
      const docsParams = [id];
      
      // Add user_id filter if provided
      if (user_id !== undefined) {
        docsQuery += " AND user_id = ?";
        docsParams.push(user_id);
      }
      
      const docsStmt = this.db.prepare(docsQuery);
      docsStmt.run(...docsParams);

      // Delete the docstore
      let docstoreQuery = "DELETE FROM docstores WHERE id = ?";
      const docstoreParams = [id];
      
      // Add user_id filter if provided
      if (user_id !== undefined) {
        docstoreQuery += " AND user_id = ?";
        docstoreParams.push(user_id);
      }
      
      const docstoreStmt = this.db.prepare(docstoreQuery);
      const result = docstoreStmt.run(...docstoreParams);

      this.db.exec("COMMIT");

      // Return true if a docstore was deleted
      return Promise.resolve(result.changes > 0);
    } catch (error) {
      this.db.exec("ROLLBACK");
      debugError("Error deleting docstore:", error);
      return Promise.resolve(false);
    }
  }

  /**
   * Count documents in a docstore
   * @param docstore_id - ID of the docstore to count documents for
   * @returns Promise that resolves with the number of documents in the docstore
   */
  async countDocs(docstore_id: string, user_id?: string): Promise<number> {
    let query = "SELECT COUNT(*) as count FROM docs WHERE docstore_id = ?";
    const params = [docstore_id];
    
    // Add user_id filter if provided
    if (user_id !== undefined) {
      query += " AND user_id = ?";
      params.push(user_id);
    }
    
    const stmt = this.db.prepare(query);
    const result = stmt.get(...params);
    return Promise.resolve(result && typeof result.count === "number" ? result.count : 0);
  }

  /**
   * Symbol.dispose method for releasing resources
   */
  [Symbol.dispose](): void {
    this.db.close();
  }
}
