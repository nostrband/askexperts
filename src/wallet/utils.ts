import { getDB } from "../db/index.js";
import { WalletClient } from "./WalletClient.js";
import { WalletRemoteClient } from "./WalletRemoteClient.js";

/**
 * Get a wallet client instance
 * @param url Optional URL for remote wallet client
 * @param privateKey Optional private key for authentication
 * @returns A wallet client instance (DB if url is undefined, WalletRemoteClient otherwise)
 */
export function getWalletClient(url?: string, privateKey?: Uint8Array): WalletClient {
  if (url) {
    return new WalletRemoteClient(url, privateKey);
  }
  
  return getDB();
}