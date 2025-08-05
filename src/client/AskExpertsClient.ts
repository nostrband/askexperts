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

// No need to extend AskExpertParams as we've already updated it in types.ts

import { COMPRESSION_GZIP } from "../stream/compression.js";
import {
  StreamFactory,
  getStreamFactory,
  createStreamMetadataEvent,
  parseStreamMetadataEvent,
} from "../stream/index.js";
import { Event as NostrEvent } from "nostr-tools";
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
} from "../common/relay.js";

/**
 * AskExpertsClient class for NIP-174 protocol
 */
import { AskExpertsClientInterface } from "./AskExpertsClientInterface.js";

export class AskExpertsClient implements AskExpertsClientInterface {
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
  /**
   * Zod schema for reply payload according to NIP-174
   * A reply payload should have either an "error" field or a "content" field, but not both
   */
  private replyPayloadSchema = z
    .object({
      content: z.any().optional(),
      done: z.boolean().optional().default(false),
      error: z.string().optional(),
    })
    .refine((data) => !(data.error && data.content), {
      message: "Reply payload cannot have both error and content fields",
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
   * StreamFactory instance for creating stream readers and writers
   */
  private streamFactory: StreamFactory;

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
    streamFactory?: StreamFactory;
    pool?: SimplePool;
    discoveryRelays?: string[];
  }) {
    this.defaultOnQuote = options?.onQuote;
    this.defaultOnPay = options?.onPay;
    this.streamFactory = options?.streamFactory || getStreamFactory();
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

    // Set stream flag to true by default
    const streamSupported = params.stream !== undefined ? params.stream : true;
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
      ...(streamSupported ? [["s", "true"]] : []),
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

          // Check if streaming is supported
          const streamTag = bidPayloadEvent.tags.find(
            (tag) => tag[0] === "s" && tag[1] === "true"
          );
          const bidStreamSupported = !!streamTag;

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
            stream: bidStreamSupported,
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

        // Check if streaming is supported
        const streamTag = event.tags.find(
          (tag) => tag[0] === "s" && tag[1] === "true"
        );
        const expertStreamSupported = !!streamTag;

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
          stream: expertStreamSupported,
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
   * Sends a prompt to an expert
   *
   * @param expertPubkey - Expert's public key
   * @param expertRelays - Expert's relays
   * @param content - Content of the prompt
   * @param format - Format of the prompt
   * @param compr - Compression method to use
   * @param promptPrivkey - Private key for the prompt
   * @returns Promise resolving to a Prompt object
   * @private
   */
  private async sendPrompt(
    expertPubkey: string,
    expertRelays: string[],
    content: any,
    format: PromptFormat,
    useStreaming: boolean,
    promptPrivkey: Uint8Array
  ): Promise<Prompt> {
    // Create the prompt payload
    const promptPayload: any = {
      format,
    };

    // Check if we should use streaming based on the useStreaming flag
    // The content size check is now done in askExpert
    const shouldUseStreaming = useStreaming;

    let promptEvent;

    if (shouldUseStreaming) {
      // Create stream metadata
      const { privateKey: streamPrivkey, publicKey: streamPubkey } =
        generateRandomKeyPair();

      // Generate a new key pair for encryption
      const { privateKey: streamEncryptionPrivkey } = generateRandomKeyPair();

      // Binary?
      const binary = content instanceof Uint8Array;

      // Create stream metadata
      const streamMetadata = {
        streamId: streamPubkey,
        relays: expertRelays,
        encryption: "nip44",
        compression: COMPRESSION_GZIP,
        binary,
        key: Buffer.from(streamEncryptionPrivkey).toString("hex"),
        version: "1",
      };

      // Create stream writer
      const streamWriter = await this.streamFactory.createWriter(
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
        expertPubkey,
        promptPrivkey
      );

      // Create prompt event with stream tag
      promptEvent = createEvent(
        EVENT_KIND_PROMPT,
        "", // Empty content when using stream
        [
          ["p", expertPubkey],
          ["stream", encryptedStreamMetadata],
          ["s", "true"], // Signal that client supports streaming replies
        ],
        promptPrivkey
      );

      // Publish the prompt event
      const publishedRelays = await publishToRelays(
        promptEvent,
        expertRelays,
        this.pool,
        5000
      );

      if (publishedRelays.length === 0) {
        throw new RelayError("Failed to publish prompt event to any relay");
      }

      let payload: string | Uint8Array;
      if (binary) payload = content;
      else if (typeof content === "string") payload = content;
      else payload = JSON.stringify(content);

      // Write content to stream
      await streamWriter.write(payload, true);
    } else {
      // We'll send content embedded in the prompt event
      promptPayload.content = content;

      // Convert to JSON string
      const promptPayloadStr = JSON.stringify(promptPayload);

      // Use regular encryption for smaller content
      const encryptedContent = encrypt(
        promptPayloadStr,
        expertPubkey,
        promptPrivkey
      );

      // Create and sign the prompt event
      promptEvent = createEvent(
        EVENT_KIND_PROMPT,
        encryptedContent,
        [
          ["p", expertPubkey],
          ["s", "true"], // Signal that client supports streaming replies
        ],
        promptPrivkey
      );

      // Publish the prompt event
      const publishedRelays = await publishToRelays(
        promptEvent,
        expertRelays,
        this.pool,
        5000
      );

      if (publishedRelays.length === 0) {
        throw new RelayError("Failed to publish prompt event to any relay");
      }
    }

    // Create the Prompt object
    const prompt: Prompt = {
      id: promptEvent.id,
      expertPubkey,
      format,
      content,
      stream: true, // Set the stream flag in the Prompt object
      event: promptEvent,
      context: undefined,
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
    publishedRelays: string[]
  ): Replies {
    // Get a reference to the replyPayloadSchema
    const replyPayloadSchema = this.replyPayloadSchema;
    // Get a reference to the streamFactory
    const streamFactory = this.streamFactory;
    // Get a reference to the pool
    const pool = this.pool;

    // Create the Replies object
    const replies: Replies = {
      promptId,
      expertPubkey,

      // Implement AsyncIterable interface
      [Symbol.asyncIterator]: async function* () {
        try {
          // Create a filter for the single reply event
          const replyFilter = {
            kinds: [EVENT_KIND_REPLY],
            "#e": [promptId],
            authors: [expertPubkey],
          };

          // Wait for the single reply event
          const event = await waitForEvent(
            replyFilter,
            publishedRelays,
            pool,
            DEFAULT_REPLY_TIMEOUT
          );

          if (!event) {
            throw new TimeoutError("Timeout waiting for reply event");
          }

          // Check if this is a streamed reply
          const streamTag = event.tags.find((tag) => tag[0] === "stream");

          if (streamTag) {
            // Handle streamed reply
            try {
              // Decrypt the stream metadata
              const decryptedStreamTag = decrypt(
                streamTag[1],
                expertPubkey,
                promptPrivkey
              );

              // Parse the stream metadata event
              const streamMetadataEvent = JSON.parse(
                decryptedStreamTag
              ) as NostrEvent;

              // Parse the stream metadata
              const streamMetadata =
                parseStreamMetadataEvent(streamMetadataEvent);

              // Create stream reader
              const streamReader = await streamFactory.createReader(
                streamMetadata,
                pool
              );

              // According to NIP-174, chunks are just raw data
              // Process each chunk individually and return one reply per chunk
              try {
                // Process each chunk from the stream as it arrives
                for await (const chunk of streamReader) {
                  // Create a Reply object for each chunk
                  // The chunk itself is the content
                  const reply: Reply = {
                    pubkey: expertPubkey,
                    promptId,
                    done: false, // Only the last chunk will have done=true
                    content: chunk,
                    event,
                  };

                  // Yield the reply for each chunk
                  yield reply;
                }

                // After all chunks are processed, yield a final reply with done=true
                // This signals that the stream is complete
                const finalReply: Reply = {
                  pubkey: expertPubkey,
                  promptId,
                  done: true,
                  content: "",
                  event,
                };

                yield finalReply;
              } catch (error) {
                // If the stream reader throws, create an error reply
                throw new ExpertError(
                  `Error reading stream: ${
                    error instanceof Error ? error.message : String(error)
                  }`
                );
              }
            } catch (error) {
              if (error instanceof z.ZodError) {
                throw new ExpertError(
                  `Invalid reply payload: ${error.message}`
                );
              }
              throw error;
            }
          } else {
            // Handle regular reply
            // Decrypt the reply payload
            const decryptedReply = decrypt(
              event.content,
              expertPubkey,
              promptPrivkey
            );

            // Parse directly (no compression in new spec)
            const rawPayload = JSON.parse(decryptedReply);
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
          }
        } catch (error) {
          debugError("Error processing reply event:", error);
          throw error;
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
    const streamSupported =
      params.bid?.stream || params.expert?.stream || false;

    // Determine format and streaming
    // Assume the first supported format, fallback to text
    const format = params.format || supportedFormats[0] || FORMAT_TEXT;

    // Check if format is supported
    if (supportedFormats.length > 0 && !supportedFormats.includes(format)) {
      throw new AskExpertsError(
        `Format ${format} is not supported by the expert`
      );
    }

    // Check its size
    const contentSize = this.getContentSizeBytes(params.content);

    // Size threshold for streaming (48KB)
    const SIZE_THRESHOLD = 48 * 1024;

    // Determine if we need to use streaming based on content size and user preference
    // If content is large, use streaming regardless of params.stream
    // If params.stream is explicitly set, respect that setting
    const needsStreaming = contentSize > SIZE_THRESHOLD;
    const useStreaming =
      params.stream !== undefined
        ? params.stream
        : needsStreaming || streamSupported;

    // Check if streaming is supported when needed
    if (needsStreaming && !streamSupported) {
      throw new AskExpertsError(
        `Content size (${Math.round(
          contentSize / 1024
        )}KB) exceeds the limit (48KB) but streaming is not supported by the expert`
      );
    }

    // Check if streaming is requested but not supported
    if (useStreaming && !streamSupported) {
      throw new AskExpertsError(`Streaming is not supported by the expert`);
    }

    // Generate a random key pair for the prompt
    const { privateKey: promptPrivkey } = generateRandomKeyPair();

    // Send the prompt to the expert
    const prompt = await this.sendPrompt(
      expertPubkey,
      expertRelays,
      params.content,
      format,
      useStreaming,
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
      expertRelays
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
