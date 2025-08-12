import { Command } from "commander";
import { debugError, enableAllDebug, enableErrorDebug } from "../../../common/debug.js";
import { getWalletByNameOrDefault } from "../../commands/wallet/utils.js";
import { getExpertClient } from "../../../experts/ExpertRemoteClient.js";

/**
 * Options for the update expert command
 */
interface UpdateExpertCommandOptions {
  wallet?: string;
  env?: string[];
  docstores?: string[];
  type?: string;
  nickname?: string;
  debug?: boolean;
}

/**
 * Update an existing expert in the database
 * 
 * @param pubkey Public key of the expert to update
 * @param options Command options
 */
export async function updateExpert(
  pubkey: string,
  options: UpdateExpertCommandOptions
): Promise<void> {
  try {
    if (options.debug) enableAllDebug();
    else enableErrorDebug();

    // Get expert client
    const expertClient = getExpertClient();
    
    // Get the expert
    const expert = await expertClient.getExpert(pubkey);
    if (!expert) {
      throw new Error(`Expert with pubkey ${pubkey} not found`);
    }

    // Track if any changes were made
    let changes = false;

    // Update wallet if specified
    if (options.wallet) {
      const wallet = getWalletByNameOrDefault(options.wallet);
      expert.wallet_id = wallet.id;
      changes = true;
    }

    // Update type if specified
    if (options.type) {
      // Validate type
      if (options.type !== "nostr" && options.type !== "openai") {
        throw new Error('Type must be either "nostr" or "openai"');
      }
      expert.type = options.type;
      changes = true;
    }

    // Update nickname if specified
    if (options.nickname) {
      expert.nickname = options.nickname;
      changes = true;
    }

    // Update environment variables if specified
    if (options.env) {
      expert.env = options.env.join("\n");
      changes = true;
    }

    // Update docstores if specified
    if (options.docstores) {
      expert.docstores = options.docstores.join(",");
      changes = true;
    }

    // Only update if changes were made
    if (!changes) {
      console.log("No changes specified. Expert not updated.");
      return;
    }

    // Update expert in database
    const success = await expertClient.updateExpert(expert);
    if (!success) {
      throw new Error("Failed to update expert in database");
    }

    console.log(`Expert updated successfully:`);
    console.log(`  Pubkey: ${expert.pubkey}`);
    console.log(`  Type: ${expert.type}`);
    console.log(`  Nickname: ${expert.nickname}`);
    console.log(`  Wallet ID: ${expert.wallet_id}`);
    if (expert.env) console.log(`  Environment Variables: ${expert.env.replace(/\n/g, ", ")}`);
    if (expert.docstores) console.log(`  Docstores: ${expert.docstores}`);

  } catch (error) {
    debugError("Error updating expert:", error);
    throw error;
  }
}

/**
 * Register the update expert command with the CLI
 *
 * @param program The commander program or parent command
 */
export function registerUpdateCommand(program: Command): void {
  program
    .command("update")
    .description("Update an existing expert in the database")
    .argument("<pubkey>", "Public key of the expert to update")
    .option("-w, --wallet <name>", "Wallet name to use")
    .option("-t, --type <type>", "Type of expert (nostr or openai)")
    .option("-n, --nickname <name>", "Nickname for the expert")
    .option("-e, --env <key:value...>", "Environment variables in key:value format")
    .option("-s, --docstores <id...>", "Docstore IDs to use")
    .option("-d, --debug", "Enable debug logging")
    .action(async (pubkey, options: UpdateExpertCommandOptions) => {
      try {
        await updateExpert(pubkey, options);
      } catch (error) {
        debugError("Error updating expert:", error);
        process.exit(1);
      }
    });
}