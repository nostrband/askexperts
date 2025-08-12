import { Command } from "commander";
import { ExpertServer } from "../../../experts/ExpertServer.js";
import { debugError, enableAllDebug } from "../../../common/debug.js";

/**
 * Options for the expert server command
 */
interface ServerCommandOptions {
  port: number;
  host?: string;
  origin?: string;
  basePath?: string;
  debug?: boolean;
}

/**
 * Start an ExpertServer
 * @param options Command options
 */
export async function startServer(
  options: ServerCommandOptions
): Promise<void> {
  try {
    // Enable debug output if debug flag is set
    if (options.debug) {
      enableAllDebug();
    }
    
    // Create and start the server
    const server = new ExpertServer({
      port: options.port,
      basePath: options.basePath,
      origin: options.origin || `http://${options.host || 'localhost'}:${options.port}`,
      // perms is left undefined as per requirements
    });
    
    console.log(`Starting ExpertServer`);
    console.log(`Server will listen on ${options.host || 'localhost'}:${options.port}`);
    
    // Start the server
    await server.start();
    
    // Handle process termination
    process.on('SIGINT', async () => {
      console.log('Shutting down server...');
      await server.stop();
      process.exit(0);
    });
    
    process.on('SIGTERM', async () => {
      console.log('Shutting down server...');
      await server.stop();
      process.exit(0);
    });
    
    console.log('Server started. Press Ctrl+C to stop.');
  } catch (error) {
    debugError(`Error starting server: ${error}`);
    process.exit(1);
  }
}

/**
 * Register the server command
 * @param expertCommand The parent expert command
 */
export function registerServerCommand(
  expertCommand: Command
): void {
  expertCommand
    .command("server")
    .description("Start an ExpertServer")
    .requiredOption("-p, --port <port>", "Port to listen on", (value) => parseInt(value, 10))
    .option("--host <host>", "Host to bind to")
    .option("-o, --origin <origin>", "Server origin for auth token validation")
    .option("-b, --basePath <path>", "Base path for the API (e.g., '/api')")
    .option("-d, --debug", "Enable debug output")
    .action(startServer);
}