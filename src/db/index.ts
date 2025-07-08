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
}

export class DB {
  private db: DatabaseSync;
  private dbPath: string;

  constructor(dbPath: string) {
    this.dbPath = dbPath;

    // Ensure the data directory exists
    mkdirSync(dirname(this.dbPath), { recursive: true });

    // Open db
    this.db = new DatabaseSync(dbPath);

    // Create users table if it doesn't exist
    this.db.exec(`
        CREATE TABLE IF NOT EXISTS users (
          pubkey TEXT PRIMARY KEY,
          nsec TEXT NOT NULL,
          nwc TEXT NOT NULL,
          timestamp INTEGER NOT NULL,
          token TEXT UNIQUE NOT NULL
        )
      `);

    console.log("Database initialized successfully");
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
        token: result.token as string
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
        token: result.token as string
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
        "INSERT INTO users (pubkey, nsec, nwc, timestamp, token) VALUES (?, ?, ?, ?, ?)"
      );

      stmt.run(
        newUser.pubkey,
        newUser.nsec,
        newUser.nwc,
        newUser.timestamp,
        newUser.token
      );

      return newUser;
    } catch (error) {
      console.error("Error adding user:", error);
      throw error;
    }
  }

  /**
   * Get the latest user timestamp from the database
   * @returns The latest timestamp or 0 if no users exist
   */
  async getLatestUserTimestamp(): Promise<number> {
    if (!this.db) {
      throw new Error("Database not initialized");
    }

    try {
      const stmt = this.db.prepare("SELECT MAX(timestamp) as latest FROM users");
      const result = stmt.get() as SQLiteRecord | undefined;
      
      if (!result || result.latest === null) {
        return 0;
      }
      
      return result.latest as number;
    } catch (error) {
      console.error("Error getting latest user timestamp:", error);
      return 0;
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
