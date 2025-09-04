/**
 * Expert implementation for NIP-174
 * Server-side component that handles asks and prompts
 */

import { SimplePool, Event, Filter, getPublicKey } from "nostr-tools";
import { z } from "zod";
import { debugExpert, debugError } from "../common/debug.js";
import { AskExpertsServerLogger } from "../common/types.js";

import {
  EVENT_KIND_ASK,
  EVENT_KIND_BID,
  EVENT_KIND_BID_PAYLOAD,
  EVENT_KIND_EXPERT_PROFILE,
  EVENT_KIND_PROMPT,
  EVENT_KIND_QUOTE,
  EVENT_KIND_PROOF,
  EVENT_KIND_REPLY,
  METHOD_LIGHTNING,
  DEFAULT_DISCOVERY_RELAYS,
  FORMAT_TEXT,
  FORMAT_OPENAI,
  SEARCH_RELAYS,
} from "../common/constants.js";

import {
  Ask,
  ExpertBid,
  Prompt,
  Quote,
  Proof,
  PromptFormat,
  PaymentMethod,
  OnAskCallback,
  OnPromptCallback,
  OnProofCallback,
  ExpertQuote,
  ExpertReplies,
  ExpertReply,
} from "../common/types.js";

import {
  StreamFactory,
  getStreamFactory,
  createStreamMetadataEvent,
  parseStreamMetadataEvent,
  StreamMetadata,
} from "../stream/index.js";
import { COMPRESSION_GZIP } from "../stream/compression.js";
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
  payload: z.any(),
});

/**
 * Zod schema for proof payload
 */
const proofPayloadSchema = z.object({
  method: z.string().optional(),
  preimage: z.string().optional(),
  error: z.string().optional(),
});

interface ReplyPayload {
  error?: string;
  payload?: any;
}

/**
 * Expert class for NIP-174 protocol
 * Handles asks and prompts from clients
 */
import { AskExpertsServerBaseInterface } from "./AskExpertsServerBaseInterface.js";

export class AskExpertsServerBase implements AskExpertsServerBaseInterface {
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
   * Hashtags the expert is publishing in their profile
   */
  #profileHashtags: string[];

  /** Picture for expert profile */
  #picture: string = '';

  /**
   * Custom tags for expert profile
   */
  #tags: string[][] = [];

  /**
   * Formats supported by the expert
   */
  #formats: PromptFormat[];

  /**
   * Payment methods supported by the expert
   */
  #paymentMethods: PaymentMethod[];

  /**
   * StreamFactory instance for creating stream readers and writers
   */
  #streamFactory: StreamFactory;

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
   * Logger instance for logging server events
   */
  #logger?: AskExpertsServerLogger;

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
   * @param options.paymentMethods - Payment methods supported by the expert
   * @param options.onAsk - Callback for handling asks
   * @param options.onPrompt - Callback for handling prompts
   * @param options.onProof - Callback for handling proofs and executing prompts
   * @param options.pool - SimplePool instance for relay operations
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
    streamFactory?: StreamFactory;
    logger?: AskExpertsServerLogger;
    nickname?: string;
    description?: string;
    profileHashtags?: string[];
    picture?: string;
    tags?: string[][];
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
    this.#profileHashtags = options.profileHashtags || [];
    this.#picture = options.picture || '';
    this.#tags = options.tags || [];
    this.#formats = options.formats || [FORMAT_TEXT];
    this.#onAsk = options.onAsk;
    this.#onPrompt = options.onPrompt;
    this.#onProof = options.onProof;

    // Optional parameters with defaults
    this.#paymentMethods = options.paymentMethods || [METHOD_LIGHTNING];
    this.#streamFactory = options.streamFactory || getStreamFactory();

    // Set the required pool
    this.pool = options.pool;
    
    // Set the logger if provided
    this.#logger = options.logger;
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

  get picture() {
    return this.#picture;
  }

  set picture(value: string) {
    this.#picture = value;
    this.schedulePublishProfile();
  }

  get profileHashtags() {
    return this.#profileHashtags;
  }

  set profileHashtags(value: string[]) {
    this.#profileHashtags = value;
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

  get streamFactory() {
    return this.#streamFactory;
  }

  set streamFactory(value: StreamFactory) {
    this.#streamFactory = value;
  }

  get tags() {
    return this.#tags;
  }

  set tags(value: string[][]) {
    this.#tags = value;
    this.schedulePublishProfile();
  }

  get logger() {
    return this.#logger;
  }

  set logger(value: AskExpertsServerLogger | undefined) {
    this.#logger = value;
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

  private log(type: string, content: string | any, promptId?: string) {
    if (!this.#logger) return;
    if (typeof content === 'string')
      this.#logger.log(type, content, promptId)
    else
      this.#logger.log(type, JSON.stringify(content), promptId)
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
      // Add streaming support tag
      ["s", "true"],
      ...this.#paymentMethods.map((method) => ["m", method]),
      ...(this.#profileHashtags?.map((tag) => ["t", tag]) || []),
      ...this.#tags,
    ];
    if (this.#picture) {
      tags.push(["picture", this.#picture]);
    }
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
      [...this.#discoveryRelays, ...SEARCH_RELAYS],
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

    // Add streaming support to filter
    filter["#s"] = ["true"];

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

      // Check if streaming is supported
      const streamTag = askEvent.tags.find(
        (tag) => tag.length > 1 && tag[0] === "s" && tag[1] === "true"
      );
      const askStreamSupported = !!streamTag;

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
        stream: askStreamSupported,
        methods: askMethods,
        event: askEvent,
      };

      // Call the onAsk callback
      const bid = await this.#onAsk(ask);
      this.log("ask", { ask, bid });

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
      const streamSupported =
        expertBid.stream !== undefined ? expertBid.stream : true;
      const methods = expertBid.methods || this.#paymentMethods;

      // Validate that provided values are compatible with supported values
      const validFormats = formats.filter((format) =>
        this.#formats.includes(format)
      );
      const validMethods = methods.filter((method) =>
        this.#paymentMethods.includes(method)
      );

      // Create tags for the bid payload
      const tags: string[][] = [
        ...this.#promptRelays.map((relay) => ["relay", relay]),
        ...validFormats.map((format) => ["f", format]),
        ...(streamSupported ? [["s", "true"]] : []),
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

      // First, decrypt the prompt payload from the event content to get the format
      // This is required even if we're using streaming
      let promptPayload;

      try {
        // Decrypt the prompt payload
        const decryptedPrompt = decrypt(
          promptEvent.content,
          promptEvent.pubkey,
          this.#privkey
        );

        const rawPayload = JSON.parse(decryptedPrompt);
        promptPayload = promptPayloadSchema.parse(rawPayload);
      } catch (error) {
        debugError("Error decrypting or parsing prompt payload:", error);
        throw error;
      }

      // Check if this is a streamed prompt
      const streamTag = promptEvent.tags.find(
        (tag) => tag.length > 1 && tag[0] === "stream"
      );

      // Check if client supports streaming replies
      const clientSupportsStreaming = !!promptEvent.tags.find(
        (tag) => tag.length > 1 && tag[0] === "s" && tag[1] === "true"
      );

      // Create the Prompt object with format from promptPayload
      // Content will be set later based on whether we have a stream or not
      const prompt: Prompt = {
        id: promptEvent.id,
        expertPubkey: this.pubkey,
        format: promptPayload.format as PromptFormat,
        content: undefined, // Will be set below
        stream: clientSupportsStreaming, // Set the stream flag based on the 's' tag
        event: promptEvent,
        context: undefined,
      };

      // If we have a stream tag, get content from the stream
      if (streamTag) {
        try {
          // Decrypt the stream metadata
          const decryptedStreamTag = decrypt(
            streamTag[1],
            promptEvent.pubkey,
            this.#privkey
          );

          // Parse the stream metadata event
          const streamMetadataEvent = JSON.parse(decryptedStreamTag);

          // Parse the stream metadata
          const streamMetadata = parseStreamMetadataEvent(streamMetadataEvent);
          streamMetadata.receiver_privkey = this.#privkey;

          // Create stream reader
          const streamReader = await this.#streamFactory.createReader(
            streamMetadata,
            this.pool
          );

          // Read all chunks from the stream
          // Don't convert bytes to string if binary
          let content: string | Uint8Array = "";
          let chunks: (string | Uint8Array)[] = [];

          for await (const chunk of streamReader) {
            chunks.push(chunk);
          }

          // Concatenate chunks based on their type
          if (!streamMetadata.binary) {
            // String chunks
            content = chunks.join("");
          } else {
            // Binary chunks - concatenate Uint8Arrays
            const totalLength = chunks.reduce(
              (acc, chunk) => acc + (chunk as Uint8Array).length,
              0
            );

            content = new Uint8Array(totalLength);
            let offset = 0;
            for (const chunk of chunks) {
              const typedChunk = chunk as Uint8Array;
              content.set(typedChunk, offset);
              offset += typedChunk.length;
            }
          }

          if (prompt.format === FORMAT_OPENAI) {
            // Sanity check
            if (content instanceof Uint8Array)
              throw new Error("Format openai expects string, not bytes");
            prompt.content = JSON.parse(content);
          } else {
            prompt.content = content;
          }
        } catch (error) {
          debugError("Error processing streamed prompt:", error);
          throw error;
        }
      } else if (promptPayload) {
        // No stream, use content from promptPayload
        prompt.content = promptPayload.payload;
      } else {
        throw new Error("No prompt content available");
      }

      try {
        try {
          // Call the onPrompt callback
          const expertQuote = await this.#onPrompt(prompt);
          this.log("prompt", { prompt, expertQuote }, prompt.id);

          // Create a full Quote from the ExpertQuote
          const quote: Quote = {
            pubkey: this.pubkey,
            promptId: prompt.id,
            invoices: expertQuote.invoices,
            event: undefined as unknown as Event, // we'll be filled in sendQuote
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
          this.log("reply", { proof, result }, prompt.id);

          let useStreaming: boolean;
          if (Symbol.asyncIterator in result) {
            useStreaming = true;
          } else {
            // Check if we need to use streaming based on content size
            const SIZE_THRESHOLD = 48 * 1024; // 48KB
            const contentSize = this.getContentSizeBytes(result.content);
            useStreaming = contentSize > SIZE_THRESHOLD;
          }

          // Check if streaming is needed but client doesn't support it
          if (useStreaming && !prompt.stream) {
            throw new Error(
              "Streaming is required for this response, but client doesn't support it"
            );
          }

          // Always send 1 reply event
          if (useStreaming) {
            // It's ExpertReplies - use streaming
            await this.streamExpertReplies(prompt, result);
          } else {
            // Content is small, embed in reply event
            await this.sendExpertReply(prompt, (result as ExpertReply).content);
          }
        } catch (error) {
          // If the callback throws an error, send a single error reply with done=true
          debugError("Error in onProof callback:", error);

          // Get error description
          const errorString =
            error instanceof Error
              ? error.message
              : "Unknown error in proof processing";

          // Send the error reply
          await this.sendExpertReply(prompt, undefined, errorString);
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
   * @param content - Content to send
   * @param error - Error to send
   */
  private async sendExpertReply(
    prompt: Prompt,
    content?: any,
    error?: string
  ): Promise<void> {
    try {
      let encryptedContent = "";
      if (content || error) {
        // Create the reply payload
        const replyPayload: ReplyPayload = {
          payload: content,
          error,
        };

        // Convert to JSON string
        const replyPayloadStr = JSON.stringify(replyPayload);

        // Use regular encryption for smaller content
        encryptedContent = encrypt(
          replyPayloadStr,
          prompt.event.pubkey,
          this.#privkey
        );
      }

      // Create and sign the reply event
      const replyEvent = createEvent(
        EVENT_KIND_REPLY,
        encryptedContent,
        [
          ["p", prompt.event.pubkey],
          ["e", prompt.id],
        ],
        this.#privkey
      );

      // Publish the reply event to prompt relays
      const publishedRelays = await publishToRelays(
        replyEvent,
        this.#promptRelays,
        this.pool
      );

      debugExpert(
        `Published reply to ${publishedRelays.length} relays for prompt ${prompt.id}`
      );
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
  /**
   * Helper function to calculate the size of content in bytes
   *
   * @param content - The content to measure
   * @returns Size in bytes
   */
  private getContentSizeBytes(content: any): number {
    if (content instanceof Uint8Array) {
      return content.length;
    } else if (typeof content === "string") {
      return new TextEncoder().encode(content).length;
    } else {
      // For objects or other types, stringify then encode
      return new TextEncoder().encode(JSON.stringify(content)).length;
    }
  }

  /**
   * Streams expert replies using a single reply event with stream metadata
   *
   * @param prompt - The prompt
   * @param expertReplies - The expert replies
   */
  private async streamExpertReplies(
    prompt: Prompt,
    expertReplies: ExpertReply | ExpertReplies
  ): Promise<void> {
    try {
      // Create stream metadata
      const { privateKey: streamPrivkey, publicKey: streamPubkey } =
        generateRandomKeyPair();

      // Generate a new key pair for encryption
      const { privateKey: streamEncryptionPrivkey } = generateRandomKeyPair();

      const binary =
        Symbol.asyncIterator in expertReplies
          ? expertReplies.binary
          : expertReplies.content instanceof Uint8Array;

      // Create stream metadata
      const streamMetadata: StreamMetadata = {
        streamId: streamPubkey,
        relays: this.#promptRelays,
        encryption: "nip44",
        compression: COMPRESSION_GZIP,
        binary,
        receiver_pubkey: prompt.event.pubkey,
        version: "1",
      };

      // Create stream writer
      const streamWriter = await this.#streamFactory.createWriter(
        streamMetadata,
        this.pool,
        streamPrivkey
      );

      // Create stream metadata event
      const streamMetadataEvent = createStreamMetadataEvent(
        streamMetadata,
        streamPrivkey
      );

      // Encrypt the stream metadata event
      const encryptedStreamMetadata = encrypt(
        JSON.stringify(streamMetadataEvent),
        prompt.event.pubkey,
        this.#privkey
      );

      // Create reply event with stream tag
      const replyEvent = createEvent(
        EVENT_KIND_REPLY,
        "", // Empty content when using stream
        [
          ["p", prompt.event.pubkey],
          ["e", prompt.id],
          ["stream", encryptedStreamMetadata],
        ],
        this.#privkey
      );

      // Publish the reply event
      const publishedRelays = await publishToRelays(
        replyEvent,
        this.#promptRelays,
        this.pool
      );

      if (publishedRelays.length === 0) {
        throw new Error("Failed to publish reply event to any relay");
      }

      // Stream each reply
      try {
        let stream =
          Symbol.asyncIterator in expertReplies
            ? expertReplies
            : [expertReplies];
        // Iterate through the expert replies
        for await (const expertReply of stream) {
          let content = expertReply.content;
          if (content instanceof Uint8Array) {
            if (!binary) throw new Error("Non-bytes reply for binary stream");
          } else if (typeof content !== "string") {
            // JSONL format
            content = JSON.stringify(content) + "\n";
          }

          // Write content directly to stream without creating a payload structure
          await streamWriter.write(content, false);
        }

        // Close the stream
        await streamWriter.write(binary ? new Uint8Array() : "", true);
      } catch (error) {
        debugError("Error streaming expert replies:", error);
        // Try to write an error message and close the stream
        try {
          const errorMessage =
            error instanceof Error
              ? error.message
              : "Unknown error streaming replies";
          await streamWriter.error("INTERNAL", errorMessage);
        } catch (e) {
          debugError("Error writing error to stream:", e);
        }
      }

      debugExpert(
        `Streamed replies to ${publishedRelays.length} relays for prompt ${prompt.id}`
      );
    } catch (error) {
      debugError("Error setting up stream for expert replies:", error);
    }
  }

  /**
   * Disposes of resources when the expert is no longer needed
   */
  async [Symbol.asyncDispose]() {
    debugExpert("Clearing AskExpertsServerBase");
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
