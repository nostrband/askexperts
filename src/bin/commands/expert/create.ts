import { Command } from "commander";
import { DBExpert } from "../../../db/interfaces.js";
import { generateRandomKeyPair } from "../../../common/crypto.js";
import { getPublicKey } from "nostr-tools";
import { bytesToHex } from "nostr-tools/utils";
import {
  debugError,
  enableAllDebug,
  enableErrorDebug,
} from "../../../common/debug.js";
import { getWalletByNameOrDefault } from "../../commands/wallet/utils.js";
import { ExpertCommandOptions, addRemoteOptions } from "./index.js";
import { getCurrentUserId } from "../../../common/users.js";
import { createDBClientForCommands } from "../utils.js";
import { Prompts } from "../../../experts/Prompts.js";

/**
 * Options for the create expert command
 */
interface CreateExpertCommandOptions extends ExpertCommandOptions {
  wallet?: string;
  env?: string[];
  docstores?: string[];
  privkey_hex?: string;
  debug?: boolean;
  description?: string;
  picture?: string;
  hashtags?: string;
  model?: string;
  temperature?: string;
  system_prompt?: string;
  discovery_hashtags?: string;
  discovery_relays?: string;
  prompt_relays?: string;
  price_base?: number;
  price_margin?: string;
}

/**
 * Register the create expert command with the CLI
 *
 * @param program The commander program or parent command
 * @param db The database instance
 */
/**
 * Create a new expert in the database
 *
 * @param type Type of expert (rag or openrouter)
 * @param nickname Nickname for the expert
 * @param options Command options
 */
export async function createExpert(
  type: string,
  nickname: string,
  options: CreateExpertCommandOptions
): Promise<void> {
  try {
    if (options.debug) enableAllDebug();
    else enableErrorDebug();

    // Validate type
    if (type !== "rag" && type !== "openrouter" && type !== "system_prompt") {
      throw new Error('Type must be either "rag", "openrouter", or "system_prompt"');
    }

    const db = await createDBClientForCommands(options);

    // Get wallet ID using the utility function
    const wallet = await getWalletByNameOrDefault(db, options.wallet);
    const walletId = wallet.id;

    // Generate or use provided private key
    let privkey: Uint8Array;
    let pubkey: string;

    if (options.privkey_hex) {
      try {
        privkey = new Uint8Array(Buffer.from(options.privkey_hex, "hex"));
        pubkey = getPublicKey(privkey);
      } catch (error) {
        throw new Error(`Invalid private key: ${error}`);
      }
    } else {
      const { privateKey, publicKey } = generateRandomKeyPair();
      privkey = privateKey;
      pubkey = publicKey;
    }

    // Format environment variables
    const envStr = options.env ? options.env.join("\n") : "";

    // Format docstores
    const docstoresStr = options.docstores ? options.docstores.join(",") : "";

    // Create expert object
    const expert: DBExpert = {
      user_id: getCurrentUserId(),
      pubkey,
      wallet_id: walletId,
      type,
      nickname,
      env: envStr,
      docstores: docstoresStr,
      privkey: bytesToHex(privkey),
      description: options.description || "",
      discovery_hashtags: options.discovery_hashtags || "",
      discovery_relays: options.discovery_relays || "",
      hashtags: options.hashtags || "",
      model: options.model || "",
      picture: options.picture || "",
      prompt_relays: options.prompt_relays || "",
      temperature: options.temperature || "",
      price_base: options.price_base || 0,
      price_margin: options.price_margin || "",
    };

    if (options.system_prompt === "nostr") {
      expert.system_prompt = Prompts.nostrCloneSystemPrompt();
    } else {
      expert.system_prompt = options.system_prompt;
    }

    // Insert expert into database
    const success = await db.insertExpert(expert);
    if (!success) {
      throw new Error("Failed to insert expert into database");
    }

    console.log(`Expert created successfully:`);
    console.log(`  Type: ${type}`);
    console.log(`  Nickname: ${nickname}`);
    console.log(`  Public Key: ${pubkey}`);
    console.log(`  Private Key: ${bytesToHex(privkey)}`);
    console.log(`  Wallet ID: ${walletId}`);
    if (envStr)
      console.log(`  Environment Variables: ${envStr.replace(/\n/g, ", ")}`);
    if (docstoresStr) console.log(`  Docstores: ${docstoresStr}`);
  } catch (error) {
    debugError("Error creating expert:", error);
    throw error;
  }
}

/**
 * Register the create expert command with the CLI
 *
 * @param program The commander program or parent command
 */
export function registerCreateCommand(program: Command): void {
  const command = program
    .command("create")
    .description("Create a new expert in the database")
    .argument("<type>", "Type of expert (rag, openrouter, or system_prompt)")
    .argument("<nickname>", "Nickname for the expert")
    .option(
      "-w, --wallet <name>",
      "Wallet name to use (uses default if not provided)"
    )
    .option(
      "-e, --env <key:value...>",
      "Environment variables in key:value format"
    )
    .option("-s, --docstores <id...>", "Docstore IDs to use")
    .option(
      "-p, --privkey_hex <hex>",
      "Expert private key in hex format (generates one if not provided)"
    )
    .option("-d, --debug", "Enable debug logging")
    .option("--description <text>", "Description of the expert")
    .option("--picture <url>", "URL to the expert's picture")
    .option("--hashtags <tags>", "Comma-separated hashtags for the expert")
    .option("--model <name>", "Model name for the expert")
    .option("--temperature <value>", "Temperature setting for the expert")
    .option(
      "--system_prompt <text>",
      'System prompt for the expert, or template "nostr"'
    )
    .option("--discovery_hashtags <tags>", "Comma-separated discovery hashtags")
    .option("--discovery_relays <urls>", "Comma-separated discovery relay URLs")
    .option("--prompt_relays <urls>", "Comma-separated prompt relay URLs")
    .option("--price_base <number>", "Base price for the expert (default: 0)")
    .option("--price_margin <text>", "Price margin for the expert")
    .action(async (type, nickname, options: CreateExpertCommandOptions) => {
      try {
        await createExpert(type, nickname, options);
      } catch (error) {
        debugError("Error creating expert:", error);
        process.exit(1);
      }
    });

  // Add remote options
  addRemoteOptions(command);
}
