import { DBInterface, DBWallet, DBExpert } from "./interfaces.js";
import { DB } from "./DB.js";
import { getDB } from "./utils.js";
import { getCurrentUserId } from "../common/users.js";

/**
 * Client implementation of the DBInterface
 * Passes all calls to the DB instance except getUserId()
 */
export class DBClient implements DBInterface {
  private db: DB;

  /**
   * Creates a new DBClient instance
   */
  constructor() {
    this.db = getDB();
  }

  /**
   * List all wallets
   * @returns Promise resolving to an array of wallet objects
   */
  async listWallets(): Promise<DBWallet[]> {
    return this.db.listWallets();
  }

  /**
   * List wallets by specific IDs
   * @param ids - Array of wallet IDs to retrieve
   * @returns Promise resolving to an array of wallet objects matching the provided IDs
   */
  async listWalletsByIds(ids: string[]): Promise<DBWallet[]> {
    return this.db.listWalletsByIds(ids);
  }

  /**
   * Get a wallet by ID
   * @param id - ID of the wallet to get
   * @returns Promise resolving to the wallet if found, null otherwise
   */
  async getWallet(id: string): Promise<DBWallet | null> {
    return this.db.getWallet(id);
  }

  /**
   * Get a wallet by name
   * @param name - Name of the wallet to get
   * @returns Promise resolving to the wallet if found, null otherwise
   */
  async getWalletByName(name: string): Promise<DBWallet | null> {
    return this.db.getWalletByName(name);
  }

  /**
   * Get the default wallet
   * @returns Promise resolving to the default wallet if found, null otherwise
   */
  async getDefaultWallet(): Promise<DBWallet | null> {
    return this.db.getDefaultWallet();
  }

  /**
   * Insert a new wallet
   * @param wallet - Wallet to insert (without id)
   * @returns Promise resolving to the ID of the inserted wallet
   */
  async insertWallet(wallet: Omit<DBWallet, "id">): Promise<string> {
    return this.db.insertWallet(wallet);
  }

  /**
   * Update an existing wallet
   * @param wallet - Wallet to update
   * @returns Promise resolving to true if wallet was updated, false otherwise
   */
  async updateWallet(wallet: DBWallet): Promise<boolean> {
    return this.db.updateWallet(wallet);
  }

  /**
   * Delete a wallet
   * @param id - ID of the wallet to delete
   * @returns Promise resolving to true if wallet was deleted, false otherwise
   */
  async deleteWallet(id: string): Promise<boolean> {
    return this.db.deleteWallet(id);
  }

  /**
   * List all experts
   * @returns Promise resolving to an array of expert objects
   */
  async listExperts(): Promise<DBExpert[]> {
    return this.db.listExperts();
  }

  /**
   * List experts by specific IDs
   * @param ids - Array of expert pubkeys to retrieve
   * @returns Promise resolving to an array of expert objects matching the provided IDs
   */
  async listExpertsByIds(ids: string[]): Promise<DBExpert[]> {
    return this.db.listExpertsByIds(ids);
  }

  /**
   * Get an expert by pubkey
   * @param pubkey - Pubkey of the expert to get
   * @returns Promise resolving to the expert if found, null otherwise
   */
  async getExpert(pubkey: string): Promise<DBExpert | null> {
    return this.db.getExpert(pubkey);
  }

  /**
   * Insert a new expert
   * @param expert - Expert to insert
   * @returns Promise resolving to true if expert was inserted, false otherwise
   */
  async insertExpert(expert: DBExpert): Promise<boolean> {
    return this.db.insertExpert(expert);
  }

  /**
   * Update an existing expert
   * @param expert - Expert to update
   * @returns Promise resolving to true if expert was updated, false otherwise
   */
  async updateExpert(expert: DBExpert): Promise<boolean> {
    return this.db.updateExpert(expert);
  }

  /**
   * Set the disabled status of an expert
   * @param pubkey - Pubkey of the expert to update
   * @param disabled - Whether the expert should be disabled
   * @returns Promise resolving to true if expert was updated, false otherwise
   */
  async setExpertDisabled(pubkey: string, disabled: boolean): Promise<boolean> {
    return this.db.setExpertDisabled(pubkey, disabled);
  }

  /**
   * Delete an expert
   * @param pubkey - Pubkey of the expert to delete
   * @returns Promise resolving to true if expert was deleted, false otherwise
   */
  async deleteExpert(pubkey: string): Promise<boolean> {
    return this.db.deleteExpert(pubkey);
  }

  /**
   * Get the current user ID
   * @returns Promise resolving to the current user ID
   */
  async getUserId(): Promise<string> {
    return getCurrentUserId();
  }

  /**
   * Symbol.dispose method for releasing resources
   */
  [Symbol.dispose](): void {
    if (this.db && typeof this.db[Symbol.dispose] === 'function') {
      this.db[Symbol.dispose]();
    }
  }
}