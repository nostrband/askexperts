import type { DBInterface, DBWallet, DBExpert } from "./interfaces.js";
import { debugDB, debugError } from "../common/debug.js";
import { createAuthToken } from "../common/auth.js";

/**
 * Remote implementation of the DBInterface
 * Uses fetch to communicate with a DBServer instance
 */
export class DBRemoteClient implements DBInterface {
  private baseUrl: string;
  private privateKey?: Uint8Array;

  /**
   * Creates a new DBRemoteClient instance
   * @param url - URL of the DBServer (e.g., 'http://localhost:3000/api')
   * @param privateKey - Optional private key for authentication (as Uint8Array)
   */
  constructor(url: string, privateKey?: Uint8Array) {
    // Ensure the URL doesn't end with a slash
    this.baseUrl = url.endsWith("/") ? url.slice(0, -1) : url;
    this.privateKey = privateKey;

    debugDB(`Connecting to remote DB server at ${url}`);
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
      debugError("Error in DBRemoteClient.listWallets:", error);
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
      debugError("Error in DBRemoteClient.listWalletsByIds:", error);
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
      debugError(`Error in DBRemoteClient.getWallet(${id}):`, error);
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
      debugError(`Error in DBRemoteClient.getWalletByName(${name}):`, error);
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
      debugError("Error in DBRemoteClient.getDefaultWallet:", error);
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
      debugError("Error in DBRemoteClient.insertWallet:", error);
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
      debugError(`Error in DBRemoteClient.updateWallet(${wallet.id}):`, error);
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
      debugError(`Error in DBRemoteClient.deleteWallet(${id}):`, error);
      return false;
    }
  }

  /**
   * List all experts
   * @returns Promise resolving to an array of expert objects
   */
  async listExperts(): Promise<DBExpert[]> {
    try {
      const url = `${this.baseUrl}/experts`;
      const headers = this.createHeaders('GET', url);
      
      const response = await fetch(url, { headers });
      
      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(`Failed to list experts: ${response.status} ${response.statusText} - ${errorData.message || ''}`);
      }
      
      return await response.json();
    } catch (error) {
      debugError("Error in DBRemoteClient.listExperts:", error);
      throw error;
    }
  }

  /**
   * List experts by specific IDs
   * @param ids - Array of expert pubkeys to retrieve
   * @returns Promise resolving to an array of expert objects matching the provided IDs
   */
  async listExpertsByIds(ids: string[]): Promise<DBExpert[]> {
    try {
      if (!ids.length) {
        return [];
      }

      // For now, we'll fetch all experts and filter them client-side
      // In a future implementation, this could be optimized with a dedicated endpoint
      const allExperts = await this.listExperts();
      return allExperts.filter(expert => ids.includes(expert.pubkey));
    } catch (error) {
      debugError("Error in DBRemoteClient.listExpertsByIds:", error);
      throw error;
    }
  }

  /**
   * Get an expert by pubkey
   * @param pubkey - Pubkey of the expert to get
   * @returns Promise resolving to the expert if found, null otherwise
   */
  async getExpert(pubkey: string): Promise<DBExpert | null> {
    try {
      const url = `${this.baseUrl}/experts/${pubkey}`;
      const headers = this.createHeaders('GET', url);
      
      const response = await fetch(url, { headers });
      
      if (response.status === 404) {
        return null;
      }
      
      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(`Failed to get expert: ${response.status} ${response.statusText} - ${errorData.message || ''}`);
      }
      
      return await response.json();
    } catch (error) {
      debugError(`Error in DBRemoteClient.getExpert(${pubkey}):`, error);
      throw error;
    }
  }

  /**
   * Insert a new expert
   * @param expert - Expert to insert
   * @returns Promise resolving to true if expert was inserted, false otherwise
   */
  async insertExpert(expert: DBExpert): Promise<boolean> {
    try {
      const url = `${this.baseUrl}/experts`;
      const headers = this.createHeaders('POST', url);
      
      const response = await fetch(url, {
        method: 'POST',
        headers,
        body: JSON.stringify(expert),
      });
      
      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        debugError(`Failed to insert expert: ${response.status} ${response.statusText} - ${errorData.message || ''}`);
        return false;
      }
      
      const result = await response.json();
      return result.success === true;
    } catch (error) {
      debugError(`Error in DBRemoteClient.insertExpert(${expert.pubkey}):`, error);
      return false;
    }
  }

  /**
   * Update an existing expert
   * @param expert - Expert to update
   * @returns Promise resolving to true if expert was updated, false otherwise
   */
  async updateExpert(expert: DBExpert): Promise<boolean> {
    try {
      const url = `${this.baseUrl}/experts/${expert.pubkey}`;
      const headers = this.createHeaders('PUT', url);
      
      const response = await fetch(url, {
        method: 'PUT',
        headers,
        body: JSON.stringify(expert),
      });
      
      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        debugError(`Failed to update expert: ${response.status} ${response.statusText} - ${errorData.message || ''}`);
        return false;
      }
      
      const result = await response.json();
      return result.success === true;
    } catch (error) {
      debugError(`Error in DBRemoteClient.updateExpert(${expert.pubkey}):`, error);
      return false;
    }
  }

  /**
   * Set the disabled status of an expert
   * @param pubkey - Pubkey of the expert to update
   * @param disabled - Whether the expert should be disabled
   * @returns Promise resolving to true if expert was updated, false otherwise
   */
  async setExpertDisabled(pubkey: string, disabled: boolean): Promise<boolean> {
    try {
      const url = `${this.baseUrl}/experts/${pubkey}/disabled`;
      const headers = this.createHeaders('PUT', url);
      
      const response = await fetch(url, {
        method: 'PUT',
        headers,
        body: JSON.stringify({ disabled }),
      });
      
      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        debugError(`Failed to set expert disabled status: ${response.status} ${response.statusText} - ${errorData.message || ''}`);
        return false;
      }
      
      const result = await response.json();
      return result.success === true;
    } catch (error) {
      debugError(`Error in DBRemoteClient.setExpertDisabled(${pubkey}, ${disabled}):`, error);
      return false;
    }
  }

  /**
   * Delete an expert
   * @param pubkey - Pubkey of the expert to delete
   * @returns Promise resolving to true if expert was deleted, false otherwise
   */
  async deleteExpert(pubkey: string): Promise<boolean> {
    try {
      const url = `${this.baseUrl}/experts/${pubkey}`;
      const headers = this.createHeaders('DELETE', url);
      
      const response = await fetch(url, {
        method: 'DELETE',
        headers,
      });
      
      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        debugError(`Failed to delete expert: ${response.status} ${response.statusText} - ${errorData.message || ''}`);
        return false;
      }
      
      const result = await response.json();
      return result.success === true;
    } catch (error) {
      debugError(`Error in DBRemoteClient.deleteExpert(${pubkey}):`, error);
      return false;
    }
  }

  /**
   * Get the current user ID
   * @returns Promise resolving to the current user ID
   */
  async getUserId(): Promise<string> {
    try {
      const url = `${this.baseUrl}/whoami`;
      const headers = this.createHeaders('GET', url);
      
      const response = await fetch(url, { headers });
      
      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(`Failed to get user ID: ${response.status} ${response.statusText} - ${errorData.message || ''}`);
      }
      
      const result = await response.json();
      return result.user_id;
    } catch (error) {
      debugError("Error in DBRemoteClient.getUserId:", error);
      throw error;
    }
  }

  /**
   * Symbol.dispose method for releasing resources
   */
  [Symbol.dispose](): void {
    // No resources to release
  }
}