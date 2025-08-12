import { Command } from "commander";
import { DBExpert } from "../../../db/interfaces.js";
import { generateRandomKeyPair } from "../../../common/crypto.js";
import { getPublicKey } from "nostr-tools";
import { bytesToHex } from "nostr-tools/utils";
import { debugError, enableAllDebug, enableErrorDebug } from "../../../common/debug.js";
import { getWalletByNameOrDefault } from "../../commands/wallet/utils.js";
import { getExpertClient } from "../../../experts/ExpertRemoteClient.js";

/**
 * Options for the create expert command
 */
interface CreateExpertCommandOptions {
  wallet?: string;
  env?: string[];
  docstores?: string[];
  privkey_hex?: string;
  debug?: boolean;
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
 * @param type Type of expert (nostr or openai)
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
    if (type !== "nostr" && type !== "openai") {
      throw new Error('Type must be either "nostr" or "openai"');
    }

    // Get wallet ID using the utility function
    const wallet = getWalletByNameOrDefault(options.wallet);
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
    const envStr = options.env
      ? options.env.join("\n")
      : "";

    // Format docstores
    const docstoresStr = options.docstores
      ? options.docstores.join(",")
      : "";

    // Create expert object
    const expert: DBExpert = {
      pubkey,
      wallet_id: walletId,
      type,
      nickname,
      env: envStr,
      docstores: docstoresStr,
      privkey: bytesToHex(privkey)
    };

    // Insert expert into database
    const expertClient = getExpertClient();
    const success = await expertClient.insertExpert(expert);
    if (!success) {
      throw new Error("Failed to insert expert into database");
    }

    console.log(`Expert created successfully:`);
    console.log(`  Type: ${type}`);
    console.log(`  Nickname: ${nickname}`);
    console.log(`  Public Key: ${pubkey}`);
    console.log(`  Private Key: ${bytesToHex(privkey)}`);
    console.log(`  Wallet ID: ${walletId}`);
    if (envStr) console.log(`  Environment Variables: ${envStr.replace(/\n/g, ", ")}`);
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
  program
    .command("create")
    .description("Create a new expert in the database")
    .argument("<type>", "Type of expert (nostr or openai)")
    .argument("<nickname>", "Nickname for the expert")
    .option("-w, --wallet <name>", "Wallet name to use (uses default if not provided)")
    .option("-e, --env <key:value...>", "Environment variables in key:value format")
    .option("-s, --docstores <id...>", "Docstore IDs to use")
    .option("-p, --privkey_hex <hex>", "Expert private key in hex format (generates one if not provided)")
    .option("-d, --debug", "Enable debug logging")
    .action(async (type, nickname, options: CreateExpertCommandOptions) => {
      try {
        await createExpert(type, nickname, options);
      } catch (error) {
        debugError("Error creating expert:", error);
        process.exit(1);
      }
    });
}