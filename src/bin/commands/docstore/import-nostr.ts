import { Command } from "commander";
import { DocStoreSQLite, Doc } from "../../../docstore/index.js";
import { XenovaEmbeddings } from "../../../rag/index.js";
import { SimplePool, Event, Filter } from "nostr-tools";
import { DocstoreCommandOptions, getDocstorePath, getDocstoreId } from "./index.js";
import { Nostr } from "../../../experts/utils/Nostr.js";
import { fetchFromRelays } from "../../../common/relay.js";
import { debugError, debugDocstore } from "../../../common/debug.js";

/**
 * Options for the nostr import command
 */
interface NostrImportOptions extends DocstoreCommandOptions {
  kinds?: string;
  relays?: string;
  limit?: number;
}

/**
 * Import Nostr events into a docstore
 * @param author - Nostr pubkey to import events from
 * @param options - Command options
 */
export async function importNostr(
  author: string,
  options: NostrImportOptions
): Promise<void> {
  const docstorePath = getDocstorePath(options);

  try {
    const docstore = new DocStoreSQLite(docstorePath);
    const docstores = docstore.listDocstores();

    // Get docstore ID
    let docstoreId: string;
    try {
      const result = await getDocstoreId(docstore, options);
      docstoreId = result.docstoreId;
    } catch (error) {
      debugError(`Error: ${error instanceof Error ? error.message : String(error)}`);
      docstore[Symbol.dispose]();
      process.exit(1);
    }

    // Parse kinds if provided
    const kinds = options.kinds
      ? options.kinds.split(',').map(k => parseInt(k.trim(), 10))
      : [];

    // Parse relays if provided
    const relays = options.relays
      ? options.relays.split(',').map(r => r.trim())
      : [];

    // Set limit
    const limit = options.limit || 1000;

    debugDocstore(`Importing Nostr events for pubkey: ${author}`);
    debugDocstore(`Kinds: ${kinds.length > 0 ? kinds.join(', ') : 'Default (1)'}`);
    debugDocstore(`Limit: ${limit}`);

    // Create SimplePool and Nostr utility instance
    const pool = new SimplePool();
    const nostr = new Nostr(pool);

    // Crawl events using the Nostr utility class
    const events = await nostr.crawl({
      pubkey: author,
      kinds,
      relays,
      limit
    });

    // Clean up pool connections
    pool.destroy();

    debugDocstore(`Fetched ${events.length} events. Preparing embeddings...`);

    // Initialize embeddings
    const embeddings = new XenovaEmbeddings();
    await embeddings.start();

    // Process each event
    let successCount = 0;
    for (const event of events) {
      try {
        // Convert event to text, only take content and text as the 
        // rest is probably noise
        const eventText = JSON.stringify([
          event.content, ...event.tags
        ]);

        // Generate embeddings
        const chunks = await embeddings.embed(eventText);

        // Create document
        const timestamp = Math.floor(Date.now() / 1000);

        const doc: Doc = {
          id: event.id,
          docstore_id: docstoreId,
          timestamp: timestamp,
          created_at: event.created_at,
          type: `nostr:kind:${event.kind}`,
          data: JSON.stringify(event),
          embeddings: JSON.stringify(chunks.map(c => c.embedding)),
        };

        // Add to docstore
        docstore.upsert(doc);
        successCount++;

        // Log progress
        if (successCount % 10 === 0) {
          debugDocstore(`Processed ${successCount}/${events.length} events`);
        }
      } catch (error) {
        debugError(`Error processing event ${event.id}: ${error instanceof Error ? error.message : String(error)}`);
      }
    }

    debugDocstore(`Successfully imported ${successCount} Nostr events`);
    docstore[Symbol.dispose]();
  } catch (error) {
    debugError(`Error importing Nostr events: ${error instanceof Error ? error.message : String(error)}`);
    process.exit(1);
  }
}

/**
 * Register the nostr import command
 * @param importCommand - The parent import command
 */
export function registerNostrImportCommand(importCommand: Command): void {
  const nostrCommand = importCommand
    .command("nostr")
    .description("Import Nostr events from a pubkey")
    .argument("<author>", "Nostr pubkey to import events from")
    .option(
      "-s, --docstore <id>",
      "ID of the docstore (required if more than one docstore exists)"
    )
    .option(
      "-d, --debug",
      "Enable debug output"
    )
    .option(
      "-k, --kinds <kinds>",
      "Comma-separated list of event kinds to import"
    )
    .option(
      "-r, --relays <relays>",
      "Comma-separated list of relays to fetch from"
    )
    .option(
      "-l, --limit <limit>",
      "Maximum number of events to import (default: 1000)",
      (value) => parseInt(value, 10)
    )
    .action(importNostr);
}