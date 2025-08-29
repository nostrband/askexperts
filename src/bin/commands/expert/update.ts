import { Command } from "commander";
import { debugError, enableAllDebug, enableErrorDebug } from "../../../common/debug.js";
import { getWalletByNameOrDefault } from "../../commands/wallet/utils.js";
import { ExpertCommandOptions, addRemoteOptions } from "./index.js";
import { createDBClientForCommands } from "../utils.js";

/**
 * Options for the update expert command
 */
interface UpdateExpertCommandOptions extends ExpertCommandOptions {
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
    const db = await createDBClientForCommands(options);
    
    // Get the expert
    const expert = await db.getExpert(pubkey);
    if (!expert) {
      throw new Error(`Expert with pubkey ${pubkey} not found`);
    }

    // Track if any changes were made
    let changes = false;

    // Update wallet if specified
    if (options.wallet) {
      const wallet = await getWalletByNameOrDefault(db, options.wallet);
      expert.wallet_id = wallet.id;
      changes = true;
    }

    // Update type if specified
    if (options.type) {
      // Validate type
      if (options.type !== "rag" && options.type !== "openai" && options.type !== "system_prompt" && options.type !== "openrouter") {
        throw new Error('Type must be either "rag", "openai", "openrouter", or "system_prompt"');
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
    const success = await db.updateExpert(expert);
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
  const command = program
    .command("update")
    .description("Update an existing expert in the database")
    .argument("<pubkey>", "Public key of the expert to update")
    .option("-w, --wallet <name>", "Wallet name to use")
    .option("-t, --type <type>", "Type of expert (rag, openai, openrouter, or system_prompt)")
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
    
  // Add remote options
  addRemoteOptions(command);
}