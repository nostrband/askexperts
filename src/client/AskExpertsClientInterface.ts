/**
 * Interface for AskExpertsClient class
 * Defines all public methods and properties
 */

import {
  FindExpertsParams,
  FetchExpertsParams,
  AskExpertParams,
  Bid,
  Expert,
  Replies,
  Quote
} from "../common/types.js";

export interface AskExpertsClientInterface {
  /**
   * Finds experts by publishing an ask event and collecting bids
   *
   * @param params - Parameters for finding experts
   * @returns Promise resolving to array of Bid objects
   */
  findExperts(params: FindExpertsParams): Promise<Bid[]>;

  /**
   * Fetches expert profiles from relays
   *
   * @param params - Parameters for fetching expert profiles
   * @returns Promise resolving to array of Expert objects
   */
  fetchExperts(params: FetchExpertsParams): Promise<Expert[]>;

  /**
   * Asks an expert a question and receives replies
   *
   * @param params - Parameters for asking an expert
   * @returns Promise resolving to Replies object
   */
  askExpert(params: AskExpertParams): Promise<Replies>;

  /**
   * Validates a quote by checking that all lightning invoices have matching amounts
   *
   * @param quote - The quote to validate
   * @throws PaymentRejectedError if any invoice amount doesn't match the expected amount
   */
  validateQuote(quote: Quote): void;

  /**
   * Symbol.dispose method for resource cleanup
   */
  [Symbol.dispose](): void;
}