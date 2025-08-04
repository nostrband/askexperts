/**
 * NIP-174 (Ask Experts) client implementation
 * Works in both browser and Node.js environments
 */

// Export the main client classes
export { AskExpertsClient } from './AskExpertsClient.js';
export { AskExpertsSmartClient } from './AskExpertsSmartClient.js';
export type { ReplyMCP } from './AskExpertsSmartClient.js';

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
  PaymentMethod,
  Invoice,
  OnQuoteCallback,
  OnPayCallback,
} from '../common/types.js';

// Export constants
export {
  FORMAT_TEXT,
  FORMAT_OPENAI,
  METHOD_LIGHTNING,
  DEFAULT_DISCOVERY_RELAYS,
} from '../common/constants.js';

// Export utility functions
export {
  encrypt,
  decrypt,
  createEvent,
  generateRandomKeyPair,
  validateNostrEvent,
} from '../common/crypto.js';
export { 
  publishToRelays, 
  subscribeToRelays, 
  fetchFromRelays,
  waitForEvent,
  createEventStream,
} from '../common/relay.js';