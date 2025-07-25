import os from 'os';
import path from 'path';

/**
 * Constants for NIP-174 (Ask Experts) protocol
 */

// Application paths
export const APP_DIR = path.join(os.homedir(), '.askexperts');
export const APP_ENV_PATH = path.join(APP_DIR, '.env');
export const APP_DOCSTORE_PATH = path.join(APP_DIR, 'docstore.db');
export const APP_DB_PATH = path.join(APP_DIR, 'askexperts.db');

// Event kinds
export const EVENT_KIND_EXPERT_PROFILE = 10174;
export const EVENT_KIND_EXPERT_LIST = 30174;
export const EVENT_KIND_ASK = 20174;
export const EVENT_KIND_BID = 20175;
export const EVENT_KIND_BID_PAYLOAD = 20176;
export const EVENT_KIND_PROMPT = 20177;
export const EVENT_KIND_QUOTE = 20178;
export const EVENT_KIND_PROOF = 20179;
export const EVENT_KIND_REPLY = 20180;

// Prompt formats
export const FORMAT_TEXT = "text";
export const FORMAT_OPENAI = "openai";

// Payment methods
export const METHOD_LIGHTNING = "lightning";

// Compression methods
export const COMPRESSION_PLAIN = "plain";
export const COMPRESSION_GZIP = "gzip";

// Default discovery relays
export const DEFAULT_DISCOVERY_RELAYS = [
  "wss://relay1.askexperts.io",
  "wss://relay2.askexperts.io",
];

export const DEFAULT_PROPMT_RELAYS = DEFAULT_DISCOVERY_RELAYS;

// Default timeout values (in milliseconds)
export const DEFAULT_DISCOVERY_TIMEOUT = 10000;
export const DEFAULT_FETCH_EXPERTS_TIMEOUT = 5000;
export const DEFAULT_QUOTE_TIMEOUT = 10000;
export const DEFAULT_REPLY_TIMEOUT = 60000;


// Default maximum number of parallel payments
export const DEFAULT_MAX_PARALLEL_PAYMENTS = 5;
