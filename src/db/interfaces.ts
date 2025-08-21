/**
 * Database interfaces for experts, wallets, and docstore servers
 */

/**
 * Interface representing a user
 */
export interface DBUser {
  id: string;
  pubkey: string;
  privkey: string;
  user_id_ext?: string;
}

/**
 * Interface representing a wallet
 */
export interface DBWallet {
  id: string;
  name: string;
  nwc: string;
  default: boolean;
  user_id: string;
}

/**
 * Interface representing an expert
 */
export interface DBExpert {
  pubkey: string;
  wallet_id?: string;
  type?: string;
  nickname?: string;
  env?: string;
  docstores?: string;
  privkey?: string;
  disabled?: boolean;
  user_id?: string;
  timestamp?: number;
  description?: string;
  picture?: string;
  hashtags?: string;
  model?: string;
  temperature?: string;
  system_prompt?: string;
  discovery_hashtags?: string;
  discovery_relays?: string;
  prompt_relays?: string;
  price_base?: number;
  price_margin?: string;
}

/**
 * Interface for database operations excluding user-related methods
 * Combines wallet and expert operations
 */
export interface DBInterface {
  // Wallet methods
  listWallets(): Promise<DBWallet[]>;
  listWalletsByIds(ids: string[]): Promise<DBWallet[]>;
  getWallet(id: string): Promise<DBWallet | null>;
  getWalletByName(name: string): Promise<DBWallet | null>;
  getDefaultWallet(): Promise<DBWallet | null>;
  insertWallet(wallet: Omit<DBWallet, "id">): Promise<string>;
  updateWallet(wallet: DBWallet): Promise<boolean>;
  deleteWallet(id: string): Promise<boolean>;

  // Expert methods
  listExperts(): Promise<DBExpert[]>;
  listExpertsByIds(ids: string[]): Promise<DBExpert[]>;
  listExpertsAfter(timestamp: number, limit?: number): Promise<DBExpert[]>;
  getExpert(pubkey: string): Promise<DBExpert | null>;
  insertExpert(expert: DBExpert): Promise<boolean>;
  updateExpert(expert: DBExpert): Promise<boolean>;
  setExpertDisabled(pubkey: string, disabled: boolean): Promise<boolean>;
  deleteExpert(pubkey: string): Promise<boolean>;

  getUserId(): Promise<string>;

  // Resource cleanup
  [Symbol.dispose](): void;
}