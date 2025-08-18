import { DatabaseSync } from "node:sqlite";
import { DBWallet, DBExpert, DBUser, DBInterface } from "./interfaces.js";
import { debugDB, debugError } from "../common/debug.js";
import crypto from "crypto";

/**
 * SQLite implementation of the database for experts, wallets, and docstore servers
 */
export class DB {
  private db: DatabaseSync;

  /**
   * Creates a new DB instance
   * @param dbPath - Path to the SQLite database file
   */
  constructor(dbPath: string) {
    debugDB(`Initializing DB with database at: ${dbPath}`);
    this.db = new DatabaseSync(dbPath);
    this.initDatabase();
  }

  /**
   * Initialize the database by creating required tables if they don't exist
   */
  private initDatabase(): void {
    // Allow concurrent readers
    this.db.exec("PRAGMA journal_mode = WAL;");
    // Wait up to 3 seconds for locks
    this.db.exec("PRAGMA busy_timeout = 3000;");

    // Create wallets table with all columns and indexes
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS wallets (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL UNIQUE,
        nwc TEXT NOT NULL,
        default_wallet BOOLEAN NOT NULL DEFAULT 0,
        user_id TEXT NOT NULL
      )
    `);

    // Create index for wallets that can't be included in the CREATE TABLE
    this.db.exec(
      "CREATE INDEX IF NOT EXISTS idx_wallets_default ON wallets (default_wallet)"
    );
    this.db.exec(
      "CREATE INDEX IF NOT EXISTS idx_wallets_user_id ON wallets (user_id)"
    );

    // Create experts table with all columns and indexes
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS experts (
        pubkey TEXT PRIMARY KEY,
        wallet_id TEXT NOT NULL,
        type TEXT NOT NULL,
        nickname TEXT NOT NULL UNIQUE,
        env TEXT NOT NULL,
        docstores TEXT NOT NULL,
        privkey TEXT,
        disabled BOOLEAN NOT NULL DEFAULT 0,
        user_id TEXT NOT NULL,
        timestamp INTEGER
      )
    `);

    // Create indexes for experts that can't be included in the CREATE TABLE
    this.db.exec(
      "CREATE INDEX IF NOT EXISTS idx_experts_wallet_id ON experts (wallet_id)"
    );
    this.db.exec(
      "CREATE INDEX IF NOT EXISTS idx_experts_type ON experts (type)"
    );
    this.db.exec(
      "CREATE INDEX IF NOT EXISTS idx_experts_user_id ON experts (user_id)"
    );

    // Migration: Add timestamp column if it doesn't exist
    try {
      // Check if timestamp column exists
      const hasTimestampColumn = this.db
        .prepare("SELECT timestamp FROM experts LIMIT 1")
        .get();
    } catch (error) {
      // Column doesn't exist, add it
      this.db.exec("ALTER TABLE experts ADD COLUMN timestamp INTEGER");

      // Initialize timestamp for existing records to current time
      const currentTime = Date.now();
      this.db.exec(`UPDATE experts SET timestamp = ${currentTime}`);

      // Add the index
      this.db.exec(
        "CREATE INDEX IF NOT EXISTS idx_experts_timestamp ON experts (timestamp)"
      );
    }

    // Create users table with all columns and indexes
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS users (
        id TEXT PRIMARY KEY,
        pubkey TEXT NOT NULL UNIQUE,
        privkey TEXT NOT NULL,
        user_id_ext TEXT DEFAULT ''
      )
    `);

    // Create index for users
    this.db.exec(
      "CREATE INDEX IF NOT EXISTS idx_users_pubkey ON users (pubkey)"
    );
    this.db.exec(
      "CREATE INDEX IF NOT EXISTS idx_users_user_id_ext ON users (user_id_ext)"
    );

    // Migration: Add user_id_ext column if it doesn't exist
    try {
      // Check if user_id_ext column exists
      const hasUserIdExtColumn = this.db
        .prepare("SELECT user_id_ext FROM users LIMIT 1")
        .get();
    } catch (error) {
      // Column doesn't exist, add it
      this.db.exec("ALTER TABLE users ADD COLUMN user_id_ext TEXT DEFAULT ''");

      // Add the index
      this.db.exec(
        "CREATE INDEX IF NOT EXISTS idx_users_user_id_ext ON users (user_id_ext)"
      );
    }
  }

  /**
   * List all wallets
   * @param user_id - Optional user ID to filter wallets by
   * @returns Array of wallet objects
   */
  async listWallets(user_id?: string): Promise<DBWallet[]> {
    let stmt;
    let rows;

    if (user_id) {
      stmt = this.db.prepare(
        "SELECT id, name, nwc, default_wallet as 'default', user_id FROM wallets WHERE user_id = ? ORDER BY id ASC"
      );
      rows = stmt.all(user_id);
    } else {
      stmt = this.db.prepare(
        "SELECT id, name, nwc, default_wallet as 'default', user_id FROM wallets ORDER BY id ASC"
      );
      rows = stmt.all();
    }

    const wallets = rows.map(
      (row: Record<string, any>): DBWallet => ({
        id: String(row.id || ""),
        name: String(row.name || ""),
        nwc: String(row.nwc || ""),
        default: Boolean(row.default || false),
        user_id: String(row.user_id || ""),
      })
    );

    return Promise.resolve(wallets);
  }

  /**
   * List wallets by specific IDs
   * @param ids - Array of wallet IDs to retrieve
   * @returns Promise resolving to an array of wallet objects matching the provided IDs
   */
  async listWalletsByIds(ids: string[]): Promise<DBWallet[]> {
    if (!ids.length) {
      return Promise.resolve([]);
    }

    // Create placeholders for the SQL query (?, ?, ?, etc.)
    const placeholders = ids.map(() => "?").join(",");
    const stmt = this.db.prepare(
      `SELECT id, name, nwc, default_wallet as 'default', user_id FROM wallets WHERE id IN (${placeholders}) ORDER BY id ASC`
    );
    const rows = stmt.all(...ids);

    const wallets = rows.map(
      (row: Record<string, any>): DBWallet => ({
        id: String(row.id || ""),
        name: String(row.name || ""),
        nwc: String(row.nwc || ""),
        default: Boolean(row.default || false),
        user_id: String(row.user_id || ""),
      })
    );

    return Promise.resolve(wallets);
  }

  /**
   * Get a wallet by ID
   * @param id - ID of the wallet to get
   * @param user_id - Optional user ID to filter by
   * @returns The wallet if found, null otherwise
   */
  async getWallet(id: string, user_id?: string): Promise<DBWallet | null> {
    let stmt;
    let row;

    if (user_id) {
      stmt = this.db.prepare(
        "SELECT id, name, nwc, default_wallet as 'default', user_id FROM wallets WHERE id = ? AND user_id = ?"
      );
      row = stmt.get(id, user_id);
    } else {
      stmt = this.db.prepare(
        "SELECT id, name, nwc, default_wallet as 'default', user_id FROM wallets WHERE id = ?"
      );
      row = stmt.get(id);
    }

    if (!row) {
      return Promise.resolve(null);
    }

    const wallet = {
      id: String(row.id || ""),
      name: String(row.name || ""),
      nwc: String(row.nwc || ""),
      default: Boolean(row.default || false),
      user_id: String(row.user_id || ""),
    };

    return Promise.resolve(wallet);
  }

  /**
   * Get a wallet by name
   * @param name - Name of the wallet to get
   * @param user_id - Optional user ID to filter by
   * @returns The wallet if found, null otherwise
   */
  async getWalletByName(
    name: string,
    user_id?: string
  ): Promise<DBWallet | null> {
    let stmt;
    let row;

    if (user_id) {
      stmt = this.db.prepare(
        "SELECT id, name, nwc, default_wallet as 'default', user_id FROM wallets WHERE name = ? AND user_id = ?"
      );
      row = stmt.get(name, user_id);
    } else {
      stmt = this.db.prepare(
        "SELECT id, name, nwc, default_wallet as 'default', user_id FROM wallets WHERE name = ?"
      );
      row = stmt.get(name);
    }

    if (!row) {
      return Promise.resolve(null);
    }

    const wallet = {
      id: String(row.id || ""),
      name: String(row.name || ""),
      nwc: String(row.nwc || ""),
      default: Boolean(row.default || false),
      user_id: String(row.user_id || ""),
    };

    return Promise.resolve(wallet);
  }

  /**
   * Get the default wallet
   * @param user_id - Optional user ID to filter by
   * @returns The default wallet if found, null otherwise
   */
  async getDefaultWallet(user_id?: string): Promise<DBWallet | null> {
    let stmt;
    let row;

    if (user_id) {
      stmt = this.db.prepare(
        "SELECT id, name, nwc, default_wallet as 'default', user_id FROM wallets WHERE default_wallet = 1 AND user_id = ? LIMIT 1"
      );
      row = stmt.get(user_id);
    } else {
      stmt = this.db.prepare(
        "SELECT id, name, nwc, default_wallet as 'default', user_id FROM wallets WHERE default_wallet = 1 LIMIT 1"
      );
      row = stmt.get();
    }

    if (!row) {
      return Promise.resolve(null);
    }

    const wallet = {
      id: String(row.id || ""),
      name: String(row.name || ""),
      nwc: String(row.nwc || ""),
      default: Boolean(row.default || false),
      user_id: String(row.user_id || ""),
    };

    return Promise.resolve(wallet);
  }

  /**
   * Insert a new wallet
   * @param wallet - Wallet to insert (without id)
   * @returns ID of the inserted wallet
   */
  async insertWallet(wallet: Omit<DBWallet, "id">): Promise<string> {
    // Check if this is the first wallet, if so mark it as default
    const walletCount = this.db
      .prepare("SELECT COUNT(*) as count FROM wallets WHERE user_id = ?")
      .get(wallet.user_id);
    const count = walletCount ? Number(walletCount.count) : 0;
    const isFirstWallet = count === 0;

    // If this wallet is set as default, unset any existing default wallet
    if (wallet.default || isFirstWallet) {
      this.db
        .prepare(
          "UPDATE wallets SET default_wallet = 0 WHERE default_wallet = 1 AND user_id = ?"
        )
        .run(wallet.user_id);
      wallet.default = true;
    }

    const stmt = this.db.prepare(`
      INSERT INTO wallets (id, name, nwc, default_wallet, user_id)
      VALUES (?, ?, ?, ?, ?)
    `);

    // Generate a unique string ID (UUID or similar)
    const id = crypto.randomUUID();

    const result = stmt.run(
      id,
      wallet.name,
      wallet.nwc,
      wallet.default ? 1 : 0,
      wallet.user_id
    );

    return Promise.resolve(id);
  }

  /**
   * Update an existing wallet
   * @param wallet - Wallet to update
   * @returns true if wallet was updated, false otherwise
   */
  async updateWallet(wallet: DBWallet): Promise<boolean> {
    // If this wallet is set as default, unset any existing default wallet
    if (wallet.default) {
      this.db
        .prepare(
          "UPDATE wallets SET default_wallet = 0 WHERE default_wallet = 1 AND id != ? AND user_id = ?"
        )
        .run(wallet.id, wallet.user_id);
    }

    const stmt = this.db.prepare(`
      UPDATE wallets
      SET name = ?, nwc = ?, default_wallet = ?, user_id = ?
      WHERE id = ? AND user_id = ?
    `);

    const result = stmt.run(
      wallet.name,
      wallet.nwc,
      wallet.default ? 1 : 0,
      wallet.user_id,
      wallet.id,
      wallet.user_id
    );

    return Promise.resolve(result.changes > 0);
  }

  /**
   * Delete a wallet
   * @param id - ID of the wallet to delete
   * @param user_id - Optional user ID to filter by
   * @returns true if wallet was deleted, false otherwise
   */
  async deleteWallet(id: string, user_id?: string): Promise<boolean> {
    // Check if there are any experts using this wallet
    const expertCount = this.db
      .prepare("SELECT COUNT(*) as count FROM experts WHERE wallet_id = ?")
      .get(id);
    const count = expertCount ? Number(expertCount.count) : 0;
    if (count > 0) {
      return Promise.reject(
        new Error(
          `Cannot delete wallet with ID ${id} because it is used by ${count} experts`
        )
      );
    }

    let stmt;
    let result;

    if (user_id) {
      stmt = this.db.prepare(
        "DELETE FROM wallets WHERE id = ? AND user_id = ?"
      );
      result = stmt.run(id, user_id);
    } else {
      stmt = this.db.prepare("DELETE FROM wallets WHERE id = ?");
      result = stmt.run(id);
    }

    return Promise.resolve(result.changes > 0);
  }

  /**
   * List all experts
   * @param user_id - Optional user ID to filter experts by
   * @returns Promise resolving to an array of expert objects
   */
  async listExperts(user_id?: string): Promise<DBExpert[]> {
    let stmt;
    let rows;

    if (user_id) {
      stmt = this.db.prepare(
        "SELECT * FROM experts WHERE user_id = ? ORDER BY pubkey ASC"
      );
      rows = stmt.all(user_id);
    } else {
      stmt = this.db.prepare("SELECT * FROM experts ORDER BY pubkey ASC");
      rows = stmt.all();
    }

    const experts = rows.map(
      (row: Record<string, any>): DBExpert => ({
        pubkey: String(row.pubkey || ""),
        wallet_id: String(row.wallet_id || ""),
        type: String(row.type || ""),
        nickname: String(row.nickname || ""),
        env: String(row.env || ""),
        docstores: String(row.docstores || ""),
        privkey: row.privkey ? String(row.privkey) : undefined,
        disabled: Boolean(row.disabled || false),
        user_id: String(row.user_id || ""),
      })
    );

    return Promise.resolve(experts);
  }

  /**
   * List experts with timestamp newer than the provided timestamp
   * @param timestamp - Only return experts with timestamp newer than this
   * @param limit - Maximum number of experts to return (default: 1000)
   * @param user_id - Optional user ID to filter experts by
   * @returns Promise resolving to an array of expert objects
   */
  async listExpertsAfter(
    timestamp: number,
    limit = 1000,
    user_id?: string
  ): Promise<DBExpert[]> {
    let stmt;
    let rows;

    if (user_id) {
      stmt = this.db.prepare(
        "SELECT * FROM experts WHERE timestamp > ? AND user_id = ? ORDER BY timestamp ASC LIMIT ?"
      );
      rows = stmt.all(timestamp, user_id, limit);
    } else {
      stmt = this.db.prepare(
        "SELECT * FROM experts WHERE timestamp > ? ORDER BY timestamp ASC LIMIT ?"
      );
      rows = stmt.all(timestamp, limit);
    }

    const experts = rows.map(
      (row: Record<string, any>): DBExpert => ({
        pubkey: String(row.pubkey || ""),
        wallet_id: String(row.wallet_id || ""),
        type: String(row.type || ""),
        nickname: String(row.nickname || ""),
        env: String(row.env || ""),
        docstores: String(row.docstores || ""),
        privkey: row.privkey ? String(row.privkey) : undefined,
        disabled: Boolean(row.disabled || false),
        user_id: String(row.user_id || ""),
        timestamp: row.timestamp ? Number(row.timestamp) : undefined,
      })
    );

    return Promise.resolve(experts);
  }

  /**
   * List experts by specific IDs
   * @param ids - Array of expert pubkeys to retrieve
   * @returns Promise resolving to an array of expert objects matching the provided IDs
   */
  async listExpertsByIds(ids: string[]): Promise<DBExpert[]> {
    if (!ids.length) {
      return Promise.resolve([]);
    }

    // Create placeholders for the SQL query (?, ?, ?, etc.)
    const placeholders = ids.map(() => "?").join(",");
    const stmt = this.db.prepare(
      `SELECT * FROM experts WHERE pubkey IN (${placeholders}) ORDER BY pubkey ASC`
    );
    const rows = stmt.all(...ids);

    const experts = rows.map(
      (row: Record<string, any>): DBExpert => ({
        pubkey: String(row.pubkey || ""),
        wallet_id: String(row.wallet_id || ""),
        type: String(row.type || ""),
        nickname: String(row.nickname || ""),
        env: String(row.env || ""),
        docstores: String(row.docstores || ""),
        privkey: row.privkey ? String(row.privkey) : undefined,
        disabled: Boolean(row.disabled || false),
        user_id: String(row.user_id || ""),
      })
    );

    return Promise.resolve(experts);
  }

  /**
   * Get an expert by pubkey
   * @param pubkey - Pubkey of the expert to get
   * @param user_id - Optional user ID to filter by
   * @returns Promise resolving to the expert if found, null otherwise
   */
  async getExpert(pubkey: string, user_id?: string): Promise<DBExpert | null> {
    let stmt;
    let row;

    if (user_id) {
      stmt = this.db.prepare(
        "SELECT * FROM experts WHERE pubkey = ? AND user_id = ?"
      );
      row = stmt.get(pubkey, user_id);
    } else {
      stmt = this.db.prepare("SELECT * FROM experts WHERE pubkey = ?");
      row = stmt.get(pubkey);
    }

    if (!row) {
      return Promise.resolve(null);
    }

    const expert = {
      pubkey: String(row.pubkey || ""),
      wallet_id: String(row.wallet_id || ""),
      type: String(row.type || ""),
      nickname: String(row.nickname || ""),
      env: String(row.env || ""),
      docstores: String(row.docstores || ""),
      privkey: row.privkey ? String(row.privkey) : undefined,
      disabled: Boolean(row.disabled || false),
      user_id: String(row.user_id || ""),
    };

    return Promise.resolve(expert);
  }

  /**
   * Insert a new expert
   * @param expert - Expert to insert
   * @returns Promise resolving to true if expert was inserted, false otherwise
   */
  async insertExpert(expert: DBExpert): Promise<boolean> {
    // Check if wallet exists - now using the async getWallet method
    const wallet = await this.getWallet(expert.wallet_id, expert.user_id);
    if (!wallet) {
      throw new Error(`Wallet with ID ${expert.wallet_id} does not exist`);
    }

    // Generate timestamp in the DB class
    const timestamp = Date.now();

    const stmt = this.db.prepare(`
      INSERT INTO experts (pubkey, wallet_id, type, nickname, env, docstores, privkey, disabled, user_id, timestamp)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    try {
      stmt.run(
        expert.pubkey,
        expert.wallet_id,
        expert.type,
        expert.nickname,
        expert.env,
        expert.docstores,
        expert.privkey || null,
        expert.disabled ? 1 : 0,
        expert.user_id || "",
        timestamp
      );
      return Promise.resolve(true);
    } catch (error) {
      debugError("Error inserting expert:", error);
      return Promise.resolve(false);
    }
  }

  /**
   * Update an existing expert
   * @param expert - Expert to update
   * @returns Promise resolving to true if expert was updated, false otherwise
   */
  async updateExpert(expert: DBExpert): Promise<boolean> {
    // Check if wallet exists - now using the async getWallet method
    const wallet = await this.getWallet(expert.wallet_id, expert.user_id);
    if (!wallet) {
      throw new Error(`Wallet with ID ${expert.wallet_id} does not exist`);
    }

    // Generate timestamp in the DB class
    const timestamp = Date.now();

    const stmt = this.db.prepare(`
      UPDATE experts
      SET wallet_id = ?, type = ?, nickname = ?, env = ?, docstores = ?, privkey = ?, disabled = ?, user_id = ?, timestamp = ?
      WHERE pubkey = ?
    `);

    const result = stmt.run(
      expert.wallet_id,
      expert.type,
      expert.nickname,
      expert.env,
      expert.docstores,
      expert.privkey || null,
      expert.disabled ? 1 : 0,
      expert.user_id || "",
      timestamp,
      expert.pubkey
    );

    return Promise.resolve(result.changes > 0);
  }

  /**
   * Set the disabled status of an expert
   * @param pubkey - Pubkey of the expert to update
   * @param disabled - Whether the expert should be disabled
   * @param user_id - Optional user ID to filter by
   * @returns Promise resolving to true if expert was updated, false otherwise
   */
  async setExpertDisabled(
    pubkey: string,
    disabled: boolean,
    user_id?: string
  ): Promise<boolean> {
    // Generate timestamp in the DB class
    const timestamp = Date.now();

    let stmt;
    let result;

    if (user_id) {
      stmt = this.db.prepare(`
        UPDATE experts
        SET disabled = ?, timestamp = ?
        WHERE pubkey = ? AND user_id = ?
      `);

      result = stmt.run(disabled ? 1 : 0, timestamp, pubkey, user_id);
    } else {
      stmt = this.db.prepare(`
        UPDATE experts
        SET disabled = ?, timestamp = ?
        WHERE pubkey = ?
      `);

      result = stmt.run(disabled ? 1 : 0, timestamp, pubkey);
    }

    return Promise.resolve(result.changes > 0);
  }

  /**
   * Delete an expert
   * @param pubkey - Pubkey of the expert to delete
   * @param user_id - Optional user ID to filter by
   * @returns Promise resolving to true if expert was deleted, false otherwise
   */
  async deleteExpert(pubkey: string, user_id?: string): Promise<boolean> {
    let stmt;
    let result;

    if (user_id) {
      stmt = this.db.prepare(
        "DELETE FROM experts WHERE pubkey = ? AND user_id = ?"
      );
      result = stmt.run(pubkey, user_id);
    } else {
      stmt = this.db.prepare("DELETE FROM experts WHERE pubkey = ?");
      result = stmt.run(pubkey);
    }

    return Promise.resolve(result.changes > 0);
  }

  /**
   * List all users
   * @returns Promise resolving to an array of user objects
   */
  async listUsers(): Promise<DBUser[]> {
    const stmt = this.db.prepare("SELECT * FROM users ORDER BY id ASC");
    const rows = stmt.all();

    const users = rows.map(
      (row: Record<string, any>): DBUser => ({
        id: String(row.id || ""),
        pubkey: String(row.pubkey || ""),
        privkey: String(row.privkey || ""),
        user_id_ext: String(row.user_id_ext || ""),
      })
    );

    return Promise.resolve(users);
  }

  /**
   * Get a user by ID
   * @param id - ID of the user to get
   * @returns Promise resolving to the user if found, null otherwise
   */
  async getUser(id: string): Promise<DBUser | null> {
    const stmt = this.db.prepare("SELECT * FROM users WHERE id = ?");
    const row = stmt.get(id);

    if (!row) {
      return Promise.resolve(null);
    }

    const user = {
      id: String(row.id || ""),
      pubkey: String(row.pubkey || ""),
      privkey: String(row.privkey || ""),
      user_id_ext: String(row.user_id_ext || ""),
    };

    return Promise.resolve(user);
  }

  /**
   * Get a user by pubkey
   * @param pubkey - Pubkey of the user to get
   * @returns Promise resolving to the user if found, null otherwise
   */
  async getUserByPubkey(pubkey: string): Promise<DBUser | null> {
    const stmt = this.db.prepare("SELECT * FROM users WHERE pubkey = ?");
    const row = stmt.get(pubkey);

    if (!row) {
      return Promise.resolve(null);
    }

    const user = {
      id: String(row.id || ""),
      pubkey: String(row.pubkey || ""),
      privkey: String(row.privkey || ""),
      user_id_ext: String(row.user_id_ext || ""),
    };

    return Promise.resolve(user);
  }

  /**
   * Get a user by external ID
   * @param user_id_ext - External ID of the user to get
   * @returns Promise resolving to the user if found, null otherwise
   */
  async getUserByExtId(user_id_ext: string): Promise<DBUser | null> {
    if (!user_id_ext) {
      return Promise.resolve(null);
    }

    const stmt = this.db.prepare("SELECT * FROM users WHERE user_id_ext = ?");
    const row = stmt.get(user_id_ext);

    if (!row) {
      return Promise.resolve(null);
    }

    const user = {
      id: String(row.id || ""),
      pubkey: String(row.pubkey || ""),
      privkey: String(row.privkey || ""),
      user_id_ext: String(row.user_id_ext || ""),
    };

    return Promise.resolve(user);
  }

  /**
   * Insert a new user
   * @param user - User to insert (without id)
   * @returns Promise resolving to the ID of the inserted user
   */
  async insertUser(user: Omit<DBUser, "id">): Promise<string> {
    const stmt = this.db.prepare(`
      INSERT INTO users (id, pubkey, privkey, user_id_ext)
      VALUES (?, ?, ?, ?)
    `);

    // Generate a unique string ID (UUID)
    const id = crypto.randomUUID();

    try {
      stmt.run(id, user.pubkey, user.privkey, user.user_id_ext || "");
      return Promise.resolve(id);
    } catch (error) {
      debugError("Error inserting user:", error);
      return Promise.reject(error);
    }
  }

  /**
   * Update an existing user
   * @param user - User to update
   * @returns Promise resolving to true if user was updated, false otherwise
   */
  async updateUser(user: DBUser): Promise<boolean> {
    const stmt = this.db.prepare(`
      UPDATE users
      SET pubkey = ?, privkey = ?, user_id_ext = ?
      WHERE id = ?
    `);

    const result = stmt.run(
      user.pubkey,
      user.privkey,
      user.user_id_ext || "",
      user.id
    );

    return Promise.resolve(result.changes > 0);
  }

  /**
   * Delete a user
   * @param id - ID of the user to delete
   * @returns Promise resolving to true if user was deleted, false otherwise
   */
  async deleteUser(id: string): Promise<boolean> {
    const stmt = this.db.prepare("DELETE FROM users WHERE id = ?");
    const result = stmt.run(id);

    return Promise.resolve(result.changes > 0);
  }

  /**
   * Symbol.dispose method for releasing resources
   */
  [Symbol.dispose](): void {
    this.db.close();
  }
}
