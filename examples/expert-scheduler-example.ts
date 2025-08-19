/**
 * Example of using ExpertScheduler and ExpertRemoteWorker
 */
import { SimplePool } from 'nostr-tools';
import { DBClient } from '../src/db/DBClient.js';
import { ExpertScheduler } from '../src/experts/scheduler/index.js';
import { ExpertRemoteWorker } from '../src/experts/worker/index.js';
import { debug as createDebug } from '../src/common/debug.js';

// Create a debug function
const debug = createDebug('askexperts:example');

/**
 * Run the scheduler example
 */
async function runSchedulerExample() {
  // Create a SimplePool instance for Nostr communication
  const pool = new SimplePool();
  
  // Create a DBClient instance
  const db = new DBClient();
  
  // Create an ExpertScheduler instance
  const scheduler = new ExpertScheduler(db, 8080);
  
  debug("Starting scheduler...");
  await scheduler.start();
  
  debug("Scheduler started on port 8080");
  
  // Return cleanup function
  return async () => {
    debug("Stopping scheduler...");
    await scheduler.stop();
    debug("Scheduler stopped");
    
    // Dispose resources
    pool[Symbol.dispose]();
    db[Symbol.dispose]();
  };
}

/**
 * Run the worker example
 */
async function runWorkerExample() {
  // Create a SimplePool instance for Nostr communication
  const pool = new SimplePool();
  
  // Create an ExpertRemoteWorker instance
  const worker = new ExpertRemoteWorker({
    schedulerUrl: 'ws://localhost:8080',
    pool,
    // Optional RAG database configuration
    ragHost: 'localhost',
    ragPort: 8000
  });
  // NWC strings are now loaded by the scheduler from the database
  // and passed directly to the worker with the job
  
  
  debug("Starting worker...");
  await worker.start();
  
  debug("Worker started and connected to scheduler");
  
  // Return cleanup function
  return async () => {
    debug("Stopping worker...");
    await worker.stop();
    debug("Worker stopped");
    
    // Dispose resources
    pool[Symbol.dispose]();
  };
}

/**
 * Main function
 */
async function main() {
  try {
    // Start the scheduler
    const cleanupScheduler = await runSchedulerExample();
    
    // Start the worker
    const cleanupWorker = await runWorkerExample();
    
    // Handle process termination
    process.on('SIGINT', async () => {
      debug("Received SIGINT, cleaning up...");
      
      // Clean up worker first
      await cleanupWorker();
      
      // Then clean up scheduler
      await cleanupScheduler();
      
      process.exit(0);
    });
    
    debug("Press Ctrl+C to stop");
  } catch (error) {
    console.error("Error:", error);
    process.exit(1);
  }
}

// Run the example
main().catch(console.error);