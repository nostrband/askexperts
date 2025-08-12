import { DBExpert } from "../db/interfaces.js";

/**
 * Interface for expert-related operations
 * Provides methods for managing experts with async support
 */
export interface ExpertClient {
  /**
   * List all experts
   * @returns Promise resolving to an array of expert objects
   */
  listExperts(): Promise<DBExpert[]>;

  /**
   * Get an expert by pubkey
   * @param pubkey - Pubkey of the expert to get
   * @returns Promise resolving to the expert if found, null otherwise
   */
  getExpert(pubkey: string): Promise<DBExpert | null>;

  /**
   * Insert a new expert
   * @param expert - Expert to insert
   * @returns Promise resolving to true if expert was inserted, false otherwise
   */
  insertExpert(expert: DBExpert): Promise<boolean>;

  /**
   * Update an existing expert
   * @param expert - Expert to update
   * @returns Promise resolving to true if expert was updated, false otherwise
   */
  updateExpert(expert: DBExpert): Promise<boolean>;

  /**
   * Set the disabled status of an expert
   * @param pubkey - Pubkey of the expert to update
   * @param disabled - Whether the expert should be disabled
   * @returns Promise resolving to true if expert was updated, false otherwise
   */
  setExpertDisabled(pubkey: string, disabled: boolean): Promise<boolean>;

  /**
   * Delete an expert
   * @param pubkey - Pubkey of the expert to delete
   * @returns Promise resolving to true if expert was deleted, false otherwise
   */
  deleteExpert(pubkey: string): Promise<boolean>;
}