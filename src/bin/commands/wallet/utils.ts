import { DBWallet } from "../../../db/interfaces.js";
import { WalletCommandOptions, createWalletClient } from "./client.js";
import { getWalletClient } from "../../../wallet/utils.js";

/**
 * Get a wallet by name or use the default wallet
 *
 * @param optionsOrWalletName Command options or wallet name
 * @returns The wallet object
 * @throws Error if wallet not found or no default wallet exists
 */
export async function getWalletByNameOrDefault(
  optionsOrWalletName?: WalletCommandOptions | string
): Promise<DBWallet> {
  let walletClient;
  let walletName: string | undefined;
  
  // Handle both string and options object
  if (typeof optionsOrWalletName === 'string') {
    // Legacy usage with just wallet name
    walletName = optionsOrWalletName;
    walletClient = getWalletClient();
  } else if (optionsOrWalletName) {
    // New usage with options object
    walletName = optionsOrWalletName.wallet;
    walletClient = createWalletClient(optionsOrWalletName);
  } else {
    // No arguments provided
    walletClient = getWalletClient();
  }
  
  let wallet: DBWallet | null;
  
  if (walletName) {
    // Get the specified wallet
    wallet = await walletClient.getWalletByName(walletName);
    if (!wallet) {
      throw new Error(`Wallet '${walletName}' not found`);
    }
  } else {
    // Get the default wallet
    wallet = await walletClient.getDefaultWallet();
    if (!wallet) {
      throw new Error("No default wallet found. Please specify a wallet with --wallet or set a default wallet.");
    }
  }
  
  return wallet;
}