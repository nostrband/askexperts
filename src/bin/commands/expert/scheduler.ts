import { Command } from "commander";
import { DBClient } from "../../../db/DBClient.js";
import {
  debugError,
  debugExpert,
  enableAllDebug,
  enableErrorDebug,
} from "../../../common/debug.js";
import { ExpertScheduler } from "../../../experts/scheduler/ExpertScheduler.js";
import { createDBClientForCommands } from "../utils.js";
import { ExpertCommandOptions } from "./index.js";

/**
 * Options for the scheduler command
 */
interface SchedulerCommandOptions extends ExpertCommandOptions {
  debug?: boolean;
  port?: number;
}

/**
 * Start the expert scheduler
 *
 * @param options Command options
 */
export async function startScheduler(
  options: SchedulerCommandOptions
): Promise<void> {
  // Enable debug if requested
  if (options.debug) enableAllDebug();
  else enableErrorDebug();

  // Only use local DB for this command
  const db = await createDBClientForCommands({}) as DBClient;

  try {
    // Get port from options or use default
    const port = options.port || 8765;

    debugExpert(`Starting expert scheduler on port ${port}`);

    // Create scheduler
    const scheduler = new ExpertScheduler(db, port);

    // Start scheduler
    await scheduler.start();

    // Set up signal handling
    const onStop = new Promise<void>((ok) => {
      const sigHandler = async () => {
        debugExpert("\nReceived SIGINT. Shutting down scheduler...");

        // Stop the scheduler
        await scheduler.stop();
        ok();

        debugExpert("Scheduler shut down");
      };

      // SIGINT and SIGTERM
      process.on("SIGINT", sigHandler);
      process.on("SIGTERM", sigHandler);
    });

    debugExpert("Expert scheduler running. Press Ctrl+C to exit.");

    // Wait for stop signal
    await onStop;
  } catch (error) {
    debugError("Error running expert scheduler:", error);
    throw error;
  }
}

/**
 * Register the scheduler command with the CLI
 *
 * @param program The commander program or parent command
 */
export function registerSchedulerCommand(program: Command): void {
  const command = program
    .command("scheduler")
    .description("Start the expert scheduler")
    .option("-d, --debug", "Enable debug logging")
    .option("-p, --port <port>", "Port to listen on (default: 8765)", parseInt)
    .action(async (options: SchedulerCommandOptions) => {
      try {
        await startScheduler(options);
      } catch (error) {
        debugError("Error starting scheduler:", error);
        process.exit(1);
      }
    });

  // No remote options for this command - only works with local DB
}