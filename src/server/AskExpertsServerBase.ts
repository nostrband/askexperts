/**
 * Expert implementation for NIP-174
 * Server-side component that handles asks and prompts
 */

import { SimplePool, Event, Filter, getPublicKey } from "nostr-tools";
import { z } from "zod";
import { debugExpert, debugError } from "../common/debug.js";

import {
  EVENT_KIND_ASK,
  EVENT_KIND_BID,
  EVENT_KIND_BID_PAYLOAD,
  EVENT_KIND_EXPERT_PROFILE,
  EVENT_KIND_PROMPT,
  EVENT_KIND_QUOTE,
  EVENT_KIND_PROOF,
  EVENT_KIND_REPLY,
  COMPRESSION_PLAIN,
  METHOD_LIGHTNING,
  DEFAULT_DISCOVERY_RELAYS,
  FORMAT_TEXT,
} from "../common/constants.js";

import {
  Ask,
  ExpertBid,
  Prompt,
  Quote,
  Proof,
  PromptFormat,
  CompressionMethod,
  PaymentMethod,
  OnAskCallback,
  OnPromptCallback,
  OnProofCallback,
  ExpertQuote,
  ExpertReplies,
  ExpertReply,
} from "../common/types.js";

import { Compression, DefaultCompression } from "../common/compression.js";
import {
  encrypt,
  decrypt,
  createEvent,
  generateRandomKeyPair,
} from "../common/crypto.js";
import {
  publishToRelays,
  subscribeToRelays,
  waitForEvent,
} from "../common/relay.js";

/**
 * Default interval for profile republishing (in milliseconds)
 */
const PROFILE_REPUBLISH_INTERVAL = 12 * 60 * 60 * 1000; // 12 hours

/**
 * Zod schema for prompt payload
 */
const promptPayloadSchema = z.object({
  format: z.string(),
  content: z.any(),
});

/**
 * Zod schema for proof payload
 */
const proofPayloadSchema = z.object({
  method: z.string().optional(),
  preimage: z.string().optional(),
  error: z.string().optional(),
});

/**
 * Expert class for NIP-174 protocol
 * Handles asks and prompts from clients
 */
export class AskExpertsServerBase {
  /**
   * Expert's private key
   */
  #privkey: Uint8Array;

  /**
   * Expert's public key
   */
  public readonly pubkey: string;

  /**
   * Expert's nickname (optional)
   */
  #nickname?: string;

  /**
   * Expert description
   */
  #description: string = "Expert profile for NIP-174";

  /**
   * Relays for discovery phase
   */
  #discoveryRelays: string[];

  /**
   * Relays for prompt phase
   */
  #promptRelays: string[];

  /**
   * Hashtags the expert is interested in
   */
  #hashtags?: string[];

  /**
   * Formats supported by the expert
   */
  #formats: PromptFormat[];

  /**
   * Payment methods supported by the expert
   */
  #paymentMethods: PaymentMethod[];

  /**
   * Compression instance for compressing and decompressing data
   */
  #compression: Compression;

  /**
   * SimplePool instance for relay operations
   */
  public readonly pool: SimplePool;

  /**
   * Callback for handling asks
   */
  #onAsk?: OnAskCallback;

  /**
   * Callback for handling prompts
   */
  #onPrompt?: OnPromptCallback;

  /**
   * Callback for handling proofs and executing prompts
   */
  #onProof?: OnProofCallback;

  /**
   * Active ask subscription
   */
  private askSub?: { close: () => void };

  /**
   * Active prompt subscription
   */
  private promptSub?: { close: () => void };

  /**
   * Timer for periodic profile republishing
   */
  private profileRepublishTimer: NodeJS.Timeout | null = null;

  /**
   * Flag to indicate that profile needs to be republished
   */
  private scheduledPublishProfile = false;

  /**
   * Flag to indicate that ask subscription needs to be updated
   */
  private scheduledSubscribeToAsks = false;

  /**
   * Flag to signal that start was called
   */
  private started = false;

  /**
   * Schedules the profile for republishing
   */
  private schedulePublishProfile(): void {
    this.scheduledPublishProfile = true;
    setImmediate(() => this.maybeRepublishProfile());
  }

  /**
   * Schedules the ask subscription for updating
   */
  private scheduleSubscribeToAsks(): void {
    this.scheduledSubscribeToAsks = true;
    setImmediate(() => this.maybeSubscribeToAsks());
  }

  /**
   * Checks if ask subscription needs to be updated and does so if necessary
   */
  private maybeSubscribeToAsks(): void {
    if (this.scheduledSubscribeToAsks) {
      this.scheduledSubscribeToAsks = false;
      this.subscribeToAsks();
    }
  }

  /**
   * Creates a new Expert instance
   *
   * @param options - Configuration options
   * @param options.privkey - Expert's private key (required)
   * @param options.discoveryRelays - Relays for discovery phase
   * @param options.promptRelays - Relays for prompt phase
   * @param options.hashtags - Hashtags the expert is interested in
   * @param options.formats - Formats supported by the expert
   * @param options.compressions - Compression methods supported by the expert
   * @param options.paymentMethods - Payment methods supported by the expert
   * @param options.onAsk - Callback for handling asks
   * @param options.onPrompt - Callback for handling prompts
   * @param options.onProof - Callback for handling proofs and executing prompts
   * @param options.pool - SimplePool instance for relay operations
   * @param options.compression - Custom compression implementation
   */
  constructor(options: {
    privkey: Uint8Array;
    discoveryRelays?: string[];
    promptRelays?: string[];
    hashtags?: string[];
    formats?: PromptFormat[];
    onAsk?: OnAskCallback;
    onPrompt?: OnPromptCallback;
    onProof?: OnProofCallback;
    paymentMethods?: PaymentMethod[];
    pool: SimplePool;
    compression?: Compression;
    nickname?: string;
    description?: string;
  }) {
    // Required parameters
    this.#privkey = options.privkey;
    this.pubkey = getPublicKey(options.privkey);
    this.#nickname = options.nickname;
    if (options.description) {
      this.#description = options.description;
    }
    this.#discoveryRelays = options.discoveryRelays || DEFAULT_DISCOVERY_RELAYS;
    this.#promptRelays = options.promptRelays || DEFAULT_DISCOVERY_RELAYS;
    this.#hashtags = options.hashtags || [];
    this.#formats = options.formats || [FORMAT_TEXT];
    this.#onAsk = options.onAsk;
    this.#onPrompt = options.onPrompt;
    this.#onProof = options.onProof;

    // Optional parameters with defaults
    this.#paymentMethods = options.paymentMethods || [METHOD_LIGHTNING];
    this.#compression = options.compression || new DefaultCompression();

    // Set the required pool
    this.pool = options.pool;
  }

  // Getters and setters for private members
  get nickname() {
    return this.#nickname || "";
  }

  set nickname(value: string) {
    this.#nickname = value;
    this.schedulePublishProfile();
  }

  get description() {
    return this.#description;
  }

  set description(value: string) {
    this.#description = value;
    this.schedulePublishProfile();
  }

  get discoveryRelays() {
    return this.#discoveryRelays;
  }

  set discoveryRelays(value: string[]) {
    if (!value.length) throw new Error("Empty relay list");
    this.#discoveryRelays = value;
  }

  get promptRelays() {
    return this.#promptRelays;
  }

  set promptRelays(value: string[]) {
    if (!value.length) throw new Error("Empty relay list");
    this.#promptRelays = value;
    this.schedulePublishProfile();
  }

  get hashtags() {
    return this.#hashtags || [];
  }

  set hashtags(value: string[]) {
    this.#hashtags = value;
    this.schedulePublishProfile();
    this.scheduleSubscribeToAsks();
  }

  get formats() {
    return this.#formats;
  }

  set formats(value: PromptFormat[]) {
    if (!value.length) throw new Error("No formats");
    this.#formats = value;
    this.schedulePublishProfile();
  }

  get paymentMethods() {
    return this.#paymentMethods;
  }

  set paymentMethods(value: PaymentMethod[]) {
    if (!value.length) throw new Error("No payment methods");
    this.#paymentMethods = value;
    this.schedulePublishProfile();
  }

  get onAsk() {
    return this.#onAsk;
  }

  set onAsk(value: OnAskCallback | undefined) {
    this.#onAsk = value;
  }

  get onPrompt() {
    return this.#onPrompt;
  }

  set onPrompt(value: OnPromptCallback | undefined) {
    this.#onPrompt = value;
  }

  get onProof() {
    return this.#onProof;
  }

  set onProof(value: OnProofCallback | undefined) {
    this.#onProof = value;
  }

  get compression() {
    return this.#compression;
  }

  set compression(value: Compression) {
    this.#compression = value;
  }

  /**
   * Starts the expert by subscribing to asks and prompts
   */
  async start(): Promise<void> {
    if (this.started) throw new Error("Already started");

    this.started = true;

    // Publish expert profile
    this.schedulePublishProfile();

    // Set up periodic republishing of expert profile
    this.setupProfileRepublishing();

    // Subscribe to asks
    this.subscribeToAsks();

    // Subscribe to prompts
    this.subscribeToPrompts();
  }

  /**
   * Sets up periodic republishing of expert profile
   */
  private setupProfileRepublishing(): void {
    // Clear any existing timer
    if (this.profileRepublishTimer) {
      clearInterval(this.profileRepublishTimer);
    }

    // Set up a new timer to republish the profile every 12 hours
    this.profileRepublishTimer = setInterval(async () => {
      try {
        debugExpert("Republishing expert profile (12-hour interval)");
        this.schedulePublishProfile();
      } catch (error) {
        debugError("Error republishing expert profile:", error);
      }
    }, PROFILE_REPUBLISH_INTERVAL);
  }

  /**
   * Publishes the expert profile to discovery relays
   */
  private async publishExpertProfile(): Promise<void> {
    // Create tags for the expert profile
    const tags: string[][] = [
      ...this.#promptRelays.map((relay) => ["relay", relay]),
      ...this.#formats.map((format) => ["f", format]),
      ...this.#compression.list().map((compr) => ["c", compr]),
      ...this.#paymentMethods.map((method) => ["m", method]),
      ...(this.#hashtags?.map((tag) => ["t", tag]) || []),
    ];

    // Add name tag if nickname is provided
    if (this.#nickname) {
      tags.push(["name", this.#nickname]);
    }

    // Create and sign the expert profile event
    const expertProfileEvent = createEvent(
      EVENT_KIND_EXPERT_PROFILE,
      this.#description,
      tags,
      this.#privkey
    );

    // Publish the expert profile to discovery relays
    const publishedRelays = await publishToRelays(
      expertProfileEvent,
      this.#discoveryRelays,
      this.pool
    );

    debugExpert(`Published expert profile to ${publishedRelays.length} relays`);
  }

  /**
   * Checks if profile needs to be republished and does so if necessary
   */
  private async maybeRepublishProfile(): Promise<void> {
    if (this.started && this.scheduledPublishProfile) {
      this.scheduledPublishProfile = false;
      await this.publishExpertProfile();
    }
  }

  /**
   * Subscribes to ask events on discovery relays
   */
  private subscribeToAsks(): void {
    // Clear previous sub
    this.askSub?.close();
    this.askSub = undefined;

    if (!this.#hashtags) return;

    // Create a single filter for ask events with all matching criteria
    // This ensures we match asks that satisfy ALL conditions (AND logic)
    const filter: Filter = {
      kinds: [EVENT_KIND_ASK],
      since: Math.floor(Date.now() / 1000) - 60, // Get events from the last minute
    };

    // Add hashtags to filter if specified
    if (this.#hashtags?.length > 0) {
      filter["#t"] = this.#hashtags;
    }

    // Add formats to filter if specified
    if (this.#formats.length > 0) {
      filter["#f"] = this.#formats;
    }

    // Add compressions to filter if specified
    const compressionList = this.#compression.list();
    if (compressionList.length > 0) {
      filter["#c"] = compressionList;
    }

    // Add payment methods to filter if specified
    if (this.#paymentMethods.length > 0) {
      filter["#m"] = this.#paymentMethods;
    }

    // Subscribe to ask events with the combined filter
    const sub = subscribeToRelays([filter], this.#discoveryRelays, this.pool, {
      onevent: async (event: Event) => {
        try {
          await this.handleAskEvent(event);
        } catch (error) {
          debugError("Error handling ask event:", error);
        }
      },
    });

    // Store the sub
    this.askSub = sub;
  }

  /**
   * Subscribes to prompt events on prompt relays
   */
  private subscribeToPrompts(): void {
    // Clear previous sub
    this.promptSub?.close();
    this.promptSub = undefined;

    // Create a filter for prompt events that tag the expert
    const filter: Filter = {
      kinds: [EVENT_KIND_PROMPT],
      "#p": [this.pubkey],
      since: Math.floor(Date.now() / 1000) - 60, // Get events from the last minute
    };

    // Subscribe to prompt events
    const sub = subscribeToRelays([filter], this.#promptRelays, this.pool, {
      onevent: async (event: Event) => {
        try {
          await this.handlePromptEvent(event);
        } catch (error) {
          debugError("Error handling prompt event:", error);
        }
      },
    });

    // Store the sub
    this.promptSub = sub;
  }

  /**
   * Handles an ask event
   *
   * @param askEvent - The ask event
   */
  private async handleAskEvent(askEvent: Event): Promise<void> {
    try {
      debugExpert(`Received ask event: ${askEvent.id}`);
      if (!this.#onAsk) {
        debugExpert(`No ask handler for: ${askEvent.id}`);
        return;
      }

      // Extract hashtags from the tags
      const askHashtags = askEvent.tags
        .filter((tag) => tag.length > 1 && tag[0] === "t")
        .map((tag) => tag[1]);

      // Extract formats from the tags
      const askFormats = askEvent.tags
        .filter((tag) => tag.length > 1 && tag[0] === "f")
        .map((tag) => tag[1]) as PromptFormat[];

      // Extract compression methods from the tags
      const askComprs = askEvent.tags
        .filter((tag) => tag.length > 1 && tag[0] === "c")
        .map((tag) => tag[1]) as CompressionMethod[];

      // Extract payment methods from the tags
      const askMethods = askEvent.tags
        .filter((tag) => tag.length > 1 && tag[0] === "m")
        .map((tag) => tag[1]) as PaymentMethod[];

      // Create an Ask object
      const ask: Ask = {
        id: askEvent.id,
        pubkey: askEvent.pubkey,
        summary: askEvent.content,
        hashtags: askHashtags,
        formats: askFormats,
        compressions: askComprs,
        methods: askMethods,
        event: askEvent,
      };

      // Call the onAsk callback
      const bid = await this.#onAsk(ask);

      // If the callback returns a bid, send it
      if (bid) {
        await this.sendBid(ask, bid);
      }
    } catch (error) {
      debugError("Error handling ask event:", error);
    }
  }

  /**
   * Sends a bid in response to an ask
   *
   * @param ask - The ask
   * @param bid - The bid
   */
  private async sendBid(ask: Ask, expertBid: ExpertBid): Promise<void> {
    try {
      // Generate a random key pair for the bid
      const { privateKey: bidPrivkey } = generateRandomKeyPair();

      // Use provided values or defaults for optional fields
      const formats = expertBid.formats || this.#formats;
      const compressions = expertBid.compressions || this.#compression.list();
      const methods = expertBid.methods || this.#paymentMethods;

      // Validate that provided values are compatible with supported values
      const validFormats = formats.filter((format) =>
        this.#formats.includes(format)
      );
      const validCompressions = compressions.filter((compr) =>
        this.#compression.list().includes(compr)
      );
      const validMethods = methods.filter((method) =>
        this.#paymentMethods.includes(method)
      );

      // Create tags for the bid payload
      const tags: string[][] = [
        ...this.#promptRelays.map((relay) => ["relay", relay]),
        ...validFormats.map((format) => ["f", format]),
        ...validCompressions.map((compr) => ["c", compr]),
        ...validMethods.map((method) => ["m", method]),
      ];

      // Create and sign the bid payload event
      const bidPayloadEvent = createEvent(
        EVENT_KIND_BID_PAYLOAD,
        expertBid.offer,
        tags,
        this.#privkey
      );

      // Convert the bid payload event to a string
      const bidPayloadStr = JSON.stringify(bidPayloadEvent);

      // Encrypt the bid payload for the ask pubkey
      const encryptedContent = encrypt(bidPayloadStr, ask.pubkey, bidPrivkey);

      // Create and sign the bid event
      const bidEvent = createEvent(
        EVENT_KIND_BID,
        encryptedContent,
        [["e", ask.id]],
        bidPrivkey
      );

      // Publish the bid event to discovery relays
      const publishedRelays = await publishToRelays(
        bidEvent,
        this.#discoveryRelays,
        this.pool
      );

      debugExpert(`Published bid to ${publishedRelays.length} relays`);
    } catch (error) {
      debugError("Error sending bid:", error);
    }
  }

  /**
   * Handles a prompt event
   *
   * @param promptEvent - The prompt event
   */
  private async handlePromptEvent(promptEvent: Event): Promise<void> {
    try {
      debugExpert(`Received prompt event: ${promptEvent.id}`);
      if (!this.#onPrompt) {
        debugExpert(`No prompt handler for event: ${promptEvent.id}`);
        return;
      }

      // Get the compression method from the c tag
      const cTag = promptEvent.tags.find(
        (tag) => tag.length > 1 && tag[0] === "c"
      );
      const promptCompr = (cTag?.[1] as CompressionMethod) || COMPRESSION_PLAIN;

      // Decrypt the prompt payload
      const decryptedPrompt = decrypt(
        promptEvent.content,
        promptEvent.pubkey,
        this.#privkey
      );

      // Decompress the payload
      const promptPayloadStr = await this.#compression.decompress(
        decryptedPrompt,
        promptCompr
      );

      try {
        // Parse and validate the prompt payload using Zod
        const rawPayload = JSON.parse(promptPayloadStr);
        const promptPayload = promptPayloadSchema.parse(rawPayload);

        // Create the Prompt object
        const prompt: Prompt = {
          id: promptEvent.id,
          expertPubkey: this.pubkey,
          format: promptPayload.format as PromptFormat,
          content: promptPayload.content,
          event: promptEvent,
          context: undefined,
        };

        try {
          // Call the onPrompt callback
          const expertQuote = await this.#onPrompt(prompt);

          // Create a full Quote from the ExpertQuote
          const quote: Quote = {
            pubkey: this.pubkey,
            promptId: prompt.id,
            invoices: expertQuote.invoices,
            event: prompt.event, // Temporary placeholder, will be set in sendQuote
          };

          await this.sendQuote(prompt, quote);

          // Wait for proof event with a timeout
          // Create a filter for proof events that tag the prompt
          const filter: Filter = {
            kinds: [EVENT_KIND_PROOF],
            "#e": [prompt.id],
            "#p": [this.pubkey],
            since: Math.floor(Date.now() / 1000) - 60, // Get events from the last minute
          };

          // Wait for the proof event (60 second timeout)
          const proofEvent = await waitForEvent(
            filter,
            this.#promptRelays,
            this.pool,
            60000 // 60 second timeout
          );

          // If we received a proof event, handle it
          if (proofEvent) {
            await this.handleProofEvent(proofEvent, prompt, expertQuote);
          } else {
            debugExpert(
              `No proof received for prompt ${prompt.id} after timeout`
            );
          }
        } catch (error) {
          // If the callback throws an error, send a quote with an error field
          debugError("Error in onPrompt callback:", error);

          // Send an error quote
          await this.sendErrorQuote(
            prompt,
            error instanceof Error
              ? error.message
              : "Unknown error in prompt processing"
          );
        }
      } catch (error) {
        debugError("Error processing prompt payload:", error);
      }
    } catch (error) {
      debugError("Error handling prompt event:", error);
    }
  }

  /**
   * Sends a quote in response to a prompt
   *
   * @param prompt - The prompt
   * @param quote - The quote
   */
  private async sendQuote(prompt: Prompt, quote: Quote): Promise<void> {
    try {
      // Create the quote payload
      const quotePayload = {
        invoices: quote.invoices,
      };

      // Convert to JSON string
      const quotePayloadStr = JSON.stringify(quotePayload);

      // Encrypt the quote payload
      const encryptedContent = encrypt(
        quotePayloadStr,
        prompt.event.pubkey,
        this.#privkey
      );

      // Create and sign the quote event
      const quoteEvent = createEvent(
        EVENT_KIND_QUOTE,
        encryptedContent,
        [
          ["p", prompt.event.pubkey],
          ["e", prompt.id],
        ],
        this.#privkey
      );

      // Publish the quote event to prompt relays
      const publishedRelays = await publishToRelays(
        quoteEvent,
        this.#promptRelays,
        this.pool
      );

      debugExpert(`Published quote to ${publishedRelays.length} relays`);
    } catch (error) {
      debugError("Error sending quote:", error);
    }
  }

  /**
   * Sends an error quote in response to a prompt
   *
   * @param prompt - The prompt
   * @param errorMessage - The error message
   */
  private async sendErrorQuote(
    prompt: Prompt,
    errorMessage: string
  ): Promise<void> {
    try {
      // Create the error quote payload
      const errorQuotePayload = {
        error: errorMessage,
      };

      // Convert to JSON string
      const errorQuoteStr = JSON.stringify(errorQuotePayload);

      // Encrypt the error quote payload
      const encryptedContent = encrypt(
        errorQuoteStr,
        prompt.event.pubkey,
        this.#privkey
      );

      // Create and sign the quote event
      const errorQuoteEvent = createEvent(
        EVENT_KIND_QUOTE,
        encryptedContent,
        [
          ["p", prompt.event.pubkey],
          ["e", prompt.id],
        ],
        this.#privkey
      );

      // Publish the error quote event to prompt relays
      const publishedRelays = await publishToRelays(
        errorQuoteEvent,
        this.#promptRelays,
        this.pool
      );

      debugExpert(`Published error quote to ${publishedRelays.length} relays`);
    } catch (error) {
      debugError("Error sending error quote:", error);
    }
  }

  /**
   * Handles a proof event
   *
   * @param proofEvent - The proof event
   * @param prompt - The prompt
   */
  private async handleProofEvent(
    proofEvent: Event,
    prompt: Prompt,
    expertQuote: ExpertQuote
  ): Promise<void> {
    try {
      debugExpert(`Received proof event: ${proofEvent.id}`);

      // Decrypt the proof payload
      const decryptedProof = decrypt(
        proofEvent.content,
        proofEvent.pubkey,
        this.#privkey
      );

      try {
        // Parse and validate the proof payload using Zod
        const rawPayload = JSON.parse(decryptedProof);
        const proofPayload = proofPayloadSchema.parse(rawPayload);

        // Check if there's an error in the proof payload
        if (proofPayload.error) {
          debugError(`Proof error: ${proofPayload.error}`);
          return;
        }

        // Create the Proof object
        const proof: Proof = {
          method: proofPayload.method as PaymentMethod,
          preimage: proofPayload.preimage || "",
        };

        try {
          // Return error if onProof not set
          if (!this.#onProof) throw new Error("No proof handler");

          // Call the onProof callback with prompt, expertQuote, and proof
          const result = await this.#onProof(prompt, expertQuote, proof);

          // Check if the result is a single ExpertReply or ExpertReplies
          if (Symbol.asyncIterator in result) {
            // It's ExpertReplies
            await this.sendExpertReplies(prompt, result);
          } else {
            // It's a single ExpertReply, enforce done=true
            result.done = true;
            await this.sendExpertReply(prompt, result);
          }
        } catch (error) {
          // If the callback throws an error, send a single error reply with done=true
          debugError("Error in onProof callback:", error);

          // Create a simple error reply
          const errorReply: ExpertReply = {
            done: true,
            content:
              error instanceof Error
                ? error.message
                : "Unknown error in proof processing",
          };

          // Send the error reply
          await this.sendExpertReply(prompt, errorReply);
        }
      } catch (error) {
        debugError("Error processing proof payload:", error);
      }
    } catch (error) {
      debugError("Error handling proof event:", error);
    }
  }

  /**
   * Sends an expert reply to a prompt
   *
   * @param prompt - The prompt
   * @param expertReply - The expert reply
   */
  private async sendExpertReply(
    prompt: Prompt,
    expertReply: ExpertReply
  ): Promise<void> {
    try {
      // Create the reply payload
      const replyPayload = {
        content: expertReply.content,
        done: expertReply.done || false,
      };

      // Convert to JSON string
      const replyPayloadStr = JSON.stringify(replyPayload);

      // Compress the payload
      const compressedPayload = await this.#compression.compress(
        replyPayloadStr,
        COMPRESSION_PLAIN // Use plain compression for simplicity
      );

      // Encrypt the payload
      const encryptedContent = encrypt(
        compressedPayload,
        prompt.event.pubkey,
        this.#privkey
      );

      // Create and sign the reply event
      const replyEvent = createEvent(
        EVENT_KIND_REPLY,
        encryptedContent,
        [
          ["p", prompt.event.pubkey],
          ["e", prompt.id],
          ["c", COMPRESSION_PLAIN],
        ],
        this.#privkey
      );

      // Publish the reply event to prompt relays
      const publishedRelays = await publishToRelays(
        replyEvent,
        this.#promptRelays,
        this.pool
      );

      debugExpert(`Published reply to ${publishedRelays.length} relays for prompt ${prompt.id}`);
    } catch (error) {
      debugError("Error sending expert reply:", error);
    }
  }

  /**
   * Sends expert replies to a prompt
   *
   * @param prompt - The prompt
   * @param expertReplies - The expert replies
   */
  private async sendExpertReplies(
    prompt: Prompt,
    expertReplies: ExpertReplies
  ): Promise<void> {
    try {
      // Iterate through the expert replies
      for await (const expertReply of expertReplies) {
        // Send the expert reply
        await this.sendExpertReply(prompt, expertReply);
      }
    } catch (error) {
      debugError("Error sending expert replies:", error);
    }
  }

  /**
   * Disposes of resources when the expert is no longer needed
   */
  async [Symbol.asyncDispose]() {
    debugExpert("Clearing AskExpertsServerBase")
    // FIXME make sure existing queries are answered

    // Close all subscriptions
    this.askSub?.close();
    this.promptSub?.close();

    // Clear the profile republish timer
    if (this.profileRepublishTimer) {
      clearInterval(this.profileRepublishTimer);
      this.profileRepublishTimer = null;
    }

    // The pool is managed externally, so we don't destroy it here
  }
}
