import { Command } from "commander";
import { AskExpertsSmartClient } from "../../client/index.js";
import { FORMAT_TEXT } from "../../common/constants.js";
import { debugMCP, debugError, enableAllDebug, enableErrorDebug } from '../../common/debug.js';
import { getWalletByNameOrDefault } from "./wallet/utils.js";

/**
 * Options for the client command
 */
export interface ClientCommandOptions {
  wallet?: string;
  relays?: string[];
  openaiApiKey?: string;
  openaiBaseUrl?: string;
  maxAmount?: string;
  requirements?: string;
  debug?: boolean;
}

/**
 * Execute the client command with the given options and question
 * 
 * @param question The question to ask experts
 * @param options Command line options
 */
export async function executeClientCommand(question: string, options: ClientCommandOptions): Promise<void> {
  // Get wallet from database using the provided wallet name or default
  const wallet = await getWalletByNameOrDefault(options.wallet);
  const nwcString = wallet.nwc;
  
  // Try to get OpenAI API key from options or environment variables
  const openaiApiKey = options.openaiApiKey || process.env.OPENAI_API_KEY;
  
  // Validate OpenAI API key
  if (!openaiApiKey) {
    throw new Error('OpenAI API key is required. Use --openai-api-key option or set OPENAI_API_KEY environment variable.');
  }
  
  // Try to get OpenAI base URL from options or environment variables
  const openaiBaseUrl = options.openaiBaseUrl || process.env.OPENAI_BASE_URL || 'https://api.openai.com/v1';
  
  // Try to get discovery relays from options or environment variables
  let discoveryRelays: string[] | undefined = options.relays;
  if (!discoveryRelays && process.env.DISCOVERY_RELAYS) {
    discoveryRelays = process.env.DISCOVERY_RELAYS.split(',').map(relay => relay.trim());
  }

  // Parse max amount
  const maxAmountSats = options.maxAmount ? parseInt(options.maxAmount, 10) : 100;
  if (isNaN(maxAmountSats) || maxAmountSats <= 0) {
    throw new Error('Maximum amount must be a positive number.');
  }

  try {
    // Create the Smart Client
    const client = new AskExpertsSmartClient(
      nwcString,
      openaiApiKey,
      openaiBaseUrl,
      discoveryRelays
    );
    
    debugMCP('Asking experts...');
    
    // Ask experts and get replies
    const replies = await client.askExperts(question, maxAmountSats, options.requirements);
    
    // Print the results
    console.log(JSON.stringify(replies, null, 2));
    
    // Dispose of the client resources
    if (typeof client[Symbol.dispose] === 'function') {
      client[Symbol.dispose]();
    }
    
  } catch (error) {
    debugError('Failed to execute client command:', error);
    throw error;
  }
}

/**
 * Helper function to parse comma-separated lists
 * @param value The comma-separated string
 * @returns Array of trimmed strings
 */
function commaSeparatedList(value: string): string[] {
  return value.split(",").map((item) => item.trim());
}

/**
 * Register the client command with the CLI
 *
 * @param program The commander program
 */
export function registerClientCommand(program: Command): void {
  program
    .command("client")
    .description("Ask experts a question using the AskExpertsSmartClient")
    .argument("<question>", "The question to ask experts")
    .option("-w, --wallet <name>", "Wallet name to use for payments (uses default if not specified)")
    .option(
      "-r, --relays <items>",
      "Comma-separated list of discovery relays",
      commaSeparatedList
    )
    .option(
      "-k, --openai-api-key <string>",
      "OpenAI API key"
    )
    .option(
      "-u, --openai-base-url <string>",
      "OpenAI base URL"
    )
    .option(
      "-m, --max-amount <number>",
      "Maximum amount to pay in satoshis",
      "100"
    )
    .option(
      "-q, --requirements <string>",
      "Additional requirements for the experts that should be selected"
    )
    .option("-d, --debug", "Enable debug logging")
    .action(async (question, options) => {
      if (options.debug) enableAllDebug();
      else enableErrorDebug();
      try {
        await executeClientCommand(question, options);
      } catch (error) {
        debugError("Error executing client command:", error);
        process.exit(1);
      }
    });
}