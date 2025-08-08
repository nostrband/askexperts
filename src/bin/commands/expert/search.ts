import { Command } from "commander";
import { SimplePool } from "nostr-tools";
import { EVENT_KIND_EXPERT_PROFILE, SEARCH_RELAYS } from "../../../common/constants.js";
import { fetchFromRelays } from "../../../common/relay.js";
import { Expert } from "../../../common/types.js";
import { debugError } from "../../../common/debug.js";
import { parseExpertProfile } from "../../../experts/utils/Nostr.js";
import Table from "cli-table3";

interface SearchCommandOptions {
  relays?: string;
  search?: string;
  tags?: string;
}

/**
 * Search expert profiles from specified relays
 * 
 * @param options Command options
 */
export async function searchExperts(options: SearchCommandOptions): Promise<void> {
  try {
    // Parse relays from comma-separated string or use default
    const relays = options.relays 
      ? options.relays.split(',') 
      : SEARCH_RELAYS;
    
    // Parse tags if provided
    const tags = options.tags ? options.tags.split(',') : [];
    
    // Create a pool for relay operations
    const pool = new SimplePool();
    
    // Create a filter for expert profile events
    const filter: any = {
      kinds: [EVENT_KIND_EXPERT_PROFILE],
      limit: 1000,
    };
    
    // Add tag filter if tags are specified
    if (tags.length > 0) {
      filter["#t"] = tags;
    }
    
    // Add search filter if search is specified
    if (options.search) {
      filter.search = options.search;
    }
    
    console.log(`Fetching expert profiles from ${relays.join(', ')}...`);
    
    // Fetch expert profile events
    const events = await fetchFromRelays(
      filter,
      relays,
      pool,
      5000
    );
    
    console.log(`Found ${events.length} expert profiles.`);
    
    if (events.length === 0) {
      console.log("No expert profiles found.");
      pool.destroy();
      return;
    }
    
    // Process events into Expert objects
    const experts: Expert[] = [];
    const seenPubkeys = new Set<string>();
    
    for (const event of events) {
      // Only take the newest event for each pubkey
      if (seenPubkeys.has(event.pubkey)) {
        continue;
      }
      
      const expert = parseExpertProfile(event);
      if (expert) {
        experts.push(expert);
        seenPubkeys.add(event.pubkey);
      }
    }
    
    // Create a table for display
    const table = new Table({
      head: ['Pubkey', 'Name', 'Description'],
      colWidths: [66, 30, 60],
      wordWrap: true,
      wrapOnWordBoundary: false,
    });
    
    // Add rows to the table
    for (const expert of experts) {
      const pubkeyShort = expert.pubkey;
      const name = expert.name || '<Unnamed>';
      // Truncate description if too long
      const description = expert.description.length > 200 
        ? expert.description.substring(0, 197) + '...' 
        : expert.description;
      
      table.push([pubkeyShort, name, description]);
    }
    
    // Display the table
    console.log(table.toString());
    
    // Clean up
    pool.destroy();
    
  } catch (error) {
    debugError("Error searching experts:", error);
    throw error;
  }
}

/**
 * Register the search command with the expert command group
 * 
 * @param program The commander program or parent command
 */
export function registerSearchCommand(program: Command): void {
  program
    .command("search")
    .description("Search expert profiles from relays")
    .option("-r, --relays <urls>", "Comma-separated list of relay URLs")
    .option("-s, --search <query>", "Search query for filtering experts")
    .option("-t, --tags <tags>", "Comma-separated list of tags to filter by")
    .action(async (options: SearchCommandOptions) => {
      try {
        await searchExperts(options);
      } catch (error) {
        console.error("Error searching experts:", error);
        process.exit(1);
      }
    });
}