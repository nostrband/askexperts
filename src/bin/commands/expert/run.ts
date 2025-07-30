import { Command } from "commander";
import { getDB } from "../../../db/utils.js";
import { DBExpert, DBWallet } from "../../../db/interfaces.js";
import { NostrExpert } from "../../../experts/NostrExpert.js";
import { OpenaiProxyExpertBase } from "../../../experts/OpenaiProxyExpertBase.js";
import { OpenaiProxyExpert } from "../../../experts/OpenaiProxyExpert.js";
import {
  debugError,
  debugExpert,
  enableAllDebug,
  enableErrorDebug,
} from "../../../common/debug.js";
import { SimplePool } from "nostr-tools";
import { ChromaRagDB, RagDB } from "../../../rag/index.js";
import { createOpenAI, OpenaiInterface } from "../../../openai/index.js";
import { AskExpertsServer } from "../../../server/AskExpertsServer.js";
import { LightningPaymentManager } from "../../../payments/LightningPaymentManager.js";
import { DocStoreSQLite } from "../../../docstore/DocStoreSQLite.js";
import { getDocstorePath } from "../../commands/docstore/index.js";
import dotenv from "dotenv";
import { DocStoreClient } from "../../../docstore/interfaces.js";

/**
 * Options for the run expert command
 */
interface RunExpertCommandOptions {
  debug?: boolean;
}

/**
 * Get an expert by nickname or pubkey
 *
 * @param identifier Nickname or pubkey of the expert
 * @returns The expert if found, null otherwise
 */
function getExpertByNicknameOrPubkey(identifier: string): DBExpert | null {
  const db = getDB();

  // First try to get by pubkey
  let expert = db.getExpert(identifier);

  // If not found, try to find by nickname
  if (!expert) {
    // We need to search through all experts to find by nickname
    const experts = db.listExperts();
    expert = experts.find((e) => e.nickname === identifier) || null;
  }

  return expert;
}

/**
 * Get wallet for an expert
 *
 * @param walletId ID of the wallet
 * @returns The wallet
 * @throws Error if wallet not found
 */
function getWalletForExpert(walletId: number): DBWallet {
  const wallet = getDB().getWallet(walletId);
  if (!wallet) {
    throw new Error(`Wallet with ID ${walletId} not found`);
  }
  return wallet;
}

export async function startOpenRouterExpert(
  expert: DBExpert,
  pool: SimplePool,
  paymentManager: LightningPaymentManager,
  onStop: Promise<void>
) {
  // Get private key from the expert
  if (!expert.privkey) {
    throw new Error(
      `Expert ${expert.nickname} (${expert.pubkey}) does not have a private key`
    );
  }
  const privkey = new Uint8Array(Buffer.from(expert.privkey!, "hex"));

  // Parse environment variables if not provided
  const expertEnvVars = dotenv.parse(expert.env);

  const model = expertEnvVars.EXPERT_MODEL;
  if (!model) {
    throw new Error(
      "OpenRouter model is required. Set EXPERT_MODEL in the expert's env configuration."
    );
  }

  // Get model and margin from environment or use defaults
  const margin = expertEnvVars.EXPERT_MARGIN
    ? parseFloat(expertEnvVars.EXPERT_MARGIN)
    : 0.1;

  // Get API key from environment
  const apiKey =
    expertEnvVars.OPENROUTER_API_KEY || process.env.OPENROUTER_API_KEY || "";
  if (!apiKey) {
    throw new Error(
      "OpenRouter API key is required. Set OPENROUTER_API_KEY in the expert's env configuration."
    );
  }

  // Create OpenAI interface instance
  const openai = createOpenAI({
    apiKey,
    baseURL: "https://openrouter.ai/api/v1",
    margin,
  });

  // Create server
  const server = new AskExpertsServer({
    privkey,
    pool,
    paymentManager,
  });

  // Create OpenaiProxyExpert instance
  const openaiExpert = new OpenaiProxyExpert({
    server,
    openai,
    model,
  });

  // Start the expert
  await openaiExpert.start();

  debugExpert(
    `Started expert ${expert.nickname} (${expert.pubkey}) with model ${model} and margin ${margin}`
  );

  // Destroy on stop signal
  onStop.then(async () => {
    await openaiExpert[Symbol.asyncDispose]();
    await server[Symbol.asyncDispose]();
  });
}

export async function startNostrExpert(
  expert: DBExpert,
  pool: SimplePool,
  paymentManager: LightningPaymentManager,
  ragDB: RagDB,
  docStoreClient: DocStoreClient,
  onStop: Promise<void>
) {
  // Get private key from the expert
  if (!expert.privkey) {
    throw new Error(
      `Expert ${expert.nickname} (${expert.pubkey}) does not have a private key`
    );
  }
  const privkey = new Uint8Array(Buffer.from(expert.privkey!, "hex"));

  // Parse environment variables if not provided
  const expertEnvVars = dotenv.parse(expert.env);

  // Target nostr pubkey
  const nostrPubkey = expertEnvVars.NOSTR_PUBKEY;
  if (!nostrPubkey) {
    throw new Error(
      "Nostr pubkey is required. Set NOSTR_PUBKEY in the expert's env configuration."
    );
  }

  // Get model and margin from environment or use defaults
  const model = expertEnvVars.EXPERT_MODEL || "openai/gpt-4.1";
  const margin = expertEnvVars.EXPERT_MARGIN
    ? parseFloat(expertEnvVars.EXPERT_MARGIN)
    : 0.1;

  // Parse docstores - exactly one must be specified
  const docstores = expert.docstores.split(",").filter((d) => d.trim() !== "");
  if (docstores.length !== 1) {
    throw new Error(
      `Expert ${expert.nickname} must have exactly one docstore specified, found ${docstores.length}`
    );
  }
  const docstoreId = docstores[0].trim();

  // Get API key from environment
  const apiKey =
    expertEnvVars.OPENAI_API_KEY || process.env.OPENAI_API_KEY;
  const baseURL =
    expertEnvVars.OPENAI_BASE_URL || process.env.OPENAI_BASE_URL;

  // Create OpenAI interface instance
  const openai = createOpenAI({
    apiKey,
    baseURL,
    margin,
    pool,
    paymentManager,
  });

  // Create server
  const server = new AskExpertsServer({
    privkey,
    pool,
    paymentManager,
  });

  // Create OpenaiProxyExpertBase instance
  const openaiExpert = new OpenaiProxyExpertBase({
    server,
    openai,
    model,
  });

  // Create the expert
  const nostrExpert = new NostrExpert({
    openaiExpert,
    pubkey: nostrPubkey,
    ragDB,
    docStoreClient,
    docstoreId,
  });

  // Start the expert
  await nostrExpert.start();

  // Destroy on stop signal
  onStop.then(async () => {
    await nostrExpert[Symbol.asyncDispose]();
    await openaiExpert[Symbol.asyncDispose]();
    await server[Symbol.asyncDispose]();
  });
}

/**
 * Run a Nostr expert
 *
 * @param expert The expert to run
 * @param options Command options
 */
async function runNostrExpert(
  expert: DBExpert,
  options: RunExpertCommandOptions
): Promise<void> {
  try {
    // Get wallet for the expert
    const wallet = getWalletForExpert(expert.wallet_id);
    const nwcString = wallet.nwc;

    // Parse environment variables using dotenv
    const envVars = dotenv.parse(expert.env);

    // Get API key from environment
    const apiKey =
      envVars.OPENROUTER_API_KEY || process.env.OPENROUTER_API_KEY || "";
    if (!apiKey) {
      throw new Error(
        "OpenRouter API key is required. Set OPENROUTER_API_KEY in the expert's env configuration."
      );
    }

    // Initialize RAG components
    debugExpert("Initializing RAG components...");

    // Get RAG host and port from environment
    const ragHost = envVars.CHROMA_HOST || process.env.CHROMA_HOST;
    const ragPortStr = envVars.CHROMA_PORT || process.env.CHROMA_PORT;
    const ragPort = ragPortStr ? parseInt(ragPortStr) : undefined;

    // Create RAG database
    const ragDB = new ChromaRagDB(ragHost, ragPort);
    debugExpert("RAG database initialized");

    // Get fixed docstore path
    const docstorePath = getDocstorePath();
    debugExpert(`Using docstore at: ${docstorePath}`);

    // Create DocStoreSQLite instance
    const docStoreClient = new DocStoreSQLite(docstorePath);

    // Create payment manager
    const paymentManager = new LightningPaymentManager(nwcString);

    // Create a shared pool
    const pool = new SimplePool();

    const onStop = new Promise<void>((ok) => {
      const sigHandler = () => {
        debugExpert("\nReceived SIGINT. Shutting down expert...");

        // Stop the expert
        ok();

        // Final cleaning
        paymentManager[Symbol.dispose]();
        docStoreClient[Symbol.dispose]();
        pool.destroy();

        debugExpert("Expert shut down");
      };

      // SIGINT and SIGTERM
      process.on("SIGINT", sigHandler);
      process.on("SIGTERM", sigHandler);
    });

    await startNostrExpert(
      expert,
      pool,
      paymentManager,
      ragDB,
      docStoreClient,
      onStop
    );

    debugExpert("Press Ctrl+C to exit.");
  } catch (error) {
    debugError("Error running Nostr expert:", error);
    throw error;
  }
}

/**
 * Run an OpenRouter expert
 *
 * @param expert The expert to run
 * @param options Command options
 */
async function runOpenRouterExpert(
  expert: DBExpert,
  options: RunExpertCommandOptions
): Promise<void> {
  try {
    // Get wallet for the expert
    const wallet = getWalletForExpert(expert.wallet_id);
    const nwcString = wallet.nwc;

    // Create payment manager
    const paymentManager = new LightningPaymentManager(nwcString);

    // Create a shared pool
    const pool = new SimplePool();

    const onStop = new Promise<void>((ok) => {
      const sigHandler = () => {
        debugExpert("\nReceived SIGINT. Shutting down expert...");

        // Stop the expert
        ok();

        // Final cleaning
        paymentManager[Symbol.dispose]();
        pool.destroy();

        debugExpert("Expert shut down");
      };

      // SIGINT and SIGTERM
      process.on("SIGINT", sigHandler);
      process.on("SIGTERM", sigHandler);
    });

    await startOpenRouterExpert(expert, pool, paymentManager, onStop);

    debugExpert("Press Ctrl+C to exit.");
  } catch (error) {
    debugError("Error running OpenRouter expert:", error);
    throw error;
  }
}

/**
 * Run an expert with the given identifier (nickname or pubkey)
 *
 * @param identifier Nickname or pubkey of the expert
 * @param options Command options
 */
export async function runExpert(
  identifier: string,
  options: RunExpertCommandOptions
): Promise<void> {
  // Enable debug if requested
  if (options.debug) enableAllDebug();
  else enableErrorDebug();

  try {
    // Get expert by nickname or pubkey
    const expert = getExpertByNicknameOrPubkey(identifier);
    if (!expert) {
      throw new Error(
        `Expert with nickname or pubkey '${identifier}' not found`
      );
    }

    debugExpert(`Found expert: ${expert.nickname} (${expert.pubkey})`);

    // Run expert based on type
    if (expert.type === "nostr") {
      await runNostrExpert(expert, options);
    } else if (expert.type === "openrouter") {
      await runOpenRouterExpert(expert, options);
    } else {
      throw new Error(`Unknown expert type: ${expert.type}`);
    }
  } catch (error) {
    debugError("Error running expert:", error);
    throw error;
  }
}

/**
 * Register the run expert command with the CLI
 *
 * @param program The commander program or parent command
 */
export function registerRunCommand(program: Command): void {
  program
    .command("run")
    .description("Run an expert by nickname or pubkey")
    .argument("<identifier>", "Nickname or pubkey of the expert to run")
    .option("-d, --debug", "Enable debug logging")
    .action(async (identifier, options: RunExpertCommandOptions) => {
      try {
        await runExpert(identifier, options);
      } catch (error) {
        debugError("Error running expert:", error);
        process.exit(1);
      }
    });
}
