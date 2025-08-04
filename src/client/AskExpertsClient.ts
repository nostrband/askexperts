/**
 * AskExpertsClient implementation for NIP-174
 * Works in both browser and Node.js environments
 */

import { Event, SimplePool } from "nostr-tools";
import { z } from "zod";
import { debugError } from "../common/debug.js";
import { parseBolt11 } from "../common/bolt11.js";

import {
  AskExpertsError,
  RelayError,
  TimeoutError,
  ExpertError,
  PaymentRejectedError,
} from "./errors.js";

import {
  EVENT_KIND_ASK,
  EVENT_KIND_BID,
  EVENT_KIND_BID_PAYLOAD,
  EVENT_KIND_EXPERT_PROFILE,
  EVENT_KIND_PROMPT,
  EVENT_KIND_QUOTE,
  EVENT_KIND_PROOF,
  EVENT_KIND_REPLY,
  FORMAT_TEXT,
  METHOD_LIGHTNING,
  DEFAULT_DISCOVERY_RELAYS,
  DEFAULT_DISCOVERY_TIMEOUT,
  DEFAULT_FETCH_EXPERTS_TIMEOUT,
  DEFAULT_QUOTE_TIMEOUT,
  DEFAULT_REPLY_TIMEOUT,
} from "../common/constants.js";

import {
  FindExpertsParams,
  FetchExpertsParams,
  AskExpertParams,
  Bid,
  Expert,
  Prompt,
  Quote,
  Proof,
  Reply,
  Replies,
  PromptFormat,
  PaymentMethod,
  OnQuoteCallback,
  OnPayCallback,
} from "../common/types.js";

import {
  Compression,
  COMPRESSION_GZIP,
  COMPRESSION_NONE,
  getCompression,
} from "../stream/compression.js";
import {
  encrypt,
  decrypt,
  createEvent,
  generateRandomKeyPair,
  validateNostrEvent,
} from "../common/crypto.js";
import {
  publishToRelays,
  subscribeToRelays,
  fetchFromRelays,
  waitForEvent,
  createEventStream,
} from "../common/relay.js";
import { CompressionMethod } from "../stream/types.js";

/**
 * AskExpertsClient class for NIP-174 protocol
 */
export class AskExpertsClient {
  /**
   * Zod schema for quote payload
   */
  private quotePayloadSchema = z.object({
    invoices: z
      .array(
        z.object({
          method: z.string(),
          unit: z.string(),
          amount: z.number(),
          invoice: z.string().optional(),
        })
      )
      .optional(),
    error: z.string().optional(),
  });

  /**
   * Zod schema for reply payload
   */
  private replyPayloadSchema = z.object({
    content: z.any(),
    done: z.boolean().optional().default(false),
    error: z.string().optional(),
  });
  /**
   * Default onQuote callback
   */
  private defaultOnQuote?: OnQuoteCallback;

  /**
   * Default onPay callback
   */
  private defaultOnPay?: OnPayCallback;

  /**
   * Compression instance for compressing and decompressing data
   */
  private compression: Compression;

  /**
   * SimplePool instance for relay operations
   */
  private pool: SimplePool;

  /**
   * Flag indicating whether the pool was created internally
   */
  private poolCreatedInternally: boolean;

  /**
   * Array of discovery relay URLs to use as fallback
   */
  private discoveryRelays?: string[];

  /**
   * Creates a new AskExpertsClient instance
   *
   * @param options - Optional configuration
   * @param options.onQuote - Default callback for handling quotes
   * @param options.onPay - Default callback for handling payments
   * @param options.compression - Custom compression implementation
   * @param options.pool - SimplePool instance for relay operations
   * @param options.discoveryRelays - Array of discovery relay URLs to use as fallback
   */
  constructor(options?: {
    onQuote?: OnQuoteCallback;
    onPay?: OnPayCallback;
    compression?: Compression;
    pool?: SimplePool;
    discoveryRelays?: string[];
  }) {
    this.defaultOnQuote = options?.onQuote;
    this.defaultOnPay = options?.onPay;
    this.compression = options?.compression || getCompression();
    this.discoveryRelays = options?.discoveryRelays;

    // Check if pool is provided or needs to be created internally
    this.poolCreatedInternally = !options?.pool;
    this.pool = options?.pool || new SimplePool();
  }

  /**
   * Disposes of resources when the client is no longer needed
   */
  [Symbol.dispose](): void {
    // Only destroy the pool if it was created internally
    if (this.poolCreatedInternally) {
      this.pool.destroy(); // Properly destroy the pool
    }
  }

  /**
   * Finds experts by publishing an ask event and collecting bids
   *
   * @param params - Parameters for finding experts
   * @returns Promise resolving to array of Bid objects
   */
  async findExperts(params: FindExpertsParams): Promise<Bid[]> {
    // Validate parameters
    if (!params.summary || params.summary.trim() === "") {
      throw new AskExpertsError("Summary is required");
    }

    if (!params.hashtags || params.hashtags.length === 0) {
      throw new AskExpertsError("At least one hashtag is required");
    }

    // Set default values
    const formats = params.formats || [FORMAT_TEXT];

    // Validate compression methods if provided
    const supportedComprs = this.compression.list();
    if (params.comprs) {
      const unsupportedComprs = params.comprs.filter(
        (compr) => !supportedComprs.includes(compr)
      );
      if (unsupportedComprs.length > 0) {
        throw new AskExpertsError(
          `Unsupported compression method(s): ${unsupportedComprs.join(", ")}`
        );
      }
    }

    const comprs = params.comprs || supportedComprs;
    const methods = params.methods || [METHOD_LIGHTNING];
    const relays =
      params.relays || this.discoveryRelays || DEFAULT_DISCOVERY_RELAYS;

    // Generate a random key pair for the ask
    const { privateKey: askPrivkey, publicKey: askPubkey } =
      generateRandomKeyPair();

    // Create tags for the ask event
    const tags: string[][] = [
      ...params.hashtags.map((tag) => ["t", tag]),
      ...formats.map((format) => ["f", format]),
      ...comprs.map((compr) => ["c", compr]),
      ...methods.map((method) => ["m", method]),
    ];

    // Create and sign the ask event
    const askEvent = createEvent(
      EVENT_KIND_ASK,
      params.summary,
      tags,
      askPrivkey
    );

    // Publish the ask event to relays
    const publishedRelays = await publishToRelays(
      askEvent,
      relays,
      this.pool,
      5000
    );

    if (publishedRelays.length === 0) {
      throw new RelayError("Failed to publish ask event to any relay");
    }

    // Subscribe to bid events
    const bids: Bid[] = [];
    const seenPubkeys = new Set<string>();

    // Create a filter for bid events
    const filter = {
      kinds: [EVENT_KIND_BID],
      "#e": [askEvent.id],
      since: Math.floor(Date.now() / 1000) - 60, // Get events from the last minute
    };

    // Subscribe to bid events
    const sub = subscribeToRelays([filter], publishedRelays, this.pool, {
      onevent: async (event: Event) => {
        try {
          // No need to validate events from relay - they're already validated

          // Ensure it's tagging our ask
          const eTag = event.tags.find((tag) => tag[0] === "e");
          if (!eTag || eTag[1] !== askEvent.id) {
            debugError("Bid event has wrong e-tag:", eTag);
            return;
          }

          // Decrypt the bid payload
          const decrypted = decrypt(event.content, event.pubkey, askPrivkey);

          // Parse the decrypted content as a bid payload event
          const bidPayloadEvent: Event = JSON.parse(decrypted);

          // Validate the bid payload event
          if (!validateNostrEvent(bidPayloadEvent)) {
            debugError("Invalid bid payload event:", bidPayloadEvent);
            return;
          }

          // Check the kind
          if (bidPayloadEvent.kind !== EVENT_KIND_BID_PAYLOAD) {
            debugError("Invalid bid payload event kind:", bidPayloadEvent.kind);
            return;
          }

          // Only accept one bid per expert pubkey
          if (seenPubkeys.has(bidPayloadEvent.pubkey)) {
            return;
          }

          // Extract relay URLs from the tags
          const relayTags = bidPayloadEvent.tags.filter(
            (tag) => tag[0] === "relay"
          );
          const bidRelays = relayTags.map((tag) => tag[1]);

          if (bidRelays.length === 0) {
            debugError(
              "Bid payload event missing relay tags:",
              bidPayloadEvent
            );
            return;
          }

          // Extract formats from the tags
          const formatTags = bidPayloadEvent.tags.filter(
            (tag) => tag[0] === "f"
          );
          const bidFormats = formatTags.map((tag) => tag[1]) as PromptFormat[];

          // Extract compression methods from the tags
          const comprTags = bidPayloadEvent.tags.filter(
            (tag) => tag[0] === "c"
          );
          const bidComprs = comprTags.map(
            (tag) => tag[1]
          ) as CompressionMethod[];

          // Extract payment methods from the tags
          const methodTags = bidPayloadEvent.tags.filter(
            (tag) => tag[0] === "m"
          );
          const bidMethods = methodTags.map((tag) => tag[1]) as PaymentMethod[];

          // Create a Bid object
          const bid: Bid = {
            id: event.id,
            pubkey: bidPayloadEvent.pubkey,
            payloadId: bidPayloadEvent.id,
            offer: bidPayloadEvent.content,
            relays: bidRelays,
            formats: bidFormats,
            compressions: bidComprs,
            methods: bidMethods,
            event,
            payloadEvent: bidPayloadEvent,
          };

          // Add the bid to the array
          bids.push(bid);
          seenPubkeys.add(bidPayloadEvent.pubkey);
        } catch (error) {
          debugError("Error processing bid event:", error);
        }
      },
    });

    // Wait for the specified timeout
    await new Promise((resolve) =>
      setTimeout(resolve, DEFAULT_DISCOVERY_TIMEOUT)
    );

    // Close the subscription
    sub.close();

    return bids;
  }

  /**
   * Fetches expert profiles from relays
   *
   * @param params - Parameters for fetching expert profiles
   * @returns Promise resolving to array of Expert objects
   */
  async fetchExperts(params: FetchExpertsParams): Promise<Expert[]> {
    // Validate parameters
    if (!params.pubkeys || params.pubkeys.length === 0) {
      throw new AskExpertsError("At least one pubkey is required");
    }

    // Set default values
    const relays =
      params.relays || this.discoveryRelays || DEFAULT_DISCOVERY_RELAYS;

    // Create a filter for expert profile events
    const filter = {
      kinds: [EVENT_KIND_EXPERT_PROFILE],
      authors: params.pubkeys,
      since: Math.floor(Date.now() / 1000) - 86400, // Get events from the last day
    };

    // Fetch expert profile events
    const events = await fetchFromRelays(
      filter,
      relays,
      this.pool,
      DEFAULT_FETCH_EXPERTS_TIMEOUT
    );

    // Process events into Expert objects
    const experts: Expert[] = [];
    const seenPubkeys = new Set<string>();

    for (const event of events) {
      try {
        // No need to validate events from relay - they're already validated

        // Only take the newest event for each pubkey
        if (seenPubkeys.has(event.pubkey)) {
          continue;
        }

        // Extract relay URLs from the tags
        const relayTags = event.tags.filter((tag) => tag[0] === "relay");
        const expertRelays = relayTags.map((tag) => tag[1]);

        if (expertRelays.length === 0) {
          debugError("Expert profile event missing relay tags:", event);
          continue;
        }

        // Extract formats from the tags
        const formatTags = event.tags.filter((tag) => tag[0] === "f");
        const expertFormats = formatTags.map((tag) => tag[1]) as PromptFormat[];

        // Extract compression methods from the tags
        const comprTags = event.tags.filter((tag) => tag[0] === "c");
        const expertComprs = comprTags.map(
          (tag) => tag[1]
        ) as CompressionMethod[];

        // Extract payment methods from the tags
        const methodTags = event.tags.filter((tag) => tag[0] === "m");
        const expertMethods = methodTags.map(
          (tag) => tag[1]
        ) as PaymentMethod[];

        // Extract hashtags from the tags
        const hashtagTags = event.tags.filter((tag) => tag[0] === "t");
        const expertHashtags = hashtagTags.map((tag) => tag[1]);

        // Extract name from the tags
        const nameTag = event.tags.find((tag) => tag[0] === "name");
        const name = nameTag ? nameTag[1] : undefined;

        // Create an Expert object
        const expert: Expert = {
          pubkey: event.pubkey,
          name,
          description: event.content,
          relays: expertRelays,
          formats: expertFormats,
          compressions: expertComprs,
          methods: expertMethods,
          hashtags: expertHashtags,
          event,
        };

        // Add the expert to the array
        experts.push(expert);
        seenPubkeys.add(event.pubkey);
      } catch (error) {
        debugError("Error processing expert profile event:", error);
      }
    }

    return experts;
  }

  /**
   * Sends a prompt to an expert
   *
   * @param expertPubkey - Expert's public key
   * @param expertRelays - Expert's relays
   * @param content - Content of the prompt
   * @param format - Format of the prompt
   * @param compr - Compression method to use
   * @param compression - Compression instance
   * @returns Promise resolving to a tuple of [Prompt, promptPrivkey, publishedRelays]
   * @private
   */
  private async sendPrompt(
    expertPubkey: string,
    expertRelays: string[],
    content: any,
    format: PromptFormat,
    compr: CompressionMethod,
    compression: Compression,
    promptPrivkey: Uint8Array
  ): Promise<Prompt> {
    // Create the prompt payload
    const promptPayload = {
      format,
      content,
    };

    // Convert to JSON string
    const promptPayloadStr = JSON.stringify(promptPayload);

    // Compress the payload
    const compressedPayload = await compression.compress(
      promptPayloadStr,
      compr
    );

    // Encrypt the payload
    // If compressedPayload is a Uint8Array, convert it to string for encryption
    const dataToEncrypt = typeof compressedPayload === 'string'
      ? compressedPayload
      : new TextDecoder().decode(compressedPayload);
      
    const encryptedContent = encrypt(
      dataToEncrypt,
      expertPubkey,
      promptPrivkey
    );

    // Create and sign the prompt event
    const promptEvent = createEvent(
      EVENT_KIND_PROMPT,
      encryptedContent,
      [
        ["p", expertPubkey],
        ["c", compr],
      ],
      promptPrivkey
    );

    // Publish the prompt event to the expert's relays
    const publishedRelays = await publishToRelays(
      promptEvent,
      expertRelays,
      this.pool,
      5000
    );

    if (publishedRelays.length === 0) {
      throw new RelayError("Failed to publish prompt event to any relay");
    }

    // Create the Prompt object
    const prompt: Prompt = {
      id: promptEvent.id,
      expertPubkey,
      format,
      content,
      event: promptEvent,
      context: {}, // Add empty context object to satisfy the type
    };

    return prompt;
  }

  /**
   * Fetches a quote from an expert
   *
   * @param promptId - Prompt event ID
   * @param expertPubkey - Expert's public key
   * @param promptPrivkey - Private key used for the prompt
   * @param publishedRelays - Relays where the prompt was published
   * @returns Promise resolving to Quote object
   * @private
   */
  private async fetchQuote(
    promptId: string,
    expertPubkey: string,
    promptPrivkey: Uint8Array,
    publishedRelays: string[]
  ): Promise<Quote> {
    // Create a filter for quote events
    const quoteFilter = {
      kinds: [EVENT_KIND_QUOTE],
      "#e": [promptId],
      authors: [expertPubkey],
    };

    // Wait for the quote event
    const quoteEvent = await waitForEvent(
      quoteFilter,
      publishedRelays,
      this.pool,
      DEFAULT_QUOTE_TIMEOUT
    );

    if (!quoteEvent) {
      throw new TimeoutError("Timeout waiting for quote event");
    }

    // No need to validate events from relay - they're already validated

    // Decrypt the quote payload
    const decryptedQuote = decrypt(
      quoteEvent.content,
      expertPubkey,
      promptPrivkey
    );

    try {
      // Parse and validate the quote payload using Zod
      const rawPayload = JSON.parse(decryptedQuote);
      const quotePayload = this.quotePayloadSchema.parse(rawPayload);

      // If there's an error in the quote payload, throw it
      if (quotePayload.error) {
        throw new ExpertError(`Expert error: ${quotePayload.error}`);
      }

      if (!quotePayload.invoices) {
        throw new ExpertError(`Expert error: no invoices`);
      }

      // Create the Quote object
      const quote: Quote = {
        pubkey: expertPubkey,
        promptId,
        invoices: quotePayload.invoices,
        event: quoteEvent,
      };

      return quote;
    } catch (error) {
      if (error instanceof z.ZodError) {
        throw new ExpertError(`Invalid quote payload: ${error.message}`);
      }
      throw error;
    }
  }

  /**
   * Sends an error proof to an expert and throws an error
   *
   * @param errorMessage - Error message
   * @param expertPubkey - Expert's public key
   * @param promptId - Prompt event ID
   * @param promptPrivkey - Private key used for the prompt
   * @param publishedRelays - Relays where the prompt was published
   * @param error - Error to throw
   * @throws The provided error
   * @private
   */
  private async sendErrorProof(
    errorMessage: string,
    expertPubkey: string,
    promptId: string,
    promptPrivkey: Uint8Array,
    relays: string[]
  ): Promise<void> {
    // Create the error proof payload
    const errorProofPayload = {
      error: errorMessage,
    };

    // Convert to JSON string
    const errorProofStr = JSON.stringify(errorProofPayload);

    // Encrypt the error proof payload
    const encryptedErrorProof = encrypt(
      errorProofStr,
      expertPubkey,
      promptPrivkey
    );

    // Create and sign the proof event with error
    const errorProofEvent = createEvent(
      EVENT_KIND_PROOF,
      encryptedErrorProof,
      [
        ["p", expertPubkey],
        ["e", promptId],
      ],
      promptPrivkey
    );

    // Publish the error proof event to the expert's relays
    await publishToRelays(errorProofEvent, relays, this.pool, 5000);
  }

  /**
   * Sends a proof to an expert
   *
   * @param proof - Proof object
   * @param expertPubkey - Expert's public key
   * @param promptId - Prompt event ID
   * @param promptPrivkey - Private key used for the prompt
   * @param publishedRelays - Relays where the prompt was published
   * @returns Promise resolving to published relays
   * @private
   */
  private async sendProof(
    proof: Proof,
    expertPubkey: string,
    promptId: string,
    promptPrivkey: Uint8Array,
    publishedRelays: string[]
  ): Promise<string[]> {
    // Create the proof payload
    const proofPayload = {
      method: proof.method,
      preimage: proof.preimage,
    };

    // Convert to JSON string
    const proofPayloadStr = JSON.stringify(proofPayload);

    // Encrypt the proof payload
    const encryptedProof = encrypt(
      proofPayloadStr,
      expertPubkey,
      promptPrivkey
    );

    // Create and sign the proof event
    const proofEvent = createEvent(
      EVENT_KIND_PROOF,
      encryptedProof,
      [
        ["p", expertPubkey],
        ["e", promptId],
      ],
      promptPrivkey
    );

    // Publish the proof event to the expert's relays
    const proofPublishedRelays = await publishToRelays(
      proofEvent,
      publishedRelays,
      this.pool,
      5000
    );

    if (proofPublishedRelays.length === 0) {
      throw new RelayError("Failed to publish proof event to any relay");
    }

    return proofPublishedRelays;
  }

  /**
   * Creates a Replies object that handles reply events
   *
   * @param promptId - Prompt event ID
   * @param expertPubkey - Expert's public key
   * @param promptPrivkey - Private key used for the prompt
   * @param publishedRelays - Relays where the prompt was published
   * @param compression - Compression instance
   * @returns Replies object
   * @private
   */
  private createRepliesHandler(
    promptId: string,
    expertPubkey: string,
    promptPrivkey: Uint8Array,
    publishedRelays: string[],
    compression: Compression
  ): Replies {
    // Get a reference to the replyPayloadSchema
    const replyPayloadSchema = this.replyPayloadSchema;
    // Create a filter for reply events
    const replyFilter = {
      kinds: [EVENT_KIND_REPLY],
      "#e": [promptId],
      authors: [expertPubkey],
    };

    // Create an event stream for replies
    const replyStream = createEventStream(
      replyFilter,
      publishedRelays,
      this.pool,
      {
        timeout: DEFAULT_REPLY_TIMEOUT * 2,
      }
    );

    // Create the Replies object
    const replies: Replies = {
      promptId,
      expertPubkey,

      // Implement AsyncIterable interface
      [Symbol.asyncIterator]: async function* () {
        for await (const event of replyStream) {
          try {
            // No need to validate events from relay - they're already validated

            // Get the compression method from the c tag
            const cTag = event.tags.find((tag) => tag[0] === "c");
            const replyCompr =
              (cTag?.[1] as CompressionMethod) || COMPRESSION_NONE;

            // Decrypt the reply payload
            const decryptedReply = decrypt(
              event.content,
              expertPubkey,
              promptPrivkey
            );

            // Decompress the payload using the compression instance from the Replies object (this)
            // Since decompress now accepts string input, we can pass decryptedReply directly
            const replyPayloadData = await compression.decompress(
              decryptedReply,
              replyCompr,
              false // non-binary mode
            );

            try {
              // Parse and validate the reply payload using Zod
              // Convert to string if it's a Uint8Array
              const replyPayloadStr = typeof replyPayloadData === 'string'
                ? replyPayloadData
                : new TextDecoder().decode(replyPayloadData);
                
              const rawPayload = JSON.parse(replyPayloadStr);
              const replyPayload = replyPayloadSchema.parse(rawPayload);

              // Check if there's an error in the reply payload
              if (replyPayload.error) {
                throw new ExpertError(
                  `Expert reply error: ${replyPayload.error}`
                );
              }

              // Create the Reply object
              const reply: Reply = {
                pubkey: expertPubkey,
                promptId,
                done: !!replyPayload.done,
                content: replyPayload.content,
                event,
              };

              // Yield the reply
              yield reply;

              // If this is the last reply, break the loop
              if (reply.done) {
                break;
              }
            } catch (error) {
              if (error instanceof z.ZodError) {
                throw new ExpertError(
                  `Invalid reply payload: ${error.message}`
                );
              }
              throw error;
            }

            // The reply is already yielded in the try block
          } catch (error) {
            debugError("Error processing reply event:", error);
          }
        }
      },
    };

    return replies;
  }

  /**
   * Asks an expert a question and receives replies
   *
   * @param params - Parameters for asking an expert
   * @returns Promise resolving to Replies object
   */
  async askExpert(params: AskExpertParams): Promise<Replies> {
    // Validate parameters
    if (!params.expert && !params.bid) {
      throw new AskExpertsError("Either expert or bid must be provided");
    }

    if (!params.content) {
      throw new AskExpertsError("Content is required");
    }

    // Use the callbacks from params or the default callbacks from constructor
    const onQuote = params.onQuote || this.defaultOnQuote;
    const onPay = params.onPay || this.defaultOnPay;

    // If no onQuote callback is available, throw an error
    if (!onQuote) {
      throw new Error("No onQuote callback provided");
    }

    // If no onPay callback is available, throw an error
    if (!onPay) {
      throw new Error("No onPay callback provided");
    }

    // Determine which expert to use
    const expertPubkey = params.bid?.pubkey || params.expert?.pubkey;
    const expertRelays = params.bid?.relays || params.expert?.relays || [];

    if (!expertPubkey) {
      throw new AskExpertsError("Expert pubkey is missing");
    }

    if (expertRelays.length === 0) {
      throw new AskExpertsError("Expert relays are missing");
    }

    const supportedFormats =
      params.bid?.formats || params.expert?.formats || [];
    const supportedComprs =
      params.bid?.compressions || params.expert?.compressions || [];

    // Determine format and compression
    // Assume the first supported format, fallback to text
    const format = params.format || supportedFormats[0] || FORMAT_TEXT;
    // Prefer gzip, assume first supported compr, fallback to none
    const compr =
      params.compr ||
      (supportedComprs.includes(COMPRESSION_GZIP)
        ? COMPRESSION_GZIP
        : supportedComprs[0] || COMPRESSION_NONE);

    // Check if format is supported
    if (supportedFormats.length > 0 && !supportedFormats.includes(format)) {
      throw new AskExpertsError(
        `Format ${format} is not supported by the expert`
      );
    }

    // Check if compression is supported
    if (supportedComprs.length > 0 && !supportedComprs.includes(compr)) {
      throw new AskExpertsError(
        `Compression ${compr} is not supported by the expert`
      );
    }

    // Use the compression instance from params or the default one
    const compressionInstance = params.compression || this.compression;

    // Generate a random key pair for the prompt
    const { privateKey: promptPrivkey } = generateRandomKeyPair();

    // Send the prompt to the expert
    const prompt = await this.sendPrompt(
      expertPubkey,
      expertRelays,
      params.content,
      format,
      compr,
      compressionInstance,
      promptPrivkey
    );

    // Fetch the quote from the expert
    const quote = await this.fetchQuote(
      prompt.id,
      expertPubkey,
      promptPrivkey,
      expertRelays
    );

    // Call the onQuote callback to determine if we should proceed with payment
    let proof: Proof;

    try {
      // Validate the quote before calling onQuote
      this.validateQuote(quote);

      // onQuote returns a boolean indicating whether to proceed with payment
      const shouldPay = await onQuote(quote, prompt);

      if (shouldPay) {
        // If payment is accepted, call onPay to get the proof
        proof = await onPay(quote, prompt);
      } else {
        // If payment is rejected, will send a proof with error and throw PaymentRejectedError
        throw new PaymentRejectedError("Payment rejected by client");
      }
    } catch (error) {
      // If either callback throws an error, create a proof with an error message
      // to inform the expert that payment failed
      await this.sendErrorProof(
        error instanceof Error ? error.message : "Payment failed",
        expertPubkey,
        prompt.id,
        promptPrivkey,
        expertRelays
      );

      // Re-throw the error
      throw error;
    }

    // Send the proof to the expert
    await this.sendProof(
      proof,
      expertPubkey,
      prompt.id,
      promptPrivkey,
      expertRelays
    );

    // Create and return the Replies object
    return this.createRepliesHandler(
      prompt.id,
      expertPubkey,
      promptPrivkey,
      expertRelays,
      compressionInstance
    );
  }

  /**
   * Validates a quote by checking that all lightning invoices have matching amounts
   *
   * @param quote - The quote to validate
   * @throws PaymentRejectedError if any invoice amount doesn't match the expected amount
   */
  validateQuote(quote: Quote): void {
    // Find all lightning invoices in the quote
    for (const invoice of quote.invoices) {
      // Check if this is a lightning invoice with an invoice field
      if (invoice.method === METHOD_LIGHTNING && invoice.invoice) {
        try {
          // Parse the invoice using parseBolt11
          const parsedInvoice = parseBolt11(invoice.invoice);

          // Check if the parsed amount matches the expected amount
          if (parsedInvoice.amount_sats !== invoice.amount) {
            throw new PaymentRejectedError(
              `Invoice amount mismatch: expected ${invoice.amount} sats, but invoice contains ${parsedInvoice.amount_sats} sats`
            );
          }
        } catch (error) {
          // If parsing fails, throw a PaymentRejectedError
          if (error instanceof PaymentRejectedError) {
            throw error;
          }
          throw new PaymentRejectedError(
            `Failed to validate invoice: ${
              error instanceof Error ? error.message : String(error)
            }`
          );
        }
      }
    }
  }
}
