/**
 * NIP-174 (Ask Experts) client implementation
 * Works in both browser and Node.js environments
 */

// Export the main client class
export { AskExpertsClient } from './AskExpertsClient.js';

// Export types
export type {
  FindExpertsParams,
  FetchExpertsParams,
  AskExpertParams,
  Bid,
  Expert,
  Quote,
  Proof,
  Reply,
  Replies,
  Prompt,
  PromptFormat,
  CompressionMethod,
  PaymentMethod,
  Invoice,
  OnQuoteCallback,
  OnPayCallback,
} from './types.js';

// Export constants
export {
  FORMAT_TEXT,
  FORMAT_OPENAI,
  COMPRESSION_PLAIN,
  COMPRESSION_GZIP,
  METHOD_LIGHTNING,
  DEFAULT_DISCOVERY_RELAYS,
} from './constants.js';

// Export utility functions
export {
  encrypt,
  decrypt,
  createEvent,
  generateRandomKeyPair,
  validateNostrEvent,
} from './utils/crypto.js';
export { 
  publishToRelays, 
  subscribeToRelays, 
  fetchFromRelays,
  waitForEvent,
  createEventStream,
} from './utils/relay.js';