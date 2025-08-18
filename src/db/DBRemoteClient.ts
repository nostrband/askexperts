import type { DBInterface, DBWallet, DBExpert } from "./interfaces.js";
import { debugDB, debugError } from "../common/debug.js";
import { createAuthToken } from "../common/auth.js";
import { bytesToHex } from "nostr-tools/utils";

/**
 * Remote implementation of the DBInterface
 * Uses fetch to communicate with a DBServer instance
 */
/**
 * Configuration options for DBRemoteClient
 */
export interface DBRemoteClientOptions {
  /** URL of the DBServer, default 'https://api.askexperts.io' */
  url?: string;
  /** Optional private key for authentication (as Uint8Array) */
  privateKey?: Uint8Array;
  /**
   * Optional token for bearer authentication
   * Can be a string or a callback function that returns a Promise<string>
   */
  token?: string | (() => Promise<string>);
}

export class DBRemoteClient implements DBInterface {
  private baseUrl: string;
  private privateKey?: Uint8Array;
  #token?: string | (() => Promise<string>);

  /**
   * Creates a new DBRemoteClient instance
   * @param options - Configuration options for the client
   */
  constructor(options: DBRemoteClientOptions) {
    // Ensure the URL doesn't end with a slash
    this.baseUrl = options.url || 'https://api.askexperts.io' ;
    this.baseUrl = this.baseUrl.endsWith("/") ? this.baseUrl.slice(0, -1) : this.baseUrl;
    this.privateKey = options.privateKey;
    this.#token = options.token;

    debugDB(`Connecting to remote DB server at ${options.url}`);
  }

  /**
   * Create request headers with authentication if privateKey is provided
   * @param method - HTTP method for the request
   * @param url - URL for the request
   * @returns Headers object with authentication if available
   */
  private async createHeaders(
    method: string,
    url: string,
    bodyString?: string
  ): Promise<HeadersInit> {
    const headers: HeadersInit = {
      "Content-Type": "application/json",
    };

    // Add token-based authentication if token is provided
    if (this.#token) {
      // If token is a callback function, call it to get the actual token
      const tokenValue = typeof this.#token === 'function'
        ? await this.#token()
        : this.#token;
      
      headers["Authorization"] = `Bearer ${tokenValue}`;
    }
    // Otherwise use privateKey-based authentication if available
    else if (this.privateKey) {
      const authToken = createAuthToken(
        this.privateKey,
        url,
        method,
        bodyString
      );
      headers["Authorization"] = authToken;
    }

    return headers;
  }

  get token(): string | (() => Promise<string>) | undefined {
    return this.#token;
  }

  set token(value: string | (() => Promise<string>) | undefined) {
    this.#token = value;
  }

  /**
   * List all wallets
   * @returns Promise resolving to an array of wallet objects
   */
  async listWallets(): Promise<DBWallet[]> {
    try {
      const url = `${this.baseUrl}/wallets`;
      const headers = await this.createHeaders("GET", url);

      const response = await fetch(url, { headers });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(
          `Failed to list wallets: ${response.status} ${
            response.statusText
          } - ${errorData.message || ""}`
        );
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
      return allWallets.filter((wallet) => ids.includes(wallet.id));
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
      const headers = await this.createHeaders("GET", url);

      const response = await fetch(url, { headers });

      if (response.status === 404) {
        return null;
      }

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(
          `Failed to get wallet: ${response.status} ${response.statusText} - ${
            errorData.message || ""
          }`
        );
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
      const headers = await this.createHeaders("GET", url);

      const response = await fetch(url, { headers });

      if (response.status === 404) {
        return null;
      }

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(
          `Failed to get wallet by name: ${response.status} ${
            response.statusText
          } - ${errorData.message || ""}`
        );
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
      const headers = await this.createHeaders("GET", url);

      const response = await fetch(url, { headers });

      if (response.status === 404) {
        return null;
      }

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(
          `Failed to get default wallet: ${response.status} ${
            response.statusText
          } - ${errorData.message || ""}`
        );
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
      const bodyString = JSON.stringify(wallet);
      const headers = await this.createHeaders("POST", url, bodyString);

      const response = await fetch(url, {
        method: "POST",
        headers,
        body: bodyString,
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(
          `Failed to insert wallet: ${response.status} ${
            response.statusText
          } - ${errorData.message || ""}`
        );
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
      const bodyString = JSON.stringify(wallet);
      const headers = await this.createHeaders("PUT", url, bodyString);

      const response = await fetch(url, {
        method: "PUT",
        headers,
        body: bodyString,
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        debugError(
          `Failed to update wallet: ${response.status} ${
            response.statusText
          } - ${errorData.message || ""}`
        );
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
      const headers = await this.createHeaders("DELETE", url);

      const response = await fetch(url, {
        method: "DELETE",
        headers,
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        debugError(
          `Failed to delete wallet: ${response.status} ${
            response.statusText
          } - ${errorData.message || ""}`
        );
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
      const headers = await this.createHeaders("GET", url);

      const response = await fetch(url, { headers });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(
          `Failed to list experts: ${response.status} ${
            response.statusText
          } - ${errorData.message || ""}`
        );
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
      return allExperts.filter((expert) => ids.includes(expert.pubkey));
    } catch (error) {
      debugError("Error in DBRemoteClient.listExpertsByIds:", error);
      throw error;
    }
  }

  /**
   * List experts with timestamp newer than the provided timestamp
   * @param timestamp - Only return experts with timestamp newer than this
   * @param limit - Maximum number of experts to return (default: 1000)
   * @returns Promise resolving to an array of expert objects
   */
  async listExpertsAfter(timestamp: number, limit = 1000): Promise<DBExpert[]> {
    try {
      const url = `${this.baseUrl}/experts/after/${timestamp}?limit=${limit}`;
      const headers = await this.createHeaders("GET", url);

      const response = await fetch(url, { headers });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(
          `Failed to list experts after timestamp: ${response.status} ${
            response.statusText
          } - ${errorData.message || ""}`
        );
      }

      return await response.json();
    } catch (error) {
      debugError(`Error in DBRemoteClient.listExpertsAfter(${timestamp}):`, error);
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
      const headers = await this.createHeaders("GET", url);

      const response = await fetch(url, { headers });

      if (response.status === 404) {
        return null;
      }

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(
          `Failed to get expert: ${response.status} ${response.statusText} - ${
            errorData.message || ""
          }`
        );
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
      const bodyString = JSON.stringify(expert);
      const headers = await this.createHeaders("POST", url, bodyString);

      const response = await fetch(url, {
        method: "POST",
        headers,
        body: bodyString,
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        debugError(
          `Failed to insert expert: ${response.status} ${
            response.statusText
          } - ${errorData.message || ""}`
        );
        return false;
      }

      const result = await response.json();
      return result.success === true;
    } catch (error) {
      debugError(
        `Error in DBRemoteClient.insertExpert(${expert.pubkey}):`,
        error
      );
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
      const bodyString = JSON.stringify(expert);
      const headers = await this.createHeaders("PUT", url, bodyString);

      const response = await fetch(url, {
        method: "PUT",
        headers,
        body: bodyString,
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        debugError(
          `Failed to update expert: ${response.status} ${
            response.statusText
          } - ${errorData.message || ""}`
        );
        return false;
      }

      const result = await response.json();
      return result.success === true;
    } catch (error) {
      debugError(
        `Error in DBRemoteClient.updateExpert(${expert.pubkey}):`,
        error
      );
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
      const bodyString = JSON.stringify({ disabled });
      const headers = await this.createHeaders("PUT", url, bodyString);

      const response = await fetch(url, {
        method: "PUT",
        headers,
        body: bodyString,
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        debugError(
          `Failed to set expert disabled status: ${response.status} ${
            response.statusText
          } - ${errorData.message || ""}`
        );
        return false;
      }

      const result = await response.json();
      return result.success === true;
    } catch (error) {
      debugError(
        `Error in DBRemoteClient.setExpertDisabled(${pubkey}, ${disabled}):`,
        error
      );
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
      const headers = await this.createHeaders("DELETE", url);

      const response = await fetch(url, {
        method: "DELETE",
        headers,
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        debugError(
          `Failed to delete expert: ${response.status} ${
            response.statusText
          } - ${errorData.message || ""}`
        );
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
      const headers = await this.createHeaders("GET", url);

      const response = await fetch(url, { headers });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(
          `Failed to get user ID: ${response.status} ${response.statusText} - ${
            errorData.message || ""
          }`
        );
      }

      const result = await response.json();
      return result.user_id;
    } catch (error) {
      debugError("Error in DBRemoteClient.getUserId:", error);
      throw error;
    }
  }

  /**
   * Sign up on the remote server
   * This will create a new user if one doesn't exist for the current pubkey
   *
   * @returns Promise resolving to the user ID
   */
  async signup(uploadPrivkey?: boolean): Promise<string> {
    try {
      const url = `${this.baseUrl}/signup`;
      const body: any = {};
      if (uploadPrivkey) {
        if (!this.privateKey) throw new Error("Can't signup without privkey");
        body.privkey = bytesToHex(this.privateKey);
      }
      const bodyString = JSON.stringify(body);
      const headers = await this.createHeaders("POST", url, bodyString);

      const response = await fetch(url, {
        method: "POST",
        headers,
        body: bodyString,
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(
          `Failed to sign up: ${response.status} ${response.statusText} - ${
            errorData.message || ""
          }`
        );
      }

      const result = await response.json();
      return result.user_id;
    } catch (error) {
      debugError("Error in DBRemoteClient.signup:", error);
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
