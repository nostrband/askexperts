/**
 * Nostr event importer
 */

import { Event, validateEvent, verifyEvent } from "nostr-tools";
import { Doc } from "../docstore/interfaces.js";
import { DocImporter } from "./index.js";

/**
 * Importer for Nostr events
 * Converts Nostr events to Doc objects
 */
export class NostrImporter implements DocImporter {

  private encoder = new TextEncoder();

  /**
   * Create a Doc object from a Nostr event
   * @param data - Nostr event
   * @returns Promise resolving to a Doc object
   * @throws Error if the input is not a valid Nostr event
   */
  async createDoc(data: any): Promise<Doc> {
    // Validate that the input is a Nostr event
    if (!validateEvent(data) || !verifyEvent(data)) {
      throw new Error("Invalid Nostr event");
    }

    const event = data as Event;
    
    // Create timestamp (current time in seconds)
    const timestamp = Math.floor(Date.now() / 1000);

    // Prepare text content
    const eventMarkdown = `${event.content}`;

    // Format metadata
    const hashtags = event.tags.filter(t => t.length > 1 && t[0] === 't').map(t => t[1]);
    const metadata = `
id: ${event.id}
hashtags: ${hashtags.join(',')}
created_at: ${new Date(event.created_at * 1000).toUTCString()}
author: ${event.pubkey}
`;

    // Create Doc object
    const doc: Doc = {
      id: event.id,
      docstore_id: "", 
      timestamp: timestamp,
      created_at: event.created_at,
      type: `nostr`,
      data: eventMarkdown,
      file: this.encoder.encode(JSON.stringify(event)),
      metadata,
      embeddings: [],
    };

    return doc;
  }
}