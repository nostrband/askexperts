import type { DBWallet } from "../db/interfaces.js";
import type { WalletClient } from "./WalletClient.js";
import { debugError } from "../common/debug.js";
import { createAuthToken } from "../common/auth.js";

/**
 * Remote implementation of the WalletClient interface
 * Uses fetch to communicate with a WalletServer instance
 */
export class WalletRemoteClient implements WalletClient {
  private baseUrl: string;
  private privateKey?: Uint8Array;

  /**
   * Creates a new WalletRemoteClient instance
   * @param url - URL of the WalletServer (e.g., 'http://localhost:3000/api')
   * @param privateKey - Optional private key for authentication (as Uint8Array)
   */
  constructor(url: string, privateKey?: Uint8Array) {
    // Ensure the URL doesn't end with a slash
    this.baseUrl = url.endsWith("/") ? url.slice(0, -1) : url;
    this.privateKey = privateKey;
  }

  /**
   * Create request headers with authentication if privateKey is provided
   * @param method - HTTP method for the request
   * @param url - URL for the request
   * @returns Headers object with authentication if available
   */
  private createHeaders(method: string, url: string): HeadersInit {
    const headers: HeadersInit = {
      'Content-Type': 'application/json',
    };

    // Add authentication header if privateKey is provided
    if (this.privateKey) {
      const authToken = createAuthToken(this.privateKey, url, method);
      headers['Authorization'] = authToken;
    }

    return headers;
  }

  /**
   * List all wallets
   * @returns Promise resolving to an array of wallet objects
   */
  async listWallets(): Promise<DBWallet[]> {
    try {
      const url = `${this.baseUrl}/wallets`;
      const headers = this.createHeaders('GET', url);
      
      const response = await fetch(url, { headers });
      
      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(`Failed to list wallets: ${response.status} ${response.statusText} - ${errorData.message || ''}`);
      }
      
      return await response.json();
    } catch (error) {
      debugError("Error in WalletRemoteClient.listWallets:", error);
      throw error;
    }
  }

  /**
   * List wallets by specific IDs
   * @param ids - Array of wallet IDs to retrieve
   * @returns Promise resolving to an array of wallet objects matching the provided IDs
   */
  async listWalletsByIds(ids: string[]): Promise<DBWallet[]> {
    try {
      if (!ids.length) {
        return [];
      }

      // For now, we'll fetch all wallets and filter them client-side
      // In a future implementation, this could be optimized with a dedicated endpoint
      const allWallets = await this.listWallets();
      return allWallets.filter(wallet => ids.includes(wallet.id));
    } catch (error) {
      debugError("Error in WalletRemoteClient.listWalletsByIds:", error);
      throw error;
    }
  }

  /**
   * Get a wallet by ID
   * @param id - ID of the wallet to get
   * @returns Promise resolving to the wallet if found, null otherwise
   */
  async getWallet(id: string): Promise<DBWallet | null> {
    try {
      const url = `${this.baseUrl}/wallets/${id}`;
      const headers = this.createHeaders('GET', url);
      
      const response = await fetch(url, { headers });
      
      if (response.status === 404) {
        return null;
      }
      
      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(`Failed to get wallet: ${response.status} ${response.statusText} - ${errorData.message || ''}`);
      }
      
      return await response.json();
    } catch (error) {
      debugError(`Error in WalletRemoteClient.getWallet(${id}):`, error);
      throw error;
    }
  }

  /**
   * Get a wallet by name
   * @param name - Name of the wallet to get
   * @returns Promise resolving to the wallet if found, null otherwise
   */
  async getWalletByName(name: string): Promise<DBWallet | null> {
    try {
      const url = `${this.baseUrl}/wallets/name/${encodeURIComponent(name)}`;
      const headers = this.createHeaders('GET', url);
      
      const response = await fetch(url, { headers });
      
      if (response.status === 404) {
        return null;
      }
      
      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(`Failed to get wallet by name: ${response.status} ${response.statusText} - ${errorData.message || ''}`);
      }
      
      return await response.json();
    } catch (error) {
      debugError(`Error in WalletRemoteClient.getWalletByName(${name}):`, error);
      throw error;
    }
  }

  /**
   * Get the default wallet
   * @returns Promise resolving to the default wallet if found, null otherwise
   */
  async getDefaultWallet(): Promise<DBWallet | null> {
    try {
      const url = `${this.baseUrl}/wallets/default`;
      const headers = this.createHeaders('GET', url);
      
      const response = await fetch(url, { headers });
      
      if (response.status === 404) {
        return null;
      }
      
      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(`Failed to get default wallet: ${response.status} ${response.statusText} - ${errorData.message || ''}`);
      }
      
      return await response.json();
    } catch (error) {
      debugError("Error in WalletRemoteClient.getDefaultWallet:", error);
      throw error;
    }
  }

  /**
   * Insert a new wallet
   * @param wallet - Wallet to insert (without id)
   * @returns Promise resolving to the ID of the inserted wallet
   */
  async insertWallet(wallet: Omit<DBWallet, "id">): Promise<string> {
    try {
      const url = `${this.baseUrl}/wallets`;
      const headers = this.createHeaders('POST', url);
      
      const response = await fetch(url, {
        method: 'POST',
        headers,
        body: JSON.stringify(wallet),
      });
      
      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(`Failed to insert wallet: ${response.status} ${response.statusText} - ${errorData.message || ''}`);
      }
      
      const result = await response.json();
      return result.id;
    } catch (error) {
      debugError("Error in WalletRemoteClient.insertWallet:", error);
      throw error;
    }
  }

  /**
   * Update an existing wallet
   * @param wallet - Wallet to update
   * @returns Promise resolving to true if wallet was updated, false otherwise
   */
  async updateWallet(wallet: DBWallet): Promise<boolean> {
    try {
      const url = `${this.baseUrl}/wallets/${wallet.id}`;
      const headers = this.createHeaders('PUT', url);
      
      const response = await fetch(url, {
        method: 'PUT',
        headers,
        body: JSON.stringify(wallet),
      });
      
      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        debugError(`Failed to update wallet: ${response.status} ${response.statusText} - ${errorData.message || ''}`);
        return false;
      }
      
      const result = await response.json();
      return result.success === true;
    } catch (error) {
      debugError(`Error in WalletRemoteClient.updateWallet(${wallet.id}):`, error);
      return false;
    }
  }

  /**
   * Delete a wallet
   * @param id - ID of the wallet to delete
   * @returns Promise resolving to true if wallet was deleted, false otherwise
   */
  async deleteWallet(id: string): Promise<boolean> {
    try {
      const url = `${this.baseUrl}/wallets/${id}`;
      const headers = this.createHeaders('DELETE', url);
      
      const response = await fetch(url, {
        method: 'DELETE',
        headers,
      });
      
      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        debugError(`Failed to delete wallet: ${response.status} ${response.statusText} - ${errorData.message || ''}`);
        return false;
      }
      
      const result = await response.json();
      return result.success === true;
    } catch (error) {
      debugError(`Error in WalletRemoteClient.deleteWallet(${id}):`, error);
      return false;
    }
  }
}
