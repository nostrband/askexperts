import { DatabaseSync } from "node:sqlite";
import { DBWallet, DBExpert, DBUser, DBInterface } from "./interfaces.js";
import { debugDB, debugError } from "../common/debug.js";
import { ExpertClient } from "../experts/ExpertClient.js";
import { WalletClient } from "../wallet/WalletClient.js";
import crypto from "crypto";

/**
 * SQLite implementation of the database for experts, wallets, and docstore servers
 */
export class DB implements DBInterface, ExpertClient, WalletClient {
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
    this.db.exec('PRAGMA journal_mode = WAL;');
    // Wait up to 3 seconds for locks
    this.db.exec('PRAGMA busy_timeout = 3000;');

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
    this.db.exec("CREATE INDEX IF NOT EXISTS idx_wallets_default ON wallets (default_wallet)");
    this.db.exec("CREATE INDEX IF NOT EXISTS idx_wallets_user_id ON wallets (user_id)");

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
        user_id TEXT NOT NULL
      )
    `);
    
    // Create indexes for experts that can't be included in the CREATE TABLE
    this.db.exec("CREATE INDEX IF NOT EXISTS idx_experts_wallet_id ON experts (wallet_id)");
    this.db.exec("CREATE INDEX IF NOT EXISTS idx_experts_type ON experts (type)");
    this.db.exec("CREATE INDEX IF NOT EXISTS idx_experts_user_id ON experts (user_id)");

    // Create users table with all columns and indexes
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS users (
        id TEXT PRIMARY KEY,
        pubkey TEXT NOT NULL UNIQUE,
        privkey TEXT NOT NULL
      )
    `);
    
    // Create index for users
    this.db.exec("CREATE INDEX IF NOT EXISTS idx_users_pubkey ON users (pubkey)");
  }

  /**
   * List all wallets
   * @returns Array of wallet objects
   */
  async listWallets(): Promise<DBWallet[]> {
    const stmt = this.db.prepare("SELECT id, name, nwc, default_wallet as 'default' FROM wallets ORDER BY id ASC");
    const rows = stmt.all();

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
    const placeholders = ids.map(() => '?').join(',');
    const stmt = this.db.prepare(`SELECT id, name, nwc, default_wallet as 'default' FROM wallets WHERE id IN (${placeholders}) ORDER BY id ASC`);
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
   * @returns The wallet if found, null otherwise
   */
  async getWallet(id: string): Promise<DBWallet | null> {
    const stmt = this.db.prepare("SELECT id, name, nwc, default_wallet as 'default' FROM wallets WHERE id = ?");
    const row = stmt.get(id);

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
   * @returns The wallet if found, null otherwise
   */
  async getWalletByName(name: string): Promise<DBWallet | null> {
    const stmt = this.db.prepare("SELECT id, name, nwc, default_wallet as 'default' FROM wallets WHERE name = ?");
    const row = stmt.get(name);

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
   * @returns The default wallet if found, null otherwise
   */
  async getDefaultWallet(): Promise<DBWallet | null> {
    const stmt = this.db.prepare("SELECT id, name, nwc, default_wallet as 'default' FROM wallets WHERE default_wallet = 1 LIMIT 1");
    const row = stmt.get();

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
    const walletCount = this.db.prepare("SELECT COUNT(*) as count FROM wallets").get();
    const count = walletCount ? Number(walletCount.count) : 0;
    const isFirstWallet = count === 0;
    
    // If this wallet is set as default or it's the first wallet, unset any existing default wallet
    if (wallet.default || isFirstWallet) {
      this.db.prepare("UPDATE wallets SET default_wallet = 0 WHERE default_wallet = 1").run();
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
      wallet.user_id || ""
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
      this.db.prepare("UPDATE wallets SET default_wallet = 0 WHERE default_wallet = 1 AND id != ?").run(wallet.id);
    }

    const stmt = this.db.prepare(`
      UPDATE wallets
      SET name = ?, nwc = ?, default_wallet = ?, user_id = ?
      WHERE id = ?
    `);

    const result = stmt.run(
      wallet.name,
      wallet.nwc,
      wallet.default ? 1 : 0,
      wallet.user_id || "",
      wallet.id
    );

    return Promise.resolve(result.changes > 0);
  }

  /**
   * Delete a wallet
   * @param id - ID of the wallet to delete
   * @returns true if wallet was deleted, false otherwise
   */
  async deleteWallet(id: string): Promise<boolean> {
    // Check if there are any experts using this wallet
    const expertCount = this.db.prepare("SELECT COUNT(*) as count FROM experts WHERE wallet_id = ?").get(id);
    const count = expertCount ? Number(expertCount.count) : 0;
    if (count > 0) {
      return Promise.reject(new Error(`Cannot delete wallet with ID ${id} because it is used by ${count} experts`));
    }

    const stmt = this.db.prepare("DELETE FROM wallets WHERE id = ?");
    const result = stmt.run(id);

    return Promise.resolve(result.changes > 0);
  }

  /**
   * List all experts
   * @returns Promise resolving to an array of expert objects
   */
  async listExperts(): Promise<DBExpert[]> {
    const stmt = this.db.prepare("SELECT * FROM experts ORDER BY pubkey ASC");
    const rows = stmt.all();

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
   * List experts by specific IDs
   * @param ids - Array of expert pubkeys to retrieve
   * @returns Promise resolving to an array of expert objects matching the provided IDs
   */
  async listExpertsByIds(ids: string[]): Promise<DBExpert[]> {
    if (!ids.length) {
      return Promise.resolve([]);
    }

    // Create placeholders for the SQL query (?, ?, ?, etc.)
    const placeholders = ids.map(() => '?').join(',');
    const stmt = this.db.prepare(`SELECT * FROM experts WHERE pubkey IN (${placeholders}) ORDER BY pubkey ASC`);
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
   * @returns Promise resolving to the expert if found, null otherwise
   */
  async getExpert(pubkey: string): Promise<DBExpert | null> {
    const stmt = this.db.prepare("SELECT * FROM experts WHERE pubkey = ?");
    const row = stmt.get(pubkey);

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
    const wallet = await this.getWallet(expert.wallet_id);
    if (!wallet) {
      throw new Error(`Wallet with ID ${expert.wallet_id} does not exist`);
    }

    const stmt = this.db.prepare(`
      INSERT INTO experts (pubkey, wallet_id, type, nickname, env, docstores, privkey, disabled, user_id)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
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
        expert.user_id || ""
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
    const wallet = await this.getWallet(expert.wallet_id);
    if (!wallet) {
      throw new Error(`Wallet with ID ${expert.wallet_id} does not exist`);
    }

    const stmt = this.db.prepare(`
      UPDATE experts
      SET wallet_id = ?, type = ?, nickname = ?, env = ?, docstores = ?, privkey = ?, disabled = ?, user_id = ?
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
      expert.pubkey
    );

    return Promise.resolve(result.changes > 0);
  }

  /**
   * Set the disabled status of an expert
   * @param pubkey - Pubkey of the expert to update
   * @param disabled - Whether the expert should be disabled
   * @returns Promise resolving to true if expert was updated, false otherwise
   */
  async setExpertDisabled(pubkey: string, disabled: boolean): Promise<boolean> {
    const stmt = this.db.prepare(`
      UPDATE experts
      SET disabled = ?
      WHERE pubkey = ?
    `);

    const result = stmt.run(
      disabled ? 1 : 0,
      pubkey
    );

    return Promise.resolve(result.changes > 0);
  }

  /**
   * Delete an expert
   * @param pubkey - Pubkey of the expert to delete
   * @returns Promise resolving to true if expert was deleted, false otherwise
   */
  async deleteExpert(pubkey: string): Promise<boolean> {
    const stmt = this.db.prepare("DELETE FROM experts WHERE pubkey = ?");
    const result = stmt.run(pubkey);

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
        privkey: String(row.privkey || "")
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
      privkey: String(row.privkey || "")
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
      privkey: String(row.privkey || "")
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
      INSERT INTO users (id, pubkey, privkey)
      VALUES (?, ?, ?)
    `);

    // Generate a unique string ID (UUID)
    const id = crypto.randomUUID();
    
    try {
      stmt.run(
        id,
        user.pubkey,
        user.privkey
      );
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
      SET pubkey = ?, privkey = ?
      WHERE id = ?
    `);

    const result = stmt.run(
      user.pubkey,
      user.privkey,
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