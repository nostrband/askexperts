/**
 * Database interfaces for experts, wallets, and docstore servers
 */

/**
 * Interface representing a wallet
 */
export interface DBWallet {
  id: number;
  name: string;
  nwc: string;
  default: boolean;
  user_id?: string;
}

/**
 * Interface representing an expert
 */
export interface DBExpert {
  pubkey: string;
  wallet_id: number;
  type: string;
  nickname: string;
  env: string;
  docstores: string;
  privkey?: string;
  disabled?: boolean;
  user_id?: string;
}