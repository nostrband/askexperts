import { getPublicKey, nip19, SimplePool } from "nostr-tools";
import { NostrExpert } from "../../../experts/NostrExpert.js";
import { OpenaiProxyExpertBase } from "../../../experts/OpenaiProxyExpertBase.js";
import { OpenRouter } from "../../../experts/utils/OpenRouter.js";
import {
  debugError,
  debugExpert,
  enableAllDebug,
  enableErrorDebug,
} from "../../../common/debug.js";
import { APP_DOCSTORE_PATH } from "../../../common/constants.js";
import { generateRandomKeyPair } from "../../../common/crypto.js";
import { createWallet } from "nwc-enclaved-utils";
import { ChromaRagDB } from "../../../rag/index.js";
import { createOpenAI } from "../../../openai/index.js";
import { AskExpertsServer } from "../../../server/AskExpertsServer.js";
import fs from "fs";
import path from "path";
import { Command } from "commander";
import { LightningPaymentManager } from "../../../payments/LightningPaymentManager.js";
import { DocStoreSQLite } from "../../../docstore/DocStoreSQLite.js";

/**
 * Options for the Nostr expert command
 */
export interface NostrExpertCommandOptions {
  pubkey: string;
  model: string;
  margin: number;
  nwc?: string;
  debug?: boolean;
  apiKey?: string;
  ragHost?: string;
  ragPort?: number;
  docstoreId: string; // Required option
}

/**
 * Nostr expert configuration stored in JSON file
 */
interface NostrExpertConfig {
  privkeyHex: string;
  nwc?: string;
}

/**
 * Start a Nostr expert with the given options
 *
 * @param options Command line options
 */
export async function startNostrExpert(
  options: NostrExpertCommandOptions
): Promise<void> {
  // Enable debug if requested
  if (options.debug) enableAllDebug();
  else enableErrorDebug();

  try {
    // User pubkey
    const pubkey = options.pubkey;

    // Get API key
    const apiKey = options.apiKey || process.env.OPENROUTER_API_KEY || "";
    if (!apiKey) {
      throw new Error(
        "OpenRouter API key is required. Set OPENROUTER_API_KEY environment variable or use --api-key option."
      );
    }

    // Configuration file path
    const configPath = path.resolve(`nostr_${pubkey}.json`);
    let config: NostrExpertConfig | null = null;

    // Check if configuration file exists
    if (fs.existsSync(configPath)) {
      try {
        const configData = fs.readFileSync(configPath, "utf8");
        config = JSON.parse(configData);
        debugExpert(
          `Loaded configuration for Nostr expert imitating ${pubkey}`
        );
      } catch (error) {
        debugError(`Error loading configuration: ${error}`);
        config = null;
      }
    }

    // Generate or use existing private key
    let privkey: Uint8Array;
    let nwcString: string | undefined;

    if (config && config.privkeyHex) {
      // Use existing configuration
      privkey = new Uint8Array(Buffer.from(config.privkeyHex, "hex"));

      // Use provided NWC string or existing one
      nwcString = options.nwc || config.nwc || "";

      // If no NWC string is available, create a new wallet
      if (!nwcString) {
        debugExpert(`No NWC string found, creating new wallet`);
        const wallet = await createWallet();
        nwcString = wallet.nwcString;
      }

      debugExpert(`Using existing configuration for Nostr expert`);
    } else {
      // Generate new keypair
      const { privateKey } = generateRandomKeyPair();
      privkey = privateKey;

      debugExpert(`Created new configuration for Nostr expert`);
    }

    if (!nwcString) {
      // Create new wallet
      debugExpert(`Creating new wallet for Nostr expert`);
      const wallet = await createWallet();
      nwcString = wallet.nwcString;
    }

    // Initialize RAG components
    debugExpert("Initializing RAG components...");

    // Create RAG database
    const ragDB = new ChromaRagDB(options.ragHost, options.ragPort);
    debugExpert("RAG database initialized");
    
    // Get fixed docstore path
    const docstorePath = getDocstorePath();
    debugExpert(`Using docstore at: ${docstorePath}`);
    
    // Create DocStoreSQLite instance
    using docStoreClient = new DocStoreSQLite(docstorePath);

    // Create OpenAI interface instance
    const openai = createOpenAI(apiKey, "https://openrouter.ai/api/v1");

    // Create payment manager
    using paymentManager = new LightningPaymentManager(nwcString);

    // Create a shared pool
    const pool = new SimplePool();

    // Create OpenRouter instance for pricing
    const openRouter = new OpenRouter();

    // Create server
    await using server = new AskExpertsServer({
      privkey,
      pool,
      paymentManager,
    });

    // Create OpenaiProxyExpertBase instance
    await using openaiExpert = new OpenaiProxyExpertBase({
      server,
      openai,
      model: options.model,
      margin: options.margin,
      pricingProvider: openRouter,
    });

    // Create the expert
    await using expert = new NostrExpert({
      openaiExpert,
      pubkey,
      ragDB,
      docStoreClient,
      docstoreId: options.docstoreId,
    });

    // Start the expert
    await expert.start();

    // Save the configuration
    const updatedConfig: NostrExpertConfig = {
      privkeyHex: Buffer.from(privkey).toString("hex"),
      nwc: nwcString,
    };

    fs.writeFileSync(configPath, JSON.stringify(updatedConfig, null, 2));
    debugExpert(`Saved configuration to ${configPath}`);

    debugExpert(
      `Started Nostr expert imitating ${pubkey} with model ${options.model} and margin ${options.margin}`
    );
    debugExpert(`Expert pubkey: ${getPublicKey(privkey)}`);
    debugExpert("Press Ctrl+C to exit.");

    // Handle SIGINT/SIGTERM (Ctrl+C)
    await new Promise(ok => {
      process.on("SIGINT", ok);
      process.on("SIGTERM", ok);

    })
    debugExpert("\nReceived SIGINT. Shutting down Nostr expert...");

    // Must be manually terminated
    pool.destroy();
  } catch (error) {
    debugError("Error starting Nostr expert:", error);
    throw error;
  }
}

/**
 * Get the fixed docstore path from constants
 * @returns The docstore path
 */
export function getDocstorePath(): string {
  // Ensure the directory exists
  const dir = path.dirname(APP_DOCSTORE_PATH);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  return APP_DOCSTORE_PATH;
}

/**
 * Register the Nostr expert command with the CLI
 *
 * @param program The commander program or parent command
 */
export function registerNostrCommand(program: Command): void {
  program
    .command("nostr")
    .description(
      "Launch an expert that imitates a Nostr user. Expert settings are saved to nostr_<pubkey>.json file."
    )
    .argument("<pubkey>", "Nostr public key of the user to imitate")
    .option("-m, --model <model>", "Model to use", "openai/gpt-4.1")
    .option(
      "--margin <number>",
      "Profit margin (e.g., 0.1 for 10%)",
      parseFloat,
      0.1
    )
    .option(
      "--nwc <string>",
      "NWC string for lightning payments, auto-generated and saved to settings if not provided."
    )
    .option(
      "-k, --api-key <key>",
      "OpenRouter API key (defaults to OPENROUTER_API_KEY env var)"
    )
    .option("-d, --debug", "Enable debug logging")
    .option("--rag-host <host>", "ChromaDB host")
    .option("--rag-port <port>", "ChromaDB port", parseInt)
    .requiredOption(
      "-s, --docstore-id <id>",
      "ID of the docstore to use for RAG"
    )
    .action(async (pubkey, options) => {
      if (options.debug) enableAllDebug();
      else enableErrorDebug();
      try {
        // Add pubkey to options
        await startNostrExpert({ ...options, pubkey });
      } catch (error) {
        debugError("Error starting Nostr expert:", error);
        process.exit(1);
      }
    });
}
