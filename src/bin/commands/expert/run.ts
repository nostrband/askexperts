import { Command } from "commander";
import { DBExpert, DBInterface, DBWallet } from "../../../db/interfaces.js";
import {
  debugError,
  debugExpert,
  enableAllDebug,
  enableErrorDebug,
} from "../../../common/debug.js";
import { SimplePool } from "nostr-tools";
import dotenv from "dotenv";
import { ExpertCommandOptions } from "./index.js";
import { createDBClientForCommands } from "../utils.js";
import { ExpertWorker } from "../../../experts/worker/ExpertWorker.js";

/**
 * Options for the run expert command
 */
interface RunExpertCommandOptions extends ExpertCommandOptions {
  debug?: boolean;
}

/**
 * Get an expert by nickname or pubkey
 *
 * @param identifier Nickname or pubkey of the expert
 * @returns The expert if found, null otherwise
 */
async function getExpertByNicknameOrPubkey(
  db: DBInterface,
  identifier: string,
  options: RunExpertCommandOptions
): Promise<DBExpert | null> {
  // First try to get by pubkey
  let expert = await db.getExpert(identifier);

  // If not found, try to find by nickname
  if (!expert) {
    // We need to search through all experts to find by nickname
    const experts = await db.listExperts();
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
async function getWalletForExpert(
  db: DBInterface,
  walletId: string
): Promise<DBWallet> {
  const wallet = await db.getWallet(walletId);
  if (!wallet) {
    throw new Error(`Wallet with ID ${walletId} not found`);
  }
  return wallet;
}

/**
 * Run a Nostr expert
 *
 * @param expert The expert to run
 * @param options Command options
 */
async function runNostrExpert(
  db: DBInterface,
  expert: DBExpert,
  options: RunExpertCommandOptions
): Promise<void> {
  try {
    // Get wallet for the expert
    const wallet = await getWalletForExpert(db, expert.wallet_id);
    const nwcString = wallet.nwc;

    // Parse environment variables using dotenv
    const envVars = dotenv.parse(expert.env);

    // Get RAG host and port from environment
    const ragHost = envVars.CHROMA_HOST || process.env.CHROMA_HOST;
    const ragPortStr = envVars.CHROMA_PORT || process.env.CHROMA_PORT;
    const ragPort = ragPortStr ? parseInt(ragPortStr) : undefined;

    // Create a shared pool
    const pool = new SimplePool();

    // Create ExpertWorker
    const worker = new ExpertWorker(pool, ragHost, ragPort);

    // Set up signal handling
    const onStop = new Promise<void>((ok) => {
      const sigHandler = async () => {
        debugExpert("\nReceived SIGINT. Shutting down expert...");

        // Stop the expert
        ok();

        // Final cleaning
        await worker[Symbol.asyncDispose]();
        pool.destroy();

        debugExpert("Expert shut down");
      };

      // SIGINT and SIGTERM
      process.on("SIGINT", sigHandler);
      process.on("SIGTERM", sigHandler);
    });

    // Start the expert
    await worker.startExpert(expert, nwcString);

    debugExpert("Press Ctrl+C to exit.");

    // Wait for stop signal
    await onStop;
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
  db: DBInterface,
  expert: DBExpert,
  options: RunExpertCommandOptions
): Promise<void> {
  try {
    // Get wallet for the expert
    const wallet = await getWalletForExpert(db, expert.wallet_id);
    const nwcString = wallet.nwc;

    // Create a shared pool
    const pool = new SimplePool();

    // Create ExpertWorker
    const worker = new ExpertWorker(pool);

    // Set up signal handling
    const onStop = new Promise<void>((ok) => {
      const sigHandler = async () => {
        debugExpert("\nReceived SIGINT. Shutting down expert...");

        // Stop the expert
        ok();

        // Final cleaning
        await worker[Symbol.asyncDispose]();
        pool.destroy();

        debugExpert("Expert shut down");
      };

      // SIGINT and SIGTERM
      process.on("SIGINT", sigHandler);
      process.on("SIGTERM", sigHandler);
    });

    // Start the expert
    await worker.startExpert(expert, nwcString);

    debugExpert("Press Ctrl+C to exit.");

    // Wait for stop signal
    await onStop;
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

  // Only use local DB for this command
  const db = await createDBClientForCommands({});

  try {
    // Get expert by nickname or pubkey
    const expert = await getExpertByNicknameOrPubkey(db, identifier, options);
    if (!expert) {
      throw new Error(
        `Expert with nickname or pubkey '${identifier}' not found`
      );
    }

    debugExpert(`Found expert: ${expert.nickname} (${expert.pubkey})`);

    // Run expert based on type
    if (expert.type === "nostr") {
      await runNostrExpert(db, expert, options);
    } else if (expert.type === "openrouter") {
      await runOpenRouterExpert(db, expert, options);
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
  const command = program
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

  // No remote options for this command - only works with local DB
}
