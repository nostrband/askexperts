/**
 * Interface for AskExpertsServerBase class
 * Defines all public methods and properties
 */

import { SimplePool } from "nostr-tools";
import {
  PromptFormat,
  PaymentMethod,
  OnAskCallback,
  OnPromptCallback,
  OnProofCallback,
  AskExpertsServerLogger
} from "../common/types.js";
import { StreamFactory } from "../stream/index.js";

export interface AskExpertsServerBaseInterface {
  /**
   * Expert's public key
   */
  readonly pubkey: string;

  /**
   * SimplePool instance for relay operations
   */
  readonly pool: SimplePool;

  /**
   * Starts the expert by subscribing to asks and prompts
   */
  start(): Promise<void>;

  /**
   * Expert's nickname
   */
  get nickname(): string;
  set nickname(value: string);

  /**
   * Expert description
   */
  get description(): string;
  set description(value: string);

  /**
   * Relays for discovery phase
   */
  get discoveryRelays(): string[];
  set discoveryRelays(value: string[]);

  /**
   * Relays for prompt phase
   */
  get promptRelays(): string[];
  set promptRelays(value: string[]);

  /**
   * Hashtags the expert is interested in
   */
  get hashtags(): string[];
  set hashtags(value: string[]);

  /**
   * Formats supported by the expert
   */
  get formats(): PromptFormat[];
  set formats(value: PromptFormat[]);

  /**
   * Payment methods supported by the expert
   */
  get paymentMethods(): PaymentMethod[];
  set paymentMethods(value: PaymentMethod[]);

  /**
   * Callback for handling asks
   */
  get onAsk(): OnAskCallback | undefined;
  set onAsk(value: OnAskCallback | undefined);

  /**
   * Callback for handling prompts
   */
  get onPrompt(): OnPromptCallback | undefined;
  set onPrompt(value: OnPromptCallback | undefined);

  /**
   * Callback for handling proofs and executing prompts
   */
  get onProof(): OnProofCallback | undefined;
  set onProof(value: OnProofCallback | undefined);

  /**
   * StreamFactory instance for creating stream readers and writers
   */
  get streamFactory(): StreamFactory;
  set streamFactory(value: StreamFactory);

  /**
   * Logger instance for logging server events
   */
  get logger(): AskExpertsServerLogger | undefined;
  set logger(value: AskExpertsServerLogger | undefined);

  /**
   * Symbol.asyncDispose method for resource cleanup
   */
  [Symbol.asyncDispose](): Promise<void>;
}