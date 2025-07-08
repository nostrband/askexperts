import { bytesToHex, randomBytes } from "@noble/hashes/utils";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { DatabaseSync } from "node:sqlite";

// Define the SQLite output type
type SQLiteRecord = Record<string, string | number | null | undefined>;

export interface User {
  pubkey: string;
  nsec: string;
  nwc: string;
  timestamp: number;
  token: string;
  mcp_server_id: number;
}

export interface McpServer {
  id: number;
  url: string;
  token: string;
}

export class ParentDB {
  private db: DatabaseSync;
  private dbPath: string;

  constructor(dbPath: string = "./data/parent.db") {
    this.dbPath = dbPath;

    // Ensure the data directory exists
    mkdirSync(dirname(this.dbPath), { recursive: true });

    // Open db
    this.db = new DatabaseSync(dbPath);

    // Create mcp_servers table if it doesn't exist
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS mcp_servers (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        url TEXT NOT NULL,
        token TEXT UNIQUE NOT NULL
      )
    `);

    // Create users table if it doesn't exist
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS users (
        pubkey TEXT PRIMARY KEY,
        nsec TEXT NOT NULL,
        nwc TEXT NOT NULL,
        timestamp INTEGER NOT NULL,
        token TEXT UNIQUE NOT NULL,
        mcp_server_id INTEGER NOT NULL,
        FOREIGN KEY (mcp_server_id) REFERENCES mcp_servers(id)
      )
    `);

    console.log("Parent Database initialized successfully");
  }

  /**
   * Get a user by their token
   * @param token The user's authentication token
   * @returns The user object or null if not found
   */
  async getUserByToken(token: string): Promise<User | null> {
    if (!this.db) {
      throw new Error("Database not initialized");
    }

    try {
      const stmt = this.db.prepare("SELECT * FROM users WHERE token = ?");
      const result = stmt.get(token) as SQLiteRecord | undefined;
      
      if (!result) {
        return null;
      }
      
      return {
        pubkey: result.pubkey as string,
        nsec: result.nsec as string,
        nwc: result.nwc as string,
        timestamp: result.timestamp as number,
        token: result.token as string,
        mcp_server_id: result.mcp_server_id as number
      };
    } catch (error) {
      console.error("Error getting user by token:", error);
      return null;
    }
  }

  /**
   * Get a user by their pubkey
   * @param pubkey The user's public key
   * @returns The user object or null if not found
   */
  async getUserByPubkey(pubkey: string): Promise<User | null> {
    if (!this.db) {
      throw new Error("Database not initialized");
    }

    try {
      const stmt = this.db.prepare("SELECT * FROM users WHERE pubkey = ?");
      const result = stmt.get(pubkey) as SQLiteRecord | undefined;
      
      if (!result) {
        return null;
      }
      
      return {
        pubkey: result.pubkey as string,
        nsec: result.nsec as string,
        nwc: result.nwc as string,
        timestamp: result.timestamp as number,
        token: result.token as string,
        mcp_server_id: result.mcp_server_id as number
      };
    } catch (error) {
      console.error("Error getting user by pubkey:", error);
      return null;
    }
  }

  /**
   * Add a new user to the database
   * @param user The user object to add
   * @returns The added user with generated token
   */
  async addUser(user: Omit<User, "token" | "timestamp">): Promise<User> {
    if (!this.db) {
      throw new Error("Database not initialized");
    }

    // Generate a random token
    const token = bytesToHex(randomBytes(32));
    const timestamp = Math.floor(Date.now() / 1000);

    const newUser: User = {
      ...user,
      token,
      timestamp,
    };

    try {
      const stmt = this.db.prepare(
        "INSERT INTO users (pubkey, nsec, nwc, timestamp, token, mcp_server_id) VALUES (?, ?, ?, ?, ?, ?)"
      );

      stmt.run(
        newUser.pubkey,
        newUser.nsec,
        newUser.nwc,
        newUser.timestamp,
        newUser.token,
        newUser.mcp_server_id
      );

      return newUser;
    } catch (error) {
      console.error("Error adding user:", error);
      throw error;
    }
  }

  /**
   * Get users for a specific MCP server that were added after a given timestamp
   * @param mcpServerId The ID of the MCP server
   * @param since Timestamp to filter users (get users added after this timestamp)
   * @param limit Maximum number of users to return
   * @returns Array of users
   */
  async getUsersSince(mcpServerId: number, since: number, limit: number = 1000): Promise<User[]> {
    if (!this.db) {
      throw new Error("Database not initialized");
    }

    try {
      const stmt = this.db.prepare(
        "SELECT * FROM users WHERE mcp_server_id = ? AND timestamp >= ? ORDER BY timestamp ASC LIMIT ?"
      );
      
      const results = stmt.all(mcpServerId, since, limit) as SQLiteRecord[];
      
      return results.map(result => ({
        pubkey: result.pubkey as string,
        nsec: result.nsec as string,
        nwc: result.nwc as string,
        timestamp: result.timestamp as number,
        token: result.token as string,
        mcp_server_id: result.mcp_server_id as number
      }));
    } catch (error) {
      console.error("Error getting users since timestamp:", error);
      return [];
    }
  }

  /**
   * Get an MCP server by its token
   * @param token The server's authentication token
   * @returns The server object or null if not found
   */
  async getMcpServerByToken(token: string): Promise<McpServer | null> {
    if (!this.db) {
      throw new Error("Database not initialized");
    }

    try {
      const stmt = this.db.prepare("SELECT * FROM mcp_servers WHERE token = ?");
      const result = stmt.get(token) as SQLiteRecord | undefined;
      
      if (!result) {
        return null;
      }
      
      return {
        id: result.id as number,
        url: result.url as string,
        token: result.token as string
      };
    } catch (error) {
      console.error("Error getting MCP server by token:", error);
      return null;
    }
  }

  /**
   * Get an MCP server by its ID
   * @param id The server's ID
   * @returns The server object or null if not found
   */
  async getMcpServerById(id: number): Promise<McpServer | null> {
    if (!this.db) {
      throw new Error("Database not initialized");
    }

    try {
      const stmt = this.db.prepare("SELECT * FROM mcp_servers WHERE id = ?");
      const result = stmt.get(id) as SQLiteRecord | undefined;
      
      if (!result) {
        return null;
      }
      
      return {
        id: result.id as number,
        url: result.url as string,
        token: result.token as string
      };
    } catch (error) {
      console.error("Error getting MCP server by ID:", error);
      return null;
    }
  }

  /**
   * Add a new MCP server to the database
   * @param url The URL of the MCP server
   * @returns The added server with generated token and ID
   */
  async addMcpServer(url: string): Promise<McpServer> {
    if (!this.db) {
      throw new Error("Database not initialized");
    }

    // Generate a random token
    const token = bytesToHex(randomBytes(32));

    try {
      const stmt = this.db.prepare(
        "INSERT INTO mcp_servers (url, token) VALUES (?, ?)"
      );

      stmt.run(url, token);
      
      // Get the inserted ID
      const idStmt = this.db.prepare("SELECT last_insert_rowid() as id");
      const result = idStmt.get() as { id: number };

      return {
        id: result.id,
        url,
        token
      };
    } catch (error) {
      console.error("Error adding MCP server:", error);
      throw error;
    }
  }

  /**
   * Close the database connection
   */
  async close(): Promise<void> {
    if (this.db) {
      this.db.close();
    }
  }
}