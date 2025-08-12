import { getWalletClient } from "../../../wallet/utils.js";
import { WalletClient } from "../../../wallet/WalletClient.js";
import { RemoteClient } from "../../../remote/RemoteClient.js";

/**
 * Options for wallet commands with remote support
 */
export interface WalletCommandOptions {
  wallet?: string;
  remote?: boolean;
  url?: string;
  [key: string]: any; // Allow other options
}

/**
 * Create a wallet client based on command options
 * 
 * @param options Command options
 * @returns A wallet client instance
 */
export function createWalletClient(options: WalletCommandOptions): WalletClient {
  // Use remote client if remote flag is set
  if (options.remote) {
    // Use the provided URL or default to https://walletapi.askexperts.io
    const serverUrl = options.url || "https://walletapi.askexperts.io";
    
    // Create a RemoteClient to get the private key
    const remoteClient = new RemoteClient();
    const privateKey = remoteClient.getPrivateKey();
    
    // Create a WalletRemoteClient with the server URL and private key
    return getWalletClient(serverUrl, privateKey);
  } else {
    // Use local client
    return getWalletClient();
  }
}