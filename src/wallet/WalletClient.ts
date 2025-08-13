import { DBWallet } from "../db/interfaces.js";

/**
 * Interface for wallet-related operations
 * Provides methods for managing wallets with async support
 */
export interface WalletClient {
  /**
   * List all wallets
   * @returns Promise resolving to an array of wallet objects
   */
  listWallets(): Promise<DBWallet[]>;

  /**
   * List wallets by specific IDs
   * @param ids - Array of wallet IDs to retrieve
   * @returns Promise resolving to an array of wallet objects matching the provided IDs
   */
  listWalletsByIds(ids: string[]): Promise<DBWallet[]>;

  /**
   * Get a wallet by ID
   * @param id - ID of the wallet to get
   * @returns Promise resolving to the wallet if found, null otherwise
   */
  getWallet(id: string): Promise<DBWallet | null>;

  /**
   * Get a wallet by name
   * @param name - Name of the wallet to get
   * @returns Promise resolving to the wallet if found, null otherwise
   */
  getWalletByName(name: string): Promise<DBWallet | null>;

  /**
   * Get the default wallet
   * @returns Promise resolving to the default wallet if found, null otherwise
   */
  getDefaultWallet(): Promise<DBWallet | null>;

  /**
   * Insert a new wallet
   * @param wallet - Wallet to insert (without id)
   * @returns Promise resolving to the ID of the inserted wallet
   */
  insertWallet(wallet: Omit<DBWallet, "id">): Promise<string>;

  /**
   * Update an existing wallet
   * @param wallet - Wallet to update
   * @returns Promise resolving to true if wallet was updated, false otherwise
   */
  updateWallet(wallet: DBWallet): Promise<boolean>;

  /**
   * Delete a wallet
   * @param id - ID of the wallet to delete
   * @returns Promise resolving to true if wallet was deleted, false otherwise
   */
  deleteWallet(id: string): Promise<boolean>;
}