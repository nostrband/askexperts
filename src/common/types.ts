/**
 * Type definitions for NIP-174 (Ask Experts) protocol
 */

import { Event } from 'nostr-tools';
import { Compression } from './compression.js';

/**
 * Supported prompt formats
 * Can be extended with custom formats
 */
export type PromptFormat = 'text' | 'openai' | (string & {});

/**
 * Supported payment methods
 * Can be extended with custom methods
 */
export type PaymentMethod = 'lightning' | (string & {});

/**
 * Supported compression methods
 * Can be extended with custom compression methods
 */
export type CompressionMethod = 'plain' | 'gzip' | (string & {});

/**
 * Callback function type for handling quotes
 * Returns boolean indicating whether to proceed with payment (true) or reject (false)
 */
export type OnQuoteCallback = (quote: Quote, prompt: Prompt) => Promise<boolean>;

/**
 * Callback function type for handling payments
 * Called after onQuote returns true, to process the actual payment
 */
export type OnPayCallback = (quote: Quote, prompt: Prompt) => Promise<Proof>;

/**
 * Callback function type for handling asks
 * Called when an expert receives an ask
 * Returns a bid if the expert wants to respond, or undefined to ignore
 */
export type OnAskCallback = (ask: Ask) => Promise<ExpertBid | undefined>;

/**
 * Callback function type for handling prompts
 * Called when an expert receives a prompt
 * Returns a quote if the expert wants to respond, or undefined to ignore
 */
export type OnPromptCallback = (prompt: Prompt) => Promise<ExpertQuote>;

/**
 * Callback function type for handling proofs and executing prompts
 * Called when an expert receives a proof of payment
 * Returns replies to the prompt
 */
/**
 * Expert reply structure for server-side implementation
 */
export interface ExpertReply {
  /** Whether this is the last reply */
  done?: boolean;
  
  /** Reply content */
  content: any;
}

/**
 * Expert replies interface for server-side implementation
 * Extends AsyncIterable to allow streaming replies
 */
export interface ExpertReplies extends AsyncIterable<ExpertReply> {
  // No additional fields required
}

export type OnProofCallback = (prompt: Prompt, quote: ExpertQuote, proof: Proof) => Promise<ExpertReplies | ExpertReply>;

/**
 * Parameters for finding experts
 */
export interface FindExpertsParams {
  /** Summary of the question (public, anonymized) */
  summary: string;
  
  /** Hashtags for discovery */
  hashtags: string[];
  
  /** Accepted prompt formats (optional) */
  formats?: PromptFormat[];
  
  /** Accepted compression methods (optional) */
  comprs?: CompressionMethod[];
  
  /** Accepted payment methods (optional) */
  methods?: PaymentMethod[];
  
  /** Discovery relays to use (optional) */
  relays?: string[];
}

/**
 * Bid structure representing an expert's offer
 */
export interface Bid {
  /** Expert's public key */
  pubkey: string;
  
  /** Bid event ID */
  id: string;
  
  /** Bid payload event ID */
  payloadId: string;
  
  /** Expert's offer text */
  offer: string;
  
  /** Relays for prompting */
  relays: string[];
  
  /** Supported formats */
  formats: PromptFormat[];
  
  /** Supported compression methods */
  compressions: CompressionMethod[];
  
  /** Supported payment methods */
  methods: PaymentMethod[];
  
  /** Original bid event */
  event: Event;
  
  /** Original bid payload event */
  payloadEvent: Event;
}

/**
 * Expert profile structure
 */
export interface Expert {
  /** Expert's public key */
  pubkey: string;
  
  /** Expert's description */
  description: string;
  
  /** Relays for prompting */
  relays: string[];
  
  /** Supported formats */
  formats: PromptFormat[];
  
  /** Supported compression methods */
  compressions: CompressionMethod[];
  
  /** Supported payment methods */
  methods: PaymentMethod[];
  
  /** Related hashtags */
  hashtags: string[];
  
  /** Original expert profile event */
  event: Event;
}

/**
 * Parameters for fetching expert profiles
 */
export interface FetchExpertsParams {
  /** Expert public keys to fetch */
  pubkeys: string[];
  
  /** Discovery relays to use (optional) */
  relays?: string[];
}

/**
 * Parameters for asking an expert
 */
export interface AskExpertParams {
  /** Expert to ask (either expert or bid must be provided) */
  expert?: Expert;
  
  /** Bid to use (either expert or bid must be provided) */
  bid?: Bid;
  
  /** Content of the prompt */
  content: any;
  
  /** Format of the prompt (must be supported by expert/bid) */
  format?: PromptFormat;
  
  /** Compression method to use (must be supported by expert/bid) */
  compr?: CompressionMethod;
  
  /** Callback function called when a quote is received (optional if provided in constructor) */
  onQuote?: OnQuoteCallback;
  
  /** Callback function called to process payment after quote is accepted (optional if provided in constructor) */
  onPay?: OnPayCallback;
  
  /** Custom compression implementation (optional if provided in constructor) */
  compression?: Compression;
}

/**
 * Prompt structure representing the user's question
 */
export interface Prompt {
  /** Prompt event ID */
  id: string;
  
  /** Expert's public key */
  expertPubkey: string;
  
  /** Format of the prompt */
  format: PromptFormat;
  
  /** Content of the prompt */
  content: any;
  
  /** Original prompt event */
  event: Event;
}

/**
 * Quote structure representing an expert's price quote
 */
export interface Quote {
  /** Expert's public key */
  pubkey: string;
  
  /** Prompt event ID */
  promptId: string;
  
  /** Payment invoices */
  invoices: Invoice[];
  
  /** Original quote event */
  event: Event;
}

/**
 * Invoice structure for payment
 */
export interface Invoice {
  /** Payment method */
  method: PaymentMethod;
  
  /** Payment unit */
  unit: string;
  
  /** Payment amount */
  amount: number;
  
  /** Lightning invoice (for lightning method) */
  invoice?: string;
}

/**
 * Proof structure for payment verification
 */
export interface Proof {
  /** Payment method used */
  method: PaymentMethod;
  
  /** Payment preimage (for lightning method) */
  preimage: string;
}

/**
 * Reply structure representing an expert's response
 */
export interface Reply {
  /** Expert's public key */
  pubkey: string;
  
  /** Prompt event ID */
  promptId: string;
  
  /** Whether this is the last reply */
  done: boolean;
  
  /** Reply content */
  content: any;
  
  /** Original reply event */
  event: Event;
}

/**
 * Replies object that is AsyncIterable and yields Reply objects
 */
export interface Replies extends AsyncIterable<Reply> {
  /** Prompt event ID */
  promptId: string;
  
  /** Expert's public key */
  expertPubkey: string;
  
  /** Compression instance for decompressing replies */
  compression: Compression;
}

/**
 * Ask structure representing a client's question summary
 */
export interface Ask {
  /** Ask event ID */
  id: string;
  
  /** Client's public key */
  pubkey: string;
  
  /** Summary of the question */
  summary: string;
  
  /** Hashtags for discovery */
  hashtags: string[];
  
  /** Accepted formats */
  formats: PromptFormat[];
  
  /** Accepted compression methods */
  compressions: CompressionMethod[];
  
  /** Accepted payment methods */
  methods: PaymentMethod[];
  
  /** Original ask event */
  event: Event;
}

/**
 * ExpertBid structure representing a simplified expert's offer
 * Used by the Expert class to generate a full Bid
 */
export interface ExpertBid {
  /** Expert's offer text */
  offer: string;
  
  /** Supported formats (optional) */
  formats?: PromptFormat[];
  
  /** Supported compression methods (optional) */
  compressions?: CompressionMethod[];
  
  /** Supported payment methods (optional) */
  methods?: PaymentMethod[];
}

/**
 * ExpertQuote structure representing a simplified expert's price quote
 * Used by the Expert class to generate a full Quote
 */
export interface ExpertQuote {
  /** Payment invoices */
  invoices: Invoice[];
}