import { Command } from "commander";
import { DBExpert } from "../../../db/interfaces.js";
import { SimplePool } from "nostr-tools";
import {
  debugError,
  debugExpert,
  enableAllDebug,
  enableErrorDebug,
} from "../../../common/debug.js";

import { ExpertCommandOptions } from "./index.js";
import { createDBClientForCommands } from "../utils.js";
import { ExpertWorker } from "../../../experts/worker/ExpertWorker.js";

/**
 * Options for the all experts command
 */
interface AllExpertsCommandOptions extends ExpertCommandOptions {
  debug?: boolean;
  interval?: number;
  startDelay?: number;
}

// We no longer need the RunningExpert interface as it's encapsulated in ExpertWorker

/**
 * Run all enabled experts from the database
 *
 * @param options Command options
 */
export async function runAllExperts(
  options: AllExpertsCommandOptions
): Promise<void> {
  // Enable debug if requested
  if (options.debug) enableAllDebug();
  else enableErrorDebug();

  // Check interval in milliseconds (default: 30 seconds)
  const checkInterval = options.interval || 30000;

  // Expert start delay in milliseconds (default: 1000ms)
  const startDelay = options.startDelay || 1000;

  try {
    debugExpert("Initializing shared resources...");

    // Only use local DB for this command
    const db = await createDBClientForCommands({});

    // Create a shared pool
    const pool = new SimplePool();

    // Get RAG host and port from environment
    const ragHost = process.env.CHROMA_HOST;
    const ragPort = process.env.CHROMA_PORT
      ? parseInt(process.env.CHROMA_PORT)
      : undefined;

    // We'll create docstore clients on demand when starting each expert
    // This allows us to support both local and remote docstores

    // Create ExpertWorker
    const worker = new ExpertWorker(pool, ragHost, ragPort);

    // Create a promise that resolves when SIGINT/SIGTERM is received
    const globalStopPromise = new Promise<void>((resolve) => {
      const sigHandler = () => {
        debugExpert("\nReceived SIGINT/SIGTERM. Shutting down all experts...");
        resolve();

        // Final cleaning after all experts are stopped
        setTimeout(async () => {
          await worker[Symbol.asyncDispose]();
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
      try {
        // Get wallet for the expert using the wallet client
        const wallet = await db.getWallet(expert.wallet_id || '');
        if (!wallet) {
          throw new Error(
            `Wallet with ID ${expert.wallet_id} not found for expert ${expert.nickname}`
          );
        }
        const nwcString = wallet.nwc;

        // Start the expert
        await worker.startExpert(expert, nwcString);

        // Pause a bit to avoid overloading relays
        await new Promise((ok) => setTimeout(ok, startDelay));
      } catch (error) {
        debugError(
          `Error starting expert ${expert.nickname} (${expert.pubkey}):`,
          error
        );
      }
    }

    // Function to check for experts to start/stop
    async function checkExperts(): Promise<void> {
      const experts = await db.listExperts();

      // Get list of running experts
      const runningPubkeys = Array.from(worker.getRunningExpertPubkeys());

      // Find experts to start (enabled and not already running)
      const expertsToStart = experts.filter(
        (expert) => !expert.disabled && !runningPubkeys.includes(expert.pubkey)
      );

      // Find experts to stop (disabled or no longer in DB)
      const expertsToStop = runningPubkeys.filter((pubkey) => {
        const expert = experts.find((e) => e.pubkey === pubkey);
        return !expert || expert.disabled;
      });

      // Start new experts
      for (const expert of expertsToStart) {
        debugExpert(
          `Starting new expert ${expert.nickname} (${expert.pubkey})`
        );
        await startExpert(expert);
      }

      // Stop disabled experts
      for (const pubkey of expertsToStop) {
        debugExpert(`Stopping expert ${pubkey} (disabled or removed)`);
        worker.stopExpert(pubkey);
      }
    }

    // Initial check for experts to start
    await checkExperts();

    // Set up interval to periodically check for new/disabled experts
    const intervalId = setInterval(checkExperts, checkInterval);

    // When global stop is triggered, stop all experts
    globalStopPromise.then(async () => {
      clearInterval(intervalId);

      // Dispose worker (which will stop all experts and clean up payment managers)
      await worker[Symbol.asyncDispose]();
    });

    debugExpert(
      `All enabled experts started. Checking for changes every ${
        checkInterval / 1000
      } seconds.`
    );
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
  const command = program
    .command("all")
    .description("Run all enabled experts from the database")
    .option("-d, --debug", "Enable debug logging")
    .option(
      "-i, --interval <ms>",
      "Check interval in milliseconds (default: 30000)",
      parseInt
    )
    .option(
      "-s, --start-delay <ms>",
      "Delay between starting experts in milliseconds (default: 1000)",
      parseInt
    )
    .action(async (cmdOptions) => {
      // Convert command options to AllExpertsCommandOptions
      const options: AllExpertsCommandOptions = {
        debug: cmdOptions.debug,
        interval: cmdOptions.interval,
        startDelay: cmdOptions.startDelay,
      };

      try {
        await runAllExperts(options);
      } catch (error) {
        debugError("Error running all experts:", error);
        process.exit(1);
      }
    });

  // No remote options for this command - only works with local DB
}
