import { Command } from "commander";
import {
  Doc,
  DocStoreClient,
} from "../../../../docstore/index.js";
import { SimplePool } from "nostr-tools";
import {
  DocstoreCommandOptions,
  getDocstore,
  createDocstoreClient,
} from "../index.js";
import { Nostr } from "../../../../experts/utils/Nostr.js";
import {
  debugError,
  debugDocstore,
  enableAllDebug,
} from "../../../../common/debug.js";
import { createRagEmbeddings } from "../../../../rag/index.js";
import { createDocImporter } from "../../../../import/index.js";

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
  try {
    // Enable debug output if debug flag is set
    if (options.debug) {
      enableAllDebug();
    }

    const docstoreClient: DocStoreClient = await createDocstoreClient(options);

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

    // Get markdown importer
    const importer = await createDocImporter("nostr");

    // Process each event
    let successCount = 0;
    for (const event of events) {
      try {

        // Convert to doc
        let doc = await importer.createDoc(event);
        doc.docstore_id = docstore.id;

        // Generate embeddings and update doc with embeddings and embedding_offsets
        doc = await embeddings.embedDoc(doc);

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
      "--relays <relays>",
      "Comma-separated list of relays to fetch from"
    )
    .option(
      "-l, --limit <limit>",
      "Maximum number of events to import (default: 1000)",
      (value) => parseInt(value, 10)
    )
    .action(importNostr);

  addCommonOptions(nostrCommand);
}
