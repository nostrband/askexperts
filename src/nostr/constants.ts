/**
 * Constants for Nostr event kinds as defined in NIPs
 */

/**
 * NIP-174: Ask Experts
 * 
 * Event kind for public question summary with hashtags and max bid
 */
export const NOSTR_EVENT_KIND_ASK = 20174;

/**
 * NIP-174: Ask Experts
 * 
 * Event kind for encrypted bid
 */
export const NOSTR_EVENT_KIND_BID = 20175;

/**
 * NIP-174: Ask Experts
 * 
 * Event kind for bid payload
 */
export const NOSTR_EVENT_KIND_BID_PAYLOAD = 20176;

/**
 * NIP-174: Ask Experts
 *
 * Event kind for encrypted question
 */
export const NOSTR_EVENT_KIND_QUESTION = 20177;

/**
 * NIP-174: Ask Experts
 *
 * Event kind for encrypted answer
 */
export const NOSTR_EVENT_KIND_ANSWER = 20178;

/**
 * Default relays to publish Nostr events to
 *
 * A list of reliable Nostr relays used for publishing events
 */
export const DEFAULT_RELAYS = [
  "wss://relay.nostr.band",
  "wss://relay.damus.io",
  "wss://nos.lol",
];