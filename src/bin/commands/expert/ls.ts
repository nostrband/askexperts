import { Command } from "commander";
import { debugError } from "../../../common/debug.js";
import Table from "cli-table3";
import { ExpertCommandOptions, addRemoteOptions } from "./index.js";
import { createDBClientForCommands } from "../utils.js";

/**
 * Options for the ls command
 */
interface LsCommandOptions extends ExpertCommandOptions {
  type?: string;
  search?: string;
}

/**
 * List all experts from the database
 * 
 * @param options Command options
 */
export async function listExperts(options: LsCommandOptions): Promise<void> {
  try {
    // Get expert client based on options
    const db = await createDBClientForCommands(options);
    let experts = await db.listExperts();
    
    // Filter by type if specified
    if (options.type) {
      experts = experts.filter(expert =>
        expert.type.toLowerCase() === options.type!.toLowerCase()
      );
    }
    
    // Filter by search query if specified
    if (options.search) {
      const searchLower = options.search.toLowerCase();
      experts = experts.filter(expert => {
        // Search in nickname, pubkey, docstores, and env
        return (
          expert.nickname.toLowerCase().includes(searchLower) ||
          expert.pubkey.toLowerCase().includes(searchLower) ||
          expert.docstores.toLowerCase().includes(searchLower) ||
          expert.env.toLowerCase().includes(searchLower)
        );
      });
    }
    
    console.log(`Found ${experts.length} experts in the database.`);
    
    if (experts.length === 0) {
      console.log("No experts found in the database.");
      return;
    }
    
    // Create a table for display
    const table = new Table({
      head: ['Pubkey', 'Nickname', 'Type', 'Other'],
      colWidths: [66, 30, 15, 60],
      wordWrap: true,
      wrapOnWordBoundary: false,
    });
    
    // Add rows to the table
    for (const expert of experts) {
      // Combine docstores and env for the "other" field
      const docstores = expert.docstores ? `Docstores: ${expert.docstores}\n` : '';
      const env = expert.env ? `Env: ${expert.env}\n` : '';
      const other = [docstores, env].filter(Boolean).join(' ');
      
      // Truncate other if too long
      const otherDisplay = other.length > 200 
        ? other.substring(0, 197) + '...' 
        : other;
      
      table.push([
        expert.pubkey,
        expert.nickname,
        expert.type,
        otherDisplay
      ]);
    }
    
    // Display the table
    console.log(table.toString());
    
  } catch (error) {
    debugError("Error listing experts:", error);
    throw error;
  }
}

/**
 * Register the ls command with the expert command group
 * 
 * @param program The commander program or parent command
 */
export function registerLsCommand(program: Command): void {
  const command = program
    .command("ls")
    .description("List experts from the database")
    .option("-t, --type <type>", "Filter experts by type (e.g., nostr, openai)")
    .option("-s, --search <query>", "Search in nickname, pubkey, docstores, and env fields")
    .action(async (options: LsCommandOptions) => {
      try {
        await listExperts(options);
      } catch (error) {
        console.error("Error listing experts:", error);
        process.exit(1);
      }
    });
  
  // Add remote options
  addRemoteOptions(command);
}