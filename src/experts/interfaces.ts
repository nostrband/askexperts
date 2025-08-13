import { Request } from 'express';

/**
 * Interface for ExpertServer permissions
 * Used to validate user authentication and permissions
 */
export interface ExpertServerPerms {
  /**
   * Check if a user is allowed to perform an operation
   * @param user_id - The user ID
   * @param req - The Express request being processed
   * @throws Error if the operation is not allowed with a custom error message
   * @returns Promise that resolves with optional listIds if the operation is allowed
   */
  checkPerms(user_id: string, req: Request): Promise<{ listIds?: string[] }>;

  /**
   * Get the user ID associated with a public key
   * @param pubkey - Public key of the user
   * @returns Promise that resolves with the user ID
   */
  getUserId(pubkey: string): Promise<string>;
}