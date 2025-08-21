import { SimplePool, Event, Filter } from "nostr-tools";
import { fetchFromRelays } from "../../common/relay.js";
import { debugError, debugExpert } from "../../common/debug.js";
import { Expert, PromptFormat, PaymentMethod } from "../../common/types.js";

/**
 * Parse an expert profile event into an Expert object
 *
 * @param event - The expert profile event to parse
 * @returns Expert object or null if invalid
 */
export function parseExpertProfile(event: Event): Expert | null {
  try {
    // Extract relay URLs from the tags
    const relayTags = event.tags.filter((tag) => tag[0] === "relay");
    const expertRelays = relayTags.map((tag) => tag[1]);

    if (expertRelays.length === 0) {
      debugError("Expert profile event missing relay tags:", event);
      return null;
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
    const expertMethods = methodTags.map((tag) => tag[1]) as PaymentMethod[];

    // Extract hashtags from the tags
    const hashtagTags = event.tags.filter((tag) => tag[0] === "t");
    const expertHashtags = hashtagTags.map((tag) => tag[1]);

    // Extract name from the tags
    const nameTag = event.tags.find((tag) => tag[0] === "name");
    const name = nameTag ? nameTag[1] : undefined;

    // Extract picture from the tags
    const pictureTag = event.tags.find((tag) => tag[0] === "picture");
    const picture = pictureTag ? pictureTag[1] : undefined;

    // Create an Expert object
    const expert: Expert = {
      pubkey: event.pubkey,
      name,
      picture,
      description: event.content,
      relays: expertRelays,
      formats: expertFormats,
      stream: expertStreamSupported,
      methods: expertMethods,
      hashtags: expertHashtags,
      event,
    };

    return expert;
  } catch (error) {
    debugError("Error processing expert profile event:", error);
    return null;
  }
}

/**
 * Interface for a post with optional reply context
 */
export interface PostWithContext {
  /** Post ID (event.id) */
  id: string;

  /** Post creation timestamp */
  created_at: number;

  /** Post content */
  content: string;

  /** Public key of the author */
  pubkey: string;

  /** Optional reply context */
  in_reply_to?: {
    /** Parent post creation timestamp */
    created_at: number;

    /** Parent post content */
    content: string;

    /** Public key of the parent post author */
    pubkey: string;
  };
}

/**
 * Interface for profile information returned by crawlProfile
 */
export interface ProfileInfo {
  pubkey: string;

  /** Profile data (kind:0 event content) */
  profile?: any;

  /** Nostr event */
  event?: Event;
}

/**
 * Nostr utility class for fetching and processing Nostr data
 */
export class Nostr {
  /** SimplePool instance for Nostr relay connections */
  private pool: SimplePool;

  /** Default outbox relays to check for user data */
  public static readonly OUTBOX_RELAYS = [
    "wss://purplepag.es",
    "wss://relay.nostr.band",
    "wss://relay.primal.net",
    "wss://user.kindpag.es",
    "wss://relay.nos.social",
  ];

  /**
   * Creates a new Nostr utility instance
   *
   * @param pool - SimplePool instance for Nostr relay connections
   */
  constructor(pool: SimplePool) {
    this.pool = pool;
  }

  /**
   * Crawls a user's profile
   *
   * @param pubkey - Public key of the user
   * @returns Promise resolving to ProfileInfo
   */
  async fetchProfile(pubkey: string, relays?: string[]): Promise<ProfileInfo> {
    try {
      if (!relays || !relays.length) {
        // 1. Fetch kind:10002 event (relay list) from outbox relays
        const relayListFilter: Filter = {
          kinds: [10002],
          authors: [pubkey],
          limit: 1,
        };

        const relayListEvents = await fetchFromRelays(
          relayListFilter,
          Nostr.OUTBOX_RELAYS,
          this.pool,
          10000 // 10 second timeout
        );

        // Parse relay list into read and write relays
        const { readRelays, writeRelays } = this.parseRelayList(
          relayListEvents[0]
        );

        // If no relay list found, use outbox relays for both read and write
        const effectiveReadRelays =
          readRelays.length > 0 ? readRelays : Nostr.OUTBOX_RELAYS;
        const effectiveWriteRelays =
          writeRelays.length > 0 ? writeRelays : Nostr.OUTBOX_RELAYS;
        debugExpert(`Fetched relays for ${pubkey}: ${effectiveWriteRelays}`);

        relays = effectiveWriteRelays;
      }

      // 2. Fetch kind:0 (profile) from outbox relays
      const profileFilter: Filter = {
        kinds: [0],
        authors: [pubkey],
        limit: 1,
      };

      const profileEvents = await fetchFromRelays(
        profileFilter,
        [...Nostr.OUTBOX_RELAYS, ...relays],
        this.pool,
        10000 // 10 second timeout
      );

      // Parse profile data
      const profile =
        profileEvents.length > 0
          ? JSON.parse(profileEvents[0].content)
          : undefined;
      debugExpert(`Fetched profile for ${pubkey}: ${JSON.stringify(profile)}`);

      return {
        pubkey,
        profile,
        event: profileEvents?.[0],
      };
    } catch (error) {
      debugError("Error crawling profile:", error);
      throw error;
    }
  }

  /**
   * Parses a kind:10002 relay list event into read and write relays
   *
   * @param event - The relay list event
   * @returns Object containing read and write relay arrays
   */
  private parseRelayList(event?: Event): {
    readRelays: string[];
    writeRelays: string[];
  } {
    const readRelaysSet = new Set<string>();
    const writeRelaysSet = new Set<string>();

    if (!event) {
      return { readRelays: [], writeRelays: [] };
    }

    // Process each 'r' tag in the event
    for (const tag of event.tags) {
      if (tag[0] === "r") {
        const relayUrl = tag[1];
        const permission = tag[2]; // 'read', 'write', or undefined (which means both)

        if (!relayUrl) continue;

        // Validate the relay URL
        try {
          const url = new URL(relayUrl);

          // Check if it's a valid relay URL
          if (url.protocol !== "wss:") continue;

          // Check if it's not a localhost or .onion address
          const hostname = url.hostname;
          if (
            hostname === "localhost" ||
            hostname === "127.0.0.1" ||
            hostname.endsWith(".onion")
          ) {
            continue;
          }

          // Add to appropriate sets (deduplicates automatically)
          if (!permission || permission === "read") {
            readRelaysSet.add(relayUrl);
          }

          if (!permission || permission === "write") {
            writeRelaysSet.add(relayUrl);
          }
        } catch (error) {
          // Skip invalid URLs
          continue;
        }
      }
    }

    // Convert sets to arrays
    return {
      readRelays: Array.from(readRelaysSet),
      writeRelays: Array.from(writeRelaysSet),
    };
  }

  /**
   * Crawls Nostr events for a specific pubkey and kinds
   *
   * @param pubkey - Public key of the user
   * @param kinds - Array of event kinds to fetch (default: [1] for notes)
   * @param relays - Array of relay URLs to fetch from (default: auto-detect from user's kind:10002)
   * @param limit - Maximum number of events to fetch (default: 1000)
   * @returns Promise resolving to an array of events
   */
  async crawl({
    pubkey,
    kinds = [],
    relays = [],
    limit = 1000,
  }: {
    pubkey: string;
    kinds?: number[];
    relays?: string[];
    limit?: number;
  }): Promise<Event[]> {
    let writeRelays: string[] = [...relays];

    // If no relays provided, load pubkey's 10002 event to get their relays
    if (relays.length === 0) {
      try {
        // Fetch relay list event (kind 10002)
        const relayListFilter: Filter = {
          kinds: [10002],
          authors: [pubkey],
          limit: 1,
        };

        const relayListEvents = await fetchFromRelays(
          relayListFilter,
          Nostr.OUTBOX_RELAYS,
          this.pool,
          10000 // 10 second timeout
        );

        if (relayListEvents.length > 0) {
          // Parse relay list
          const { writeRelays: parsedWriteRelays } = this.parseRelayList(
            relayListEvents[0]
          );
          if (parsedWriteRelays.length > 0) {
            writeRelays = parsedWriteRelays;
          }
        }
      } catch (error) {
        debugError("Error fetching relay list:", error);
      }

      // If still no relays, use default outbox relays
      if (writeRelays.length === 0) {
        writeRelays = Nostr.OUTBOX_RELAYS;
      }
    }

    debugExpert(`Using relays: ${writeRelays.join(", ")}`);

    // Fetch events of specified kinds
    const events: Event[] = [];
    let oldestTimestamp: number | undefined;

    // Continue fetching until we reach the limit or no more events are available
    while (events.length < limit) {
      // Create filter for the current batch
      const filter: Filter = {
        authors: [pubkey],
        limit: Math.min(500, limit - events.length),
      };
      if (kinds && kinds.length > 0) filter.kinds = kinds;

      // Add until parameter for pagination if we have an oldest timestamp
      if (oldestTimestamp) {
        filter.until = oldestTimestamp - 1; // Subtract 1 to avoid duplicates
      }

      // Fetch the current batch
      const batchEvents = await fetchFromRelays(
        filter,
        writeRelays,
        this.pool,
        10000 // 10 second timeout
      );
      debugExpert(`Fetched ${batchEvents.length} events`);

      // If no more events were found, break the loop
      if (batchEvents.length === 0) {
        break;
      }

      // Add the new events to our collection
      events.push(...batchEvents);

      // Find the oldest timestamp for the next iteration
      oldestTimestamp = Math.min(
        ...batchEvents.map((event: Event) => event.created_at)
      );
    }

    // Trim to the requested limit and sort by created_at in descending order
    const finalEvents = events.slice(0, limit);
    finalEvents.sort((a, b) => b.created_at - a.created_at);

    return finalEvents;
  }
}
