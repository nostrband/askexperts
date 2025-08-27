import { Command } from "commander";
import { SimplePool } from "nostr-tools";
import {
  debugError,
  debugExpert,
  enableAllDebug,
  enableErrorDebug,
} from "../../../common/debug.js";
import { ExpertRemoteWorker } from "../../../experts/worker/ExpertRemoteWorker.js";
import { ExpertCommandOptions } from "./index.js";

/**
 * Options for the worker command
 */
interface WorkerCommandOptions extends ExpertCommandOptions {
  debug?: boolean;
  url: string;
  ragHost?: string;
  ragPort?: number;
  reconnectDelay?: number;
  expertTypes?: string[];
}

/**
 * Start the expert remote worker
 *
 * @param options Command options
 */
export async function startWorker(
  options: WorkerCommandOptions
): Promise<void> {
  // Enable debug if requested
  if (options.debug) enableAllDebug();
  else enableErrorDebug();

  try {
    // Create a shared pool
    const pool = new SimplePool();

    // Get scheduler URL from options
    const schedulerUrl = options.url || "ws://localhost:8765";

    // Get RAG host and port from environment or options
    const ragHost = options.ragHost || process.env.CHROMA_HOST;
    const ragPortStr = options.ragPort
      ? options.ragPort.toString()
      : process.env.CHROMA_PORT;
    const ragPort = ragPortStr ? parseInt(ragPortStr) : undefined;

    // Get reconnect delay from options
    const reconnectDelay = options.reconnectDelay || 5000;

    // Docstore
    const defaultDocStoreUrl =
      process.env.DOCSTORE_URL || "wss://docstore.askexperts.io";

    debugExpert(`Starting expert remote worker connecting to ${schedulerUrl}`);
    if (ragHost) {
      debugExpert(
        `Using RAG database at ${ragHost}:${ragPort || "default port"}`
      );
    }

    // Create worker
    const worker = new ExpertRemoteWorker({
      schedulerUrl,
      pool,
      ragHost,
      ragPort,
      reconnectDelay,
      defaultDocStoreUrl,
      expert_types: options.expertTypes
    });

    // Start worker
    await worker.start();

    // Set up signal handling
    const onStop = new Promise<void>((ok) => {
      const sigHandler = async () => {
        debugExpert("\nReceived SIGINT. Shutting down worker...");

        // Stop the worker
        await worker.stop();
        ok();

        // Clean up pool
        pool.destroy();

        debugExpert("Worker shut down");
      };

      // SIGINT and SIGTERM
      process.on("SIGINT", sigHandler);
      process.on("SIGTERM", sigHandler);
    });

    debugExpert("Expert remote worker running. Press Ctrl+C to exit.");

    // Wait for stop signal
    await onStop;
  } catch (error) {
    debugError("Error running expert remote worker:", error);
    throw error;
  }
}

/**
 * Register the worker command with the CLI
 *
 * @param program The commander program or parent command
 */
export function registerWorkerCommand(program: Command): void {
  const command = program
    .command("worker")
    .description("Start an expert remote worker")
    .option("-d, --debug", "Enable debug logging")
    .option(
      "-u, --url <url>",
      "URL of the scheduler (default: ws://localhost:8765)"
    )
    .option("--rag-host <host>", "Host for RAG database")
    .option("--rag-port <port>", "Port for RAG database", parseInt)
    .option(
      "--reconnect-delay <ms>",
      "Reconnection delay in milliseconds (default: 5000)",
      parseInt
    )
    .option(
      "--expert-types <types>",
      "Comma-separated list of expert types this worker should handle"
    )
    .action(async (cmdOptions: any) => {
      try {
        const options: WorkerCommandOptions = { ...cmdOptions };
        
        // Parse expert-types if provided
        if (typeof cmdOptions.expertTypes === 'string') {
          options.expertTypes = cmdOptions.expertTypes.split(',').map((type: string) => type.trim());
        }
        
        await startWorker(options);
      } catch (error) {
        debugError("Error starting worker:", error);
        process.exit(1);
      }
    });

  // No remote options for this command
}
