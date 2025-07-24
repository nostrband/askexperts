import { DatabaseSync } from "node:sqlite";
import { Doc, DocStore, DocStoreClient, Subscription } from "./interfaces.js";
import crypto from "crypto";
import { debugDocstore, debugError } from "../common/debug.js";

/**
 * SQLite implementation of DocStoreClient
 */
export class DocStoreSQLite implements DocStoreClient {
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
    // Create docstores table
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS docstores (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        timestamp INTEGER NOT NULL
      )
    `);

    // Create docs table with auto-incremented aid field
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS docs (
        aid INTEGER PRIMARY KEY AUTOINCREMENT,
        id TEXT NOT NULL,
        docstore_id TEXT NOT NULL,
        timestamp INTEGER NOT NULL,
        created_at INTEGER NOT NULL,
        type TEXT NOT NULL,
        data TEXT NOT NULL,
        embeddings TEXT,
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
  subscribe(
    options: {
      docstore_id: string;
      type?: string;
      since?: number;
      until?: number;
    },
    onDoc: (doc?: Doc) => Promise<void>
  ): Subscription {
    let isActive = true;
    let pauseTimeout: any;
    let lastAid = 0; // Use aid for pagination instead of id
    const { docstore_id, type, since, until } = options;
    
    debugDocstore(`Subscribing to docstore: ${docstore_id}, type: ${type || 'all'}, since: ${since || 'beginning'}, until: ${until || 'now'}`);

    // Function to convert row to Doc interface
    const rowToDoc = (row: Record<string, any>): Doc => ({
      id: row.id?.toString() || "",
      docstore_id: row.docstore_id?.toString() || "",
      timestamp: Number(row.timestamp || 0),
      created_at: Number(row.created_at || 0),
      type: row.type?.toString() || "",
      data: row.data?.toString() || "",
      embeddings: row.embeddings ? row.embeddings.toString() : "",
      // aid is not included in the returned Doc object as it's an internal implementation detail
    });

    // Function to fetch a batch of documents
    const fetchBatch = async () => {
      if (!isActive) return;

      // Build query dynamically based on provided filters
      let query = `
        SELECT * FROM docs
        WHERE docstore_id = ?
      `;

      const queryParams: any[] = [docstore_id];

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

    // Return subscription object with close method
    return {
      close: () => {
        isActive = false;
        if (pauseTimeout) clearTimeout(pauseTimeout);
      },
    };
  }

  /**
   * Upsert a document in the store using a single atomic operation
   * @param doc - Document to upsert
   */
  upsert(doc: Doc): void {
    debugDocstore(`Upserting document: ${doc.id} in docstore: ${doc.docstore_id}, type: ${doc.type}`);
    // Use INSERT OR REPLACE to handle both insert and update in a single atomic operation
    const stmt = this.db.prepare(`
      INSERT OR REPLACE INTO docs (
        id, docstore_id, timestamp, created_at, type, data, embeddings
      ) VALUES (?, ?, ?, ?, ?, ?, ?)
    `);

    stmt.run(
      doc.id,
      doc.docstore_id,
      doc.timestamp,
      doc.created_at,
      doc.type,
      doc.data,
      doc.embeddings || ""
    );
  }

  /**
   * Get a document by ID
   * @param docstore_id - ID of the docstore containing the document
   * @param doc_id - ID of the document to get
   * @returns The document if found, null otherwise
   */
  get(docstore_id: string, doc_id: string): Doc | null {
    const stmt = this.db.prepare(
      "SELECT * FROM docs WHERE docstore_id = ? AND id = ?"
    );

    const row = stmt.get(docstore_id, doc_id);

    if (!row) {
      return null;
    }

    // Convert row to Doc interface
    return {
      id: row.id?.toString() || "",
      docstore_id: row.docstore_id?.toString() || "",
      timestamp: Number(row.timestamp || 0),
      created_at: Number(row.created_at || 0),
      type: row.type?.toString() || "",
      data: row.data?.toString() || "",
      embeddings: row.embeddings ? row.embeddings.toString() : "",
    };
  }

  /**
   * Delete a document from the store
   * @param docstore_id - ID of the docstore containing the document
   * @param doc_id - ID of the document to delete
   * @returns true if document existed and was deleted, false otherwise
   */
  delete(docstore_id: string, doc_id: string): boolean {
    const stmt = this.db.prepare(
      "DELETE FROM docs WHERE docstore_id = ? AND id = ?"
    );

    const result = stmt.run(docstore_id, doc_id);

    // Return true if a row was affected (document was deleted)
    return result.changes > 0;
  }

  /**
   * Create a new docstore if one with the given name doesn't exist
   * @param name - Name of the docstore to create
   * @returns ID of the created or existing docstore
   */
  createDocstore(name: string): string {
    debugDocstore(`Creating docstore with name: ${name}`);
    // Check if docstore with this name already exists
    const existingDocstore = this.db
      .prepare("SELECT id FROM docstores WHERE name = ?")
      .get(name);

    if (existingDocstore && existingDocstore.id !== null) {
      debugDocstore(`Docstore with name ${name} already exists with ID: ${existingDocstore.id}`);
      return existingDocstore.id.toString();
    }

    // Create new docstore with UUID
    const timestamp = Math.floor(Date.now() / 1000);
    const id = crypto.randomUUID();

    const stmt = this.db.prepare(
      "INSERT INTO docstores (id, name, timestamp) VALUES (?, ?, ?)"
    );

    stmt.run(id, name, timestamp);
    debugDocstore(`Created new docstore with name: ${name}, ID: ${id}`);
    return id;
  }

  /**
   * List all docstores
   * @returns Array of docstore objects
   */
  listDocstores(): DocStore[] {
    const stmt = this.db.prepare("SELECT * FROM docstores ORDER BY id ASC");
    const rows = stmt.all();

    return rows.map(
      (row: Record<string, any>): DocStore => ({
        id: row.id,
        name: row.name,
        timestamp: row.timestamp,
      })
    );
  }

  /**
   * Delete a docstore and all its documents
   * @param id - ID of the docstore to delete
   * @returns true if docstore existed and was deleted, false otherwise
   */
  deleteDocstore(id: string): boolean {
    // Use a transaction to ensure atomicity
    this.db.exec("BEGIN TRANSACTION");

    try {
      // Delete all documents in the docstore
      const docsStmt = this.db.prepare(
        "DELETE FROM docs WHERE docstore_id = ?"
      );
      docsStmt.run(id);

      // Delete the docstore
      const docstoreStmt = this.db.prepare(
        "DELETE FROM docstores WHERE id = ?"
      );
      const result = docstoreStmt.run(id);

      this.db.exec("COMMIT");

      // Return true if a docstore was deleted
      return result.changes > 0;
    } catch (error) {
      this.db.exec("ROLLBACK");
      debugError("Error deleting docstore:", error);
      return false;
    }
  }

  /**
   * Count documents in a docstore
   * @param docstore_id - ID of the docstore to count documents for
   * @returns Number of documents in the docstore
   */
  countDocs(docstore_id: string): number {
    const stmt = this.db.prepare(
      "SELECT COUNT(*) as count FROM docs WHERE docstore_id = ?"
    );

    const result = stmt.get(docstore_id);
    return result && typeof result.count === "number" ? result.count : 0;
  }

  /**
   * Symbol.dispose method for releasing resources
   */
  [Symbol.dispose](): void {
    this.db.close();
  }
}
