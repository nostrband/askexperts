import { DBInterface, DBWallet } from "../../../db/interfaces.js";

/**
 * Get a wallet by name or use the default wallet
 *
 * @param name Wallet name
 * @returns The wallet object
 * @throws Error if wallet not found or no default wallet exists
 */
export async function getWalletByNameOrDefault(
  db: DBInterface,
  name?: string
): Promise<DBWallet> {
  
  let wallet: DBWallet | null;
  
  if (name) {
    // Get the specified wallet
    wallet = await db.getWalletByName(name);
    if (!wallet) {
      throw new Error(`Wallet '${name}' not found`);
    }
  } else {
    // Get the default wallet
    wallet = await db.getDefaultWallet();
    if (!wallet) {
      throw new Error("No default wallet found. Please specify a wallet with --wallet or set a default wallet.");
    }
  }
  
  return wallet;
}