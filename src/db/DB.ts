import { DatabaseSync } from "node:sqlite";
import { DBDocServer, DBWallet, DBExpert } from "./interfaces.js";
import { debugDB, debugError } from "../common/debug.js";
import { ExpertClient } from "../experts/ExpertClient.js";

/**
 * SQLite implementation of the database for experts, wallets, and docstore servers
 */
export class DB implements ExpertClient {
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

    // Create docservers table
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS docservers (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        type TEXT NOT NULL,
        url TEXT NOT NULL,
        credentials TEXT NOT NULL
      )
    `);

    // Create wallets table
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS wallets (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        nwc TEXT NOT NULL,
        default_wallet BOOLEAN NOT NULL DEFAULT 0
      )
    `);

    // Create experts table
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS experts (
        pubkey TEXT PRIMARY KEY,
        wallet_id INTEGER NOT NULL,
        type TEXT NOT NULL,
        nickname TEXT NOT NULL,
        env TEXT NOT NULL,
        docstores TEXT NOT NULL,
        privkey TEXT,
        disabled BOOLEAN NOT NULL DEFAULT 0,
        FOREIGN KEY (wallet_id) REFERENCES wallets(id)
      )
    `);

    // Create indexes for better query performance
    this.db.exec("CREATE INDEX IF NOT EXISTS idx_wallets_default ON wallets (default_wallet)");
    this.db.exec("CREATE UNIQUE INDEX IF NOT EXISTS idx_wallets_name ON wallets (name)");
    this.db.exec("CREATE INDEX IF NOT EXISTS idx_experts_wallet_id ON experts (wallet_id)");
    this.db.exec("CREATE INDEX IF NOT EXISTS idx_experts_type ON experts (type)");
    this.db.exec("CREATE UNIQUE INDEX IF NOT EXISTS idx_experts_pubkey ON experts (pubkey)");
    this.db.exec("CREATE UNIQUE INDEX IF NOT EXISTS idx_experts_nickname ON experts (nickname)");
  }

  /**
   * List all docstore servers
   * @returns Array of docstore server objects
   */
  listDocServers(): DBDocServer[] {
    const stmt = this.db.prepare("SELECT * FROM docservers ORDER BY id ASC");
    const rows = stmt.all();

    return rows.map(
      (row: Record<string, any>): DBDocServer => ({
        id: Number(row.id || 0),
        name: String(row.name || ""),
        type: String(row.type || ""),
        url: String(row.url || ""),
        credentials: String(row.credentials || ""),
      })
    );
  }

  /**
   * Get a docstore server by ID
   * @param id - ID of the docstore server to get
   * @returns The docstore server if found, null otherwise
   */
  getDocServer(id: number): DBDocServer | null {
    const stmt = this.db.prepare("SELECT * FROM docservers WHERE id = ?");
    const row = stmt.get(id);

    if (!row) {
      return null;
    }

    return {
      id: Number(row.id || 0),
      name: String(row.name || ""),
      type: String(row.type || ""),
      url: String(row.url || ""),
      credentials: String(row.credentials || ""),
    };
  }

  /**
   * Insert a new docstore server
   * @param docServer - Docstore server to insert (without id)
   * @returns ID of the inserted docstore server
   */
  insertDocServer(docServer: Omit<DBDocServer, "id">): number {
    const stmt = this.db.prepare(`
      INSERT INTO docservers (name, type, url, credentials)
      VALUES (?, ?, ?, ?)
    `);

    const result = stmt.run(
      docServer.name,
      docServer.type,
      docServer.url,
      docServer.credentials
    );

    return result.lastInsertRowid as number;
  }

  /**
   * Update an existing docstore server
   * @param docServer - Docstore server to update
   * @returns true if docstore server was updated, false otherwise
   */
  updateDocServer(docServer: DBDocServer): boolean {
    const stmt = this.db.prepare(`
      UPDATE docservers
      SET name = ?, type = ?, url = ?, credentials = ?
      WHERE id = ?
    `);

    const result = stmt.run(
      docServer.name,
      docServer.type,
      docServer.url,
      docServer.credentials,
      docServer.id
    );

    return result.changes > 0;
  }

  /**
   * Delete a docstore server
   * @param id - ID of the docstore server to delete
   * @returns true if docstore server was deleted, false otherwise
   */
  deleteDocServer(id: number): boolean {
    const stmt = this.db.prepare("DELETE FROM docservers WHERE id = ?");
    const result = stmt.run(id);

    return result.changes > 0;
  }

  /**
   * List all wallets
   * @returns Array of wallet objects
   */
  listWallets(): DBWallet[] {
    const stmt = this.db.prepare("SELECT id, name, nwc, default_wallet as 'default' FROM wallets ORDER BY id ASC");
    const rows = stmt.all();

    return rows.map(
      (row: Record<string, any>): DBWallet => ({
        id: Number(row.id || 0),
        name: String(row.name || ""),
        nwc: String(row.nwc || ""),
        default: Boolean(row.default || false),
      })
    );
  }

  /**
   * Get a wallet by ID
   * @param id - ID of the wallet to get
   * @returns The wallet if found, null otherwise
   */
  getWallet(id: number): DBWallet | null {
    const stmt = this.db.prepare("SELECT id, name, nwc, default_wallet as 'default' FROM wallets WHERE id = ?");
    const row = stmt.get(id);

    if (!row) {
      return null;
    }

    return {
      id: Number(row.id || 0),
      name: String(row.name || ""),
      nwc: String(row.nwc || ""),
      default: Boolean(row.default || false),
    };
  }

  /**
   * Get a wallet by name
   * @param name - Name of the wallet to get
   * @returns The wallet if found, null otherwise
   */
  getWalletByName(name: string): DBWallet | null {
    const stmt = this.db.prepare("SELECT id, name, nwc, default_wallet as 'default' FROM wallets WHERE name = ?");
    const row = stmt.get(name);

    if (!row) {
      return null;
    }

    return {
      id: Number(row.id || 0),
      name: String(row.name || ""),
      nwc: String(row.nwc || ""),
      default: Boolean(row.default || false),
    };
  }

  /**
   * Get the default wallet
   * @returns The default wallet if found, null otherwise
   */
  getDefaultWallet(): DBWallet | null {
    const stmt = this.db.prepare("SELECT id, name, nwc, default_wallet as 'default' FROM wallets WHERE default_wallet = 1 LIMIT 1");
    const row = stmt.get();

    if (!row) {
      return null;
    }

    return {
      id: Number(row.id || 0),
      name: String(row.name || ""),
      nwc: String(row.nwc || ""),
      default: Boolean(row.default || false),
    };
  }

  /**
   * Insert a new wallet
   * @param wallet - Wallet to insert (without id)
   * @returns ID of the inserted wallet
   */
  insertWallet(wallet: Omit<DBWallet, "id">): number {
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
      INSERT INTO wallets (name, nwc, default_wallet)
      VALUES (?, ?, ?)
    `);

    const result = stmt.run(
      wallet.name,
      wallet.nwc,
      wallet.default ? 1 : 0
    );

    return result.lastInsertRowid as number;
  }

  /**
   * Update an existing wallet
   * @param wallet - Wallet to update
   * @returns true if wallet was updated, false otherwise
   */
  updateWallet(wallet: DBWallet): boolean {
    // If this wallet is set as default, unset any existing default wallet
    if (wallet.default) {
      this.db.prepare("UPDATE wallets SET default_wallet = 0 WHERE default_wallet = 1 AND id != ?").run(wallet.id);
    }

    const stmt = this.db.prepare(`
      UPDATE wallets
      SET name = ?, nwc = ?, default_wallet = ?
      WHERE id = ?
    `);

    const result = stmt.run(
      wallet.name,
      wallet.nwc,
      wallet.default ? 1 : 0,
      wallet.id
    );

    return result.changes > 0;
  }

  /**
   * Delete a wallet
   * @param id - ID of the wallet to delete
   * @returns true if wallet was deleted, false otherwise
   */
  deleteWallet(id: number): boolean {
    // Check if there are any experts using this wallet
    const expertCount = this.db.prepare("SELECT COUNT(*) as count FROM experts WHERE wallet_id = ?").get(id);
    const count = expertCount ? Number(expertCount.count) : 0;
    if (count > 0) {
      throw new Error(`Cannot delete wallet with ID ${id} because it is used by ${count} experts`);
    }

    const stmt = this.db.prepare("DELETE FROM wallets WHERE id = ?");
    const result = stmt.run(id);

    return result.changes > 0;
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
        wallet_id: Number(row.wallet_id || 0),
        type: String(row.type || ""),
        nickname: String(row.nickname || ""),
        env: String(row.env || ""),
        docstores: String(row.docstores || ""),
        privkey: row.privkey ? String(row.privkey) : undefined,
        disabled: Boolean(row.disabled || false),
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
      wallet_id: Number(row.wallet_id || 0),
      type: String(row.type || ""),
      nickname: String(row.nickname || ""),
      env: String(row.env || ""),
      docstores: String(row.docstores || ""),
      privkey: row.privkey ? String(row.privkey) : undefined,
      disabled: Boolean(row.disabled || false),
    };
    
    return Promise.resolve(expert);
  }

  /**
   * Insert a new expert
   * @param expert - Expert to insert
   * @returns Promise resolving to true if expert was inserted, false otherwise
   */
  async insertExpert(expert: DBExpert): Promise<boolean> {
    // Check if wallet exists - using the synchronous getWallet method
    // since we're not changing wallet methods to async in this refactoring
    const wallet = this.getWallet(expert.wallet_id);
    if (!wallet) {
      throw new Error(`Wallet with ID ${expert.wallet_id} does not exist`);
    }

    const stmt = this.db.prepare(`
      INSERT INTO experts (pubkey, wallet_id, type, nickname, env, docstores, privkey, disabled)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
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
        expert.disabled ? 1 : 0
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
    // Check if wallet exists - using the synchronous getWallet method
    // since we're not changing wallet methods to async in this refactoring
    const wallet = this.getWallet(expert.wallet_id);
    if (!wallet) {
      throw new Error(`Wallet with ID ${expert.wallet_id} does not exist`);
    }

    const stmt = this.db.prepare(`
      UPDATE experts
      SET wallet_id = ?, type = ?, nickname = ?, env = ?, docstores = ?, privkey = ?, disabled = ?
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
   * Symbol.dispose method for releasing resources
   */
  [Symbol.dispose](): void {
    this.db.close();
  }
}