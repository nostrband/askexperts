import { DBWallet } from "../../../db/interfaces.js";
import { getDB } from "../../../db/utils.js";

/**
 * Get a wallet by name or use the default wallet
 *
 * @param walletName Optional wallet name to look up
 * @returns The wallet object
 * @throws Error if wallet not found or no default wallet exists
 */
export function getWalletByNameOrDefault(walletName?: string): DBWallet {
  const db = getDB();
  
  let wallet: DBWallet | null;
  
  if (walletName) {
    // Get the specified wallet
    wallet = db.getWalletByName(walletName);
    if (!wallet) {
      throw new Error(`Wallet '${walletName}' not found`);
    }
  } else {
    // Get the default wallet
    wallet = db.getDefaultWallet();
    if (!wallet) {
      throw new Error("No default wallet found. Please specify a wallet with --wallet or set a default wallet.");
    }
  }
  
  return wallet;
}