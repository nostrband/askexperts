import { Command } from "commander";
import { DocStoreSQLiteServer } from "../../../docstore/DocStoreSQLiteServer.js";
import { DocstoreCommandOptions, getDocstorePath } from "./index.js";
import { debugError, debugDocstore, enableAllDebug } from "../../../common/debug.js";

/**
 * Options for the server command
 */
interface ServerCommandOptions extends DocstoreCommandOptions {
  port?: number;
  host?: string;
  origin?: string;
}

/**
 * Start a DocStoreSQLiteServer
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

    // Use the provided dbPath or get the default one
    const dbPath = options.docstore || getDocstorePath();
    
    // Create and start the server
    const server = new DocStoreSQLiteServer({
      dbPath,
      port: options.port,
      host: options.host,
      origin: options.origin,
      // perms is left undefined as per requirements
    });
    
    console.log(`Starting DocStoreSQLiteServer with database at: ${dbPath}`);
    console.log(`Server will listen on ${options.host || 'localhost'}:${options.port || 8080}`);
    
    // Start the server
    server.start();
    
    // Handle process termination
    process.on('SIGINT', () => {
      console.log('Shutting down server...');
      server.close();
      process.exit(0);
    });
    
    process.on('SIGTERM', () => {
      console.log('Shutting down server...');
      server.close();
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
 * @param docstoreCommand The parent docstore command
 * @param addCommonOptions Function to add common options to command
 */
export function registerServerCommand(
  docstoreCommand: Command,
  addCommonOptions: (cmd: Command) => Command
): void {
  const serverCommand = docstoreCommand
    .command("server")
    .description("Start a DocStoreSQLiteServer")
    .option("-s, --docstore <path>", "Path to the SQLite database file")
    .option("-p, --port <port>", "Port to listen on", (value) => parseInt(value, 10))
    .option("--host <host>", "Host to bind to")
    .option("-o, --origin <origin>", "Server origin for auth token validation")
    .action(startServer);
  
  addCommonOptions(serverCommand);
}