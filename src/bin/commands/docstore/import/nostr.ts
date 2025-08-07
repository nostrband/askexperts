import { Command } from "commander";
import {
  DocStoreSQLite,
  Doc,
  DocStoreClient,
} from "../../../../docstore/index.js";
import { SimplePool } from "nostr-tools";
import {
  DocstoreCommandOptions,
  getDocstorePath,
  getDocstore,
} from "../index.js";
import { Nostr } from "../../../../experts/utils/Nostr.js";
import {
  debugError,
  debugDocstore,
  enableAllDebug,
} from "../../../../common/debug.js";
import { createRagEmbeddings } from "../../../../rag/index.js";

/**
 * Options for the nostr import command
 */
interface NostrImportOptions extends DocstoreCommandOptions {
  kinds?: string;
  relays?: string;
  limit?: number;
  debug?: boolean;
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
  const docstorePath = getDocstorePath();

  try {
    // Enable debug output if debug flag is set
    if (options.debug) {
      enableAllDebug();
    }

    const docstoreClient: DocStoreClient = new DocStoreSQLite(docstorePath);

    // Get docstore ID
    const docstore = await getDocstore(docstoreClient, options.docstore);

    // Parse kinds if provided
    const kinds = options.kinds
      ? options.kinds.split(",").map((k) => parseInt(k.trim(), 10))
      : [];

    // Parse relays if provided
    const relays = options.relays
      ? options.relays.split(",").map((r) => r.trim())
      : [];

    // Set limit
    const limit = options.limit || 1000;

    debugDocstore(`Importing Nostr events for pubkey: ${author}`);
    debugDocstore(
      `Kinds: ${kinds.length > 0 ? kinds.join(", ") : "Default (1)"}`
    );
    debugDocstore(`Limit: ${limit}`);

    // Create SimplePool and Nostr utility instance
    const pool = new SimplePool();
    const nostr = new Nostr(pool);

    // Crawl events using the Nostr utility class
    const events = await nostr.crawl({
      pubkey: author,
      kinds,
      relays,
      limit,
    });

    // Clean up pool connections
    pool.destroy();

    debugDocstore(`Fetched ${events.length} events. Preparing embeddings...`);

    // Initialize embeddings
    const embeddings = createRagEmbeddings(docstore.model);
    await embeddings.start();

    // Process each event
    let successCount = 0;
    for (const event of events) {
      try {
        // Convert event to text, only take content and text as the
        // rest is probably noise
        const eventText = JSON.stringify([event.content, ...event.tags]);

        // Generate embeddings
        const chunks = await embeddings.embed(eventText);

        // Convert embeddings from number[][] to Float32Array[]
        const float32Embeddings = chunks.map((c) => {
          const float32Array = new Float32Array(c.embedding.length);
          for (let i = 0; i < c.embedding.length; i++) {
            float32Array[i] = c.embedding[i];
          }
          return float32Array;
        });

        // Create document
        const timestamp = Math.floor(Date.now() / 1000);

        const doc: Doc = {
          id: event.id,
          docstore_id: docstore.id,
          timestamp: timestamp,
          created_at: event.created_at,
          type: `nostr:kind:${event.kind}`,
          data: JSON.stringify(event),
          embeddings: float32Embeddings,
        };

        // Add to docstore
        await docstoreClient.upsert(doc);
        successCount++;

        // Log progress
        if (successCount % 10 === 0) {
          debugDocstore(`Processed ${successCount}/${events.length} events`);
        }
      } catch (error) {
        debugError(
          `Error processing event ${event.id}: ${
            error instanceof Error ? error.message : String(error)
          }`
        );
      }
    }

    debugDocstore(`Successfully imported ${successCount} Nostr events`);
    docstoreClient[Symbol.dispose]();
  } catch (error) {
    debugError(
      `Error importing Nostr events: ${
        error instanceof Error ? error.message : String(error)
      }`
    );
    process.exit(1);
  }
}

/**
 * Register the nostr import command
 * @param importCommand - The parent import command
 */
export function registerNostrImportCommand(
  importCommand: Command,
  addCommonOptions: (cmd: Command) => Command
): void {
  const nostrCommand = importCommand
    .command("nostr")
    .description("Import Nostr events from a pubkey")
    .argument("<author>", "Nostr pubkey to import events from")
    .option(
      "-s, --docstore <id>",
      "ID of the docstore (required if more than one docstore exists)"
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

  // Add common options
  addCommonOptions(nostrCommand);
}
