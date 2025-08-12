import type { DBExpert } from "../db/interfaces.js";
import type { ExpertClient } from "./ExpertClient.js";
import { debugError } from "../common/debug.js";
import { getDB } from "../db/index.js";
import { createAuthToken } from "../common/auth.js";

/**
 * Remote implementation of the ExpertClient interface
 * Uses fetch to communicate with an ExpertServer instance
 */
export class ExpertRemoteClient implements ExpertClient {
  private baseUrl: string;
  private privateKey?: Uint8Array;

  /**
   * Creates a new ExpertRemoteClient instance
   * @param url - URL of the ExpertServer (e.g., 'http://localhost:3000/api')
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
      debugError("Error in ExpertRemoteClient.listExperts:", error);
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
      debugError("Error in ExpertRemoteClient.listExpertsByIds:", error);
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
      const url = `${this.baseUrl}/experts/${encodeURIComponent(pubkey)}`;
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
      debugError(`Error in ExpertRemoteClient.getExpert(${pubkey}):`, error);
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
      debugError(`Error in ExpertRemoteClient.insertExpert(${expert.pubkey}):`, error);
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
      const url = `${this.baseUrl}/experts/${encodeURIComponent(expert.pubkey)}`;
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
      debugError(`Error in ExpertRemoteClient.updateExpert(${expert.pubkey}):`, error);
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
      const url = `${this.baseUrl}/experts/${encodeURIComponent(pubkey)}/disabled`;
      const headers = this.createHeaders('PATCH', url);
      
      const response = await fetch(url, {
        method: 'PATCH',
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
      debugError(`Error in ExpertRemoteClient.setExpertDisabled(${pubkey}, ${disabled}):`, error);
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
      const url = `${this.baseUrl}/experts/${encodeURIComponent(pubkey)}`;
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
      debugError(`Error in ExpertRemoteClient.deleteExpert(${pubkey}):`, error);
      return false;
    }
  }
}


/**
 * Get an ExpertClient instance
 * @param url - Optional URL for remote expert client
 * @returns ExpertClient instance (DB if url is undefined, RemoteExpertClient otherwise)
 * @throws Error if url is provided (RemoteExpertClient not fully implemented yet)
 */
export function getExpertClient(url?: string, privateKey?: Uint8Array): ExpertClient {
  if (!url) {
    return getDB();
  }
  
  return new ExpertRemoteClient(url, privateKey);
}