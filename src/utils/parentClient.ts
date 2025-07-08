/**
 * Interface for user data received from parent server
 */
export interface ParentUser {
  pubkey: string;
  nsec: string;
  nwc: string;
  timestamp: number;
  token: string;
}

/**
 * ParentClient class for communicating with the parent server
 */
export class ParentClient {
  private parentUrl: string;
  private token: string;
  private lastTimestamp: number = 0;
  private isPolling: boolean = false;
  private pollingInterval: NodeJS.Timeout | null = null;
  private onNewUsers: (users: ParentUser[]) => Promise<void>;

  /**
   * Create a new ParentClient instance
   *
   * @param parentUrl - URL of the parent server
   * @param token - Authentication token for the parent server
   * @param onNewUsers - Callback function to handle new users
   * @param initialTimestamp - Initial timestamp to start fetching users from (default: 0)
   */
  constructor(
    parentUrl: string,
    token: string,
    onNewUsers: (users: ParentUser[]) => Promise<void>,
    initialTimestamp: number = 0
  ) {
    this.parentUrl = parentUrl;
    this.token = token;
    this.onNewUsers = onNewUsers;
    this.lastTimestamp = initialTimestamp;
  }

  /**
   * Fetch users from the parent server
   * 
   * @param since - Timestamp to fetch users since
   * @returns Array of users
   */
  async fetchUsers(since: number): Promise<ParentUser[]> {
    try {
      const url = new URL(`${this.parentUrl}/users`);
      url.searchParams.append('since', since.toString());
      
      const response = await fetch(url, {
        headers: {
          Authorization: `Bearer ${this.token}`
        }
      });

      if (response.ok) {
        const data = await response.json();
        if (Array.isArray(data)) {
          return data;
        } else {
          console.error("Invalid response from parent server:", data);
          return [];
        }
      } else {
        console.error(`Error fetching users: ${response.status} ${response.statusText}`);
        return [];
      }
    } catch (error) {
      console.error("Error fetching users from parent server:", error);
      return [];
    }
  }

  /**
   * Start polling for new users
   * 
   * @param intervalMs - Polling interval in milliseconds
   */
  startPolling(intervalMs: number = 60000): void {
    if (this.isPolling) {
      return;
    }

    this.isPolling = true;
    
    // Initial fetch
    this.pollForUsers();

    // Set up interval for subsequent fetches
    this.pollingInterval = setInterval(() => {
      this.pollForUsers();
    }, intervalMs);
  }

  /**
   * Stop polling for new users
   */
  stopPolling(): void {
    if (this.pollingInterval) {
      clearInterval(this.pollingInterval);
      this.pollingInterval = null;
    }
    this.isPolling = false;
  }

  /**
   * Poll for new users and process them
   * This method is public to allow manual triggering from the webhook
   */
  async pollForUsers(): Promise<void> {
    try {
      const users = await this.fetchUsers(this.lastTimestamp);
      
      if (users.length > 0) {
        // Update the last timestamp to the most recent user
        const maxTimestamp = Math.max(...users.map(user => user.timestamp));
        this.lastTimestamp = maxTimestamp;
        
        // Process the new users
        await this.onNewUsers(users);
        
        console.log(`Fetched ${users.length} new users from parent server`);
      }
    } catch (error) {
      console.error("Error polling for users:", error);
    }
  }
}