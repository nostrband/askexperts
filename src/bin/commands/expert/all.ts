import { Command } from "commander";
import { getDB } from "../../../db/utils.js";
import { DBExpert } from "../../../db/interfaces.js";
import { SimplePool } from "nostr-tools";
import { ChromaRagDB } from "../../../rag/index.js";
import { LightningPaymentManager } from "../../../payments/LightningPaymentManager.js";
import { DocStoreSQLite } from "../../../docstore/DocStoreSQLite.js";
import { getDocstorePath } from "../../commands/docstore/index.js";
import {
  debugError,
  debugExpert,
  enableAllDebug,
  enableErrorDebug,
} from "../../../common/debug.js";

// Import the start functions from run.js
import { 
  startNostrExpert, 
  startOpenRouterExpert 
} from "./run.js";

/**
 * Options for the all experts command
 */
interface AllExpertsCommandOptions {
  debug?: boolean;
  interval?: number;
}

/**
 * Interface for tracking running experts
 */
interface RunningExpert {
  pubkey: string;
  type: string;
  stopFn: () => void;
}

/**
 * Run all enabled experts from the database
 * 
 * @param options Command options
 */
export async function runAllExperts(options: AllExpertsCommandOptions): Promise<void> {
  // Enable debug if requested
  if (options.debug) enableAllDebug();
  else enableErrorDebug();

  // Check interval in milliseconds (default: 30 seconds)
  const checkInterval = options.interval || 30000;

  try {
    debugExpert("Initializing shared resources...");

    // Create a shared pool
    const pool = new SimplePool();

    // Get RAG host and port from environment
    const ragHost = process.env.CHROMA_HOST;
    const ragPort = process.env.CHROMA_PORT
      ? parseInt(process.env.CHROMA_PORT)
      : undefined;

    // Create RAG database
    const ragDB = new ChromaRagDB(ragHost, ragPort);
    debugExpert("RAG database initialized");

    // Get fixed docstore path
    const docstorePath = getDocstorePath();
    debugExpert(`Using docstore at: ${docstorePath}`);

    // Create DocStoreSQLite instance
    const docStoreClient = new DocStoreSQLite(docstorePath);

    // Track running experts
    const runningExperts: Map<string, RunningExpert> = new Map();
    
    // Track payment managers by wallet ID
    const paymentManagers: Map<number, LightningPaymentManager> = new Map();

    // Create a promise that resolves when SIGINT/SIGTERM is received
    const globalStopPromise = new Promise<void>((resolve) => {
      const sigHandler = () => {
        debugExpert("\nReceived SIGINT/SIGTERM. Shutting down all experts...");
        resolve();

        // Final cleaning after all experts are stopped
        setTimeout(() => {
          for (const pm of paymentManagers.values()) pm[Symbol.dispose]();
          docStoreClient[Symbol.dispose]();
          pool.destroy();
          debugExpert("All experts shut down and resources cleaned up");
          process.exit(0);
        }, 1000);
      };

      // SIGINT and SIGTERM
      process.on("SIGINT", sigHandler);
      process.on("SIGTERM", sigHandler);
    });

    // Function to start an expert
    async function startExpert(expert: DBExpert): Promise<void> {
      if (runningExperts.has(expert.pubkey)) {
        debugExpert(`Expert ${expert.nickname} (${expert.pubkey}) is already running`);
        return;
      }

      try {
        // Get wallet for the expert
        const db = getDB();
        const wallet = db.getWallet(expert.wallet_id);
        if (!wallet) {
          throw new Error(`Wallet with ID ${expert.wallet_id} not found for expert ${expert.nickname}`);
        }
        const nwcString = wallet.nwc;

        // Get or create payment manager for this expert's wallet
        let paymentManager: LightningPaymentManager;
        if (paymentManagers.has(expert.wallet_id)) {
          paymentManager = paymentManagers.get(expert.wallet_id)!;
          debugExpert(`Reusing existing payment manager for wallet ID ${expert.wallet_id}`);
        } else {
          paymentManager = new LightningPaymentManager(nwcString);
          paymentManagers.set(expert.wallet_id, paymentManager);
          debugExpert(`Created new payment manager for wallet ID ${expert.wallet_id}`);
        }

        // Create individual stop promise for this expert
        let stopResolve: () => void;
        const expertStopPromise = new Promise<void>((resolve) => {
          stopResolve = resolve;
        });

        // Start the expert based on its type
        if (expert.type === "nostr") {
          await startNostrExpert(
            expert,
            pool,
            paymentManager,
            ragDB,
            docStoreClient,
            expertStopPromise
          );
        } else if (expert.type === "openrouter") {
          await startOpenRouterExpert(
            expert,
            pool,
            paymentManager,
            expertStopPromise
          );
        } else {
          throw new Error(`Unknown expert type: ${expert.type}`);
        }

        // Add to running experts
        runningExperts.set(expert.pubkey, {
          pubkey: expert.pubkey,
          type: expert.type,
          stopFn: stopResolve!
        });

        debugExpert(`Started expert ${expert.nickname} (${expert.pubkey}) of type ${expert.type}`);
      } catch (error) {
        debugError(`Error starting expert ${expert.nickname} (${expert.pubkey}):`, error);
      }
    }

    // Function to stop an expert
    function stopExpert(pubkey: string): void {
      const expert = runningExperts.get(pubkey);
      if (expert) {
        debugExpert(`Stopping expert ${pubkey}...`);
        expert.stopFn();
        runningExperts.delete(pubkey);
      }
    }

    // Function to check for experts to start/stop
    async function checkExperts(): Promise<void> {
      const db = getDB();
      const experts = db.listExperts();
      
      // Find experts to start (enabled and not already running)
      const expertsToStart = experts.filter(
        (expert) => !expert.disabled && !runningExperts.has(expert.pubkey)
      );
      
      // Find experts to stop (disabled or no longer in DB)
      const runningPubkeys = Array.from(runningExperts.keys());
      const expertsToStop = runningPubkeys.filter(
        (pubkey) => {
          const expert = experts.find(e => e.pubkey === pubkey);
          return !expert || expert.disabled;
        }
      );
      
      // Start new experts
      for (const expert of expertsToStart) {
        debugExpert(`Starting new expert ${expert.nickname} (${expert.pubkey})`);
        await startExpert(expert);
      }
      
      // Stop disabled experts
      for (const pubkey of expertsToStop) {
        debugExpert(`Stopping expert ${pubkey} (disabled or removed)`);
        stopExpert(pubkey);
      }
    }

    // Initial check for experts to start
    await checkExperts();
    
    // Set up interval to periodically check for new/disabled experts
    const intervalId = setInterval(checkExperts, checkInterval);
    
    // When global stop is triggered, stop all experts
    globalStopPromise.then(() => {
      clearInterval(intervalId);
      
      // Stop all running experts
      for (const [pubkey, expert] of runningExperts.entries()) {
        debugExpert(`Stopping expert ${pubkey}...`);
        expert.stopFn();
      }
      
      runningExperts.clear();
      
      // Dispose all remaining payment managers
      for (const [walletId, paymentManager] of paymentManagers.entries()) {
        debugExpert(`Disposing payment manager for wallet ID ${walletId}`);
        paymentManager[Symbol.dispose]();
      }
      
      paymentManagers.clear();
    });
    
    debugExpert(`All enabled experts started. Checking for changes every ${checkInterval/1000} seconds.`);
    debugExpert("Press Ctrl+C to exit.");
    
    // Wait for the global stop promise
    await globalStopPromise;
    
  } catch (error) {
    debugError("Error running all experts:", error);
    throw error;
  }
}

/**
 * Register the all experts command with the CLI
 *
 * @param program The commander program or parent command
 */
export function registerAllCommand(program: Command): void {
  program
    .command("all")
    .description("Run all enabled experts from the database")
    .option("-d, --debug", "Enable debug logging")
    .option("-i, --interval <ms>", "Check interval in milliseconds (default: 30000)", parseInt)
    .action(async (options: AllExpertsCommandOptions) => {
      try {
        await runAllExperts(options);
      } catch (error) {
        debugError("Error running all experts:", error);
        process.exit(1);
      }
    });
}