import { DBServer } from "../src/db/DBServer.js";

/**
 * Example demonstrating how to launch a DBServer
 */
async function main() {
  // Create a new DBServer instance with configuration options
  const dbServer = new DBServer({
    port: 3000,                // Port to listen on
    basePath: "/api/db",       // Base path for the API (optional)
    origin: "http://localhost:3000" // Server origin for auth token validation (optional)
    // perms: customPermsImplementation // Optional permissions interface
  });

  try {
    // Start the server
    await dbServer.start();
    console.log("DB Server started successfully!");
    console.log("Server is running at http://localhost:3000/api/db");
    console.log("Press Ctrl+C to stop the server");

    // Handle graceful shutdown
    process.on("SIGINT", async () => {
      console.log("\nShutting down server...");
      await dbServer.stop();
      console.log("Server stopped");
      process.exit(0);
    });
  } catch (error) {
    console.error("Failed to start DB Server:", error);
    process.exit(1);
  }
}

// Run the example
main().catch(console.error);