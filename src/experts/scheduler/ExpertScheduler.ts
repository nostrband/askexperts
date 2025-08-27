import { WebSocketServer } from "ws";
import WebSocket from "ws";
import http from "http";
import { DBClient } from "../../db/DBClient.js";
import { DBExpert } from "../../db/interfaces.js";
import {
  ExpertStateInfo,
  WorkerConnection,
  WorkerToSchedulerMessage,
  SchedulerToWorkerMessage,
  WorkerToSchedulerMessages,
  QueuedExpert,
} from "./interfaces.js";
import { debugError, debug } from "../../common/debug.js";

// Create a debug function for the scheduler
const debugScheduler = debug("askexperts:scheduler");

/**
 * ExpertScheduler class for managing experts across multiple workers
 */
export class ExpertScheduler {
  private db: DBClient;
  private port: number;
  private server: http.Server;
  private wss: WebSocketServer;

  // Expert state tracking
  private expertStates: Map<string, ExpertStateInfo> = new Map();
  private expertQueue: QueuedExpert[] = [];

  // Worker connection tracking
  private workers: Map<string, WorkerConnection & { expertTypes?: string[] }> = new Map();

  // Reconnection timers for workers
  private reconnectionTimers: Map<string, NodeJS.Timeout> = new Map();

  // Start timers for experts
  private startTimers: Map<string, NodeJS.Timeout> = new Map();

  // Expert monitoring
  private lastExpertTimestamp: number = 0;
  private expertMonitoringTimer: NodeJS.Timeout | null = null;
  private isMonitoringExperts: boolean = false;

  /**
   * Create a new ExpertScheduler
   *
   * @param db DBClient instance for database access
   * @param port Port to listen on for WebSocket connections
   */
  constructor(db: DBClient, port: number) {
    this.db = db;
    this.port = port;

    // Create HTTP server
    this.server = http.createServer();

    // Create WebSocket server
    this.wss = new WebSocketServer({ server: this.server });

    // Set up event handlers
    this.setupWebSocketServer();

    debugScheduler(`ExpertScheduler initialized on port ${port}`);
  }

  /**
   * Start the scheduler
   */
  public async start(): Promise<void> {
    // Start expert monitoring
    this.startExpertMonitoring();

    // Start listening for connections
    this.server.listen(this.port, () => {
      debugScheduler(`ExpertScheduler listening on port ${this.port}`);
    });
  }

  /**
   * Stop the scheduler
   */
  public async stop(): Promise<void> {
    // Stop expert monitoring
    this.stopExpertMonitoring();

    // Clear all reconnection timers
    for (const timer of this.reconnectionTimers.values()) {
      clearTimeout(timer);
    }
    this.reconnectionTimers.clear();

    // Clear all start timers
    for (const timer of this.startTimers.values()) {
      clearTimeout(timer);
    }
    this.startTimers.clear();

    // Close all worker job timers
    for (const worker of this.workers.values()) {
      if (worker.jobTimer) {
        clearTimeout(worker.jobTimer);
      }
    }

    // Close all connections
    for (const worker of this.workers.values()) {
      worker.socket.close();
    }
    this.workers.clear();

    // Close the server
    return new Promise((resolve) => {
      this.wss.close(() => {
        this.server.close(() => {
          debugScheduler("ExpertScheduler stopped");
          resolve();
        });
      });
    });
  }

  /**
   * Set up WebSocket server event handlers
   */
  private setupWebSocketServer(): void {
    this.wss.on("connection", (socket: WebSocket) => {
      debugScheduler(
        `New worker connection established, waiting for first message with worker ID`
      );

      // Set up message handler
      socket.on("message", (data: WebSocket.Data) => {
        try {
          const message = JSON.parse(
            data.toString()
          ) as WorkerToSchedulerMessage;

          // Get worker ID from message
          const workerId = this.getWorkerIdFromMessage(message);

          if (!workerId) {
            debugError("Received message without worker ID, ignoring");
            return;
          }

          // Check if this is a new worker or an existing one
          if (!this.workers.has(workerId)) {
            const existing = this.reconnectionTimers.has(workerId);
            if (existing) {
              debugScheduler(`Worker ${workerId} reconnected`);
              // Clear any reconnection timer
              const timer = this.reconnectionTimers.get(workerId);
              if (timer) {
                clearTimeout(timer);
                this.reconnectionTimers.delete(workerId);
                debugScheduler(
                  `Cleared reconnection timer for worker ${workerId}`
                );
              }
            } else {
              debugScheduler(`New worker identified with ID: ${workerId}`);
            }

            // Create worker connection object
            const worker: WorkerConnection = {
              id: workerId,
              socket,
              activeExperts: new Set(),
              lastActivity: Date.now(),
              needsJob: false,
              ready: false,
            };

            // Store the worker connection
            this.workers.set(workerId, worker);

            // Set up close handler for this worker
            socket.on("close", () => {
              debugScheduler(`Worker ${workerId} disconnected`);
              this.handleWorkerDisconnect(workerId);
            });

            // Set up error handler for this worker
            socket.on("error", (error: Error) => {
              debugError(`Worker ${workerId} error:`, error);
            });
          } else {
            // Existing worker reconnected
            const worker = this.workers.get(workerId)!;

            // Update the activity
            worker.lastActivity = Date.now();
          }

          // Handle the message
          this.handleWorkerMessage(workerId, message);
        } catch (error) {
          debugError("Error parsing worker message:", error);
        }
      });
    });

    this.wss.on("error", (error: Error) => {
      debugError("WebSocket server error:", error);
    });
  }

  /**
   * Start monitoring experts in the database
   */
  private startExpertMonitoring(): void {
    if (this.isMonitoringExperts) {
      return;
    }

    this.isMonitoringExperts = true;
    this.lastExpertTimestamp = 0;

    // Start the monitoring process
    this.monitorExperts();

    debugScheduler("Started expert monitoring");
  }

  /**
   * Stop monitoring experts in the database
   */
  private stopExpertMonitoring(): void {
    if (!this.isMonitoringExperts) {
      return;
    }

    this.isMonitoringExperts = false;

    if (this.expertMonitoringTimer) {
      clearTimeout(this.expertMonitoringTimer);
      this.expertMonitoringTimer = null;
    }

    debugScheduler("Stopped expert monitoring");
  }

  /**
   * Monitor experts in the database
   * This function will continuously check for new or updated experts
   */
  private async monitorExperts(): Promise<void> {
    if (!this.isMonitoringExperts) {
      return;
    }

    try {
      // Get experts updated after the last timestamp
      const experts = await this.db.listExpertsAfter(
        this.lastExpertTimestamp,
        1000
      );

      if (experts.length > 0) {
        debugScheduler(
          `Loaded ${experts.length} experts from database with timestamp > ${this.lastExpertTimestamp}`
        );

        // Process each expert
        for (const expert of experts) {
          // Update the last timestamp
          if (expert.timestamp && expert.timestamp > this.lastExpertTimestamp) {
            this.lastExpertTimestamp = expert.timestamp;
          }

          // Process the expert
          await this.processExpert(expert);
        }

        // Increment the last timestamp to avoid getting the same experts again
        this.lastExpertTimestamp++;

        // Continue monitoring immediately
        this.monitorExperts();
      } else {
        // No experts found, wait for 5 seconds before checking again
        this.expertMonitoringTimer = setTimeout(() => {
          this.monitorExperts();
        }, 5000);
      }
    } catch (error) {
      debugError("Error monitoring experts:", error);

      // Wait for 5 seconds before trying again
      this.expertMonitoringTimer = setTimeout(() => {
        this.monitorExperts();
      }, 5000);
    }
  }

  /**
   * Process an expert from the database
   *
   * @param expert Expert from the database
   */
  private async processExpert(expert: DBExpert): Promise<void> {
    // Check if the expert is disabled
    if (expert.disabled) {
      // Check if the expert is running
      const expertState = this.expertStates.get(expert.pubkey);
      if (expertState && expertState.workerId) {
        // Expert is running but should be disabled, stop it
        debugScheduler(
          `Expert ${expert.pubkey} is disabled in database but running, stopping it`
        );
        this.stopExpert(expert.pubkey);
      }
    } else {
      // Expert is enabled, check if it's already in our state tracking
      const expertState = this.expertStates.get(expert.pubkey);
      if (!expertState) {
        // Expert is not in our state tracking, queue it
        debugScheduler(
          `Expert ${expert.pubkey} is enabled in database but not in state tracking, queueing it`
        );
        await this.queueExpert(expert.pubkey);
      } else {
        debugScheduler(
          `Loaded expert ${expert.pubkey} state ${expertState.state} worker ${expertState.workerId}`
        );

        // Handle the case where expert record is updated while already enabled and running
        switch (expertState.state) {
          case "starting":
          case "started": {
            if (!expertState.workerId)
              throw new Error("Running expert without worker id");
            // Expert is already running, send restart message
            debugScheduler(
              `Expert ${expert.pubkey} is already running in state ${expertState.state}, sending restart message`
            );
            this.sendRestartMessageToWorker(
              expertState.workerId,
              expert.pubkey
            );

            // Update expert state to 'starting'
            this.expertStates.set(expert.pubkey, {
              ...expertState,
              state: "starting",
              timestamp: Date.now(),
            });
            break;
          }
          case "stopped":
          case "stopping": {
            // Expert is stopped or stopping, put it back in the queue
            debugScheduler(
              `Expert ${expert.pubkey} is in state ${expertState.state}, putting it back in the queue`
            );

            // Reset state
            await this.queueExpert(expert.pubkey);
            break;
          }
          case "queued": {
            debugScheduler(
              `Expert ${expert.pubkey} is in state ${expertState.state}, already in the queue`
            );
            break;
          }
        }
      }
    }
  }

  /**
   * Queue an expert to be started
   *
   * @param pubkey Expert pubkey
   */
  public async queueExpert(pubkey: string): Promise<void> {
    // Check if expert is already in a state
    let expertState = this.expertStates.get(pubkey);
    if (expertState) {
      // If expert is already queued, do nothing
      if (expertState.state === "queued") {
        debugScheduler(
          `Expert ${pubkey} is already in state ${expertState.state}`
        );
        return;
      }

      // If expert is in any other state, we need to handle it differently
      // For now, just log a warning
      debugScheduler(
        `Expert ${pubkey} was in state ${expertState.state}, queueing`
      );

      // Update the state
      expertState.state = "queued";
    } else {
      // Init state
      expertState = {
        pubkey,
        state: "queued",
        timestamp: Date.now(),
      };
    }

    // Get the expert from DB to get its type
    let expertType: string | undefined;
    try {
      const expert = await this.db.getExpert(pubkey);
      expertType = expert?.type;
    } catch (error) {
      debugError(`Error fetching expert type for ${pubkey}:`, error);
    }

    // Add expert to queue with type information
    this.expertQueue.push({ pubkey, type: expertType });

    // Update expert state
    this.expertStates.set(pubkey, expertState);

    debugScheduler(`Expert ${pubkey} queued${expertType ? ` with type ${expertType}` : ''}`);

    // Check if any workers need jobs
    this.assignJobsToWorkers();
  }

  /**
   * Handle a worker disconnection
   *
   * @param workerId Worker ID
   */
  private async handleWorkerDisconnect(workerId: string): Promise<void> {
    const worker = this.workers.get(workerId);
    if (!worker) {
      return;
    }

    // Remove the worker
    this.workers.delete(workerId);

    // If worker had active experts, set a timer to requeue them
    if (worker.activeExperts.size > 0) {
      debugScheduler(
        `Worker ${workerId} had ${worker.activeExperts.size} active experts, setting reconnection timer`
      );

      // Set a timer to requeue the experts if the worker doesn't reconnect
      const timer = setTimeout(async () => {
        debugScheduler(
          `Worker ${workerId} did not reconnect within timeout, requeuing experts`
        );

        // Requeue all experts from this worker
        for (const expertPubkey of worker.activeExperts) {
          const expertState = this.expertStates.get(expertPubkey);
          if (expertState) {
            // Only requeue if the expert is still associated with this worker
            if (expertState.workerId === workerId) {
              debugScheduler(`Requeuing expert ${expertPubkey}`);

              // Reset their state
              await this.queueExpert(expertPubkey);
            }
          }
        }

        // Remove the timer
        this.reconnectionTimers.delete(workerId);
      }, 60000); // 60 second timeout

      // Store the timer
      this.reconnectionTimers.set(workerId, timer);
    }
  }

  /**
   * Handle a message from a worker
   *
   * @param workerId Worker ID
   * @param message Message from the worker
   */
  private handleWorkerMessage(
    workerId: string,
    message: WorkerToSchedulerMessage
  ): void {
    const worker = this.workers.get(workerId);
    if (!worker) {
      debugError(`Received message from unknown worker ${workerId}`);
      return;
    }

    // Update last activity timestamp
    worker.lastActivity = Date.now();

    debugScheduler(`Received ${message.type} message from worker ${workerId}`);

    // Handle message based on type
    switch (message.type) {
      case "experts":
        this.handleExpertsMessage(workerId, message.data.experts);
        break;

      case "need_job":
        this.handleNeedJobMessage(workerId, message.data);
        break;

      case "started":
        this.handleStartedMessage(workerId, message.data.expert);
        break;

      case "stopped":
        this.handleStoppedMessage(workerId, message.data.expert);
        break;

      default:
        debugError(`Unknown message type: ${(message as any).type}`);
    }
  }

  /**
   * Get worker ID from a message
   *
   * @param message Message from a worker
   * @returns Worker ID, or undefined if not found
   */
  private getWorkerIdFromMessage(
    message: WorkerToSchedulerMessage
  ): string | undefined {
    switch (message.type) {
      case "experts":
      case "need_job":
      case "started":
      case "stopped":
        return message.data.workerId;
      default:
        return undefined;
    }
  }

  /**
   * Handle an 'experts' message from a worker
   *
   * @param workerId Worker ID
   * @param experts List of expert pubkeys the worker is running
   */
  private handleExpertsMessage(workerId: string, experts: string[]): void {
    const worker = this.workers.get(workerId);
    if (!worker) {
      return;
    }

    debugScheduler(
      `Worker ${workerId} reported running experts: ${experts.join(", ")}`
    );

    // Clear any reconnection timer for this worker
    const timer = this.reconnectionTimers.get(workerId);
    if (timer) {
      clearTimeout(timer);
      this.reconnectionTimers.delete(workerId);
    }

    // Update worker's active experts (will be refined based on validation)
    worker.activeExperts = new Set();

    // Process each reported expert
    for (const expertPubkey of experts) {
      const expertState = this.expertStates.get(expertPubkey);

      if (!expertState) {
        // Expert not found in our state tracking, tell worker to stop it
        debugScheduler(
          `Expert ${expertPubkey} not found in scheduler state, sending stop to worker ${workerId}`
        );
        this.sendStopMessageToWorker(workerId, expertPubkey);
        continue;
      }

      // Check if expert is assigned to a different worker
      if (expertState.workerId && expertState.workerId !== workerId) {
        debugScheduler(
          `Expert ${expertPubkey} is already assigned to worker ${expertState.workerId}, sending stop to worker ${workerId}`
        );
        this.sendStopMessageToWorker(workerId, expertPubkey);
        continue;
      }

      // Check expert state
      switch (expertState.state) {
        case "queued":
          // Expert is queued, update state to started and remove from queue
          debugScheduler(
            `Expert ${expertPubkey} was queued, updating to started state for worker ${workerId}`
          );

          // Remove from queue if present
          const queueIndex = this.expertQueue.findIndex(item => item.pubkey === expertPubkey);
          if (queueIndex !== -1) {
            this.expertQueue.splice(queueIndex, 1);
          }

          // Update state
          this.expertStates.set(expertPubkey, {
            ...expertState,
            state: "started",
            workerId,
            timestamp: Date.now(),
          });

          // Add to worker's active experts
          worker.activeExperts.add(expertPubkey);
          break;

        case "starting":
        case "started":
          // Expert is in a valid running state, update state
          debugScheduler(
            `Expert ${expertPubkey} was in ${expertState.state} state, updating for worker ${workerId}`
          );

          // Update state
          this.expertStates.set(expertPubkey, {
            ...expertState,
            state: "started",
            workerId,
            timestamp: Date.now(),
          });

          // Add to worker's active experts
          worker.activeExperts.add(expertPubkey);
          break;

        case "stopping":
        case "stopped":
          // Expert should not be running, tell worker to stop it
          debugScheduler(
            `Expert ${expertPubkey} is in ${expertState.state} state, sending stop to worker ${workerId}`
          );
          this.sendStopMessageToWorker(workerId, expertPubkey);
          break;
      }
    }

    // Mark worker as ready
    worker.ready = true;
    debugScheduler(`Worker ${workerId} is now ready`);

    // If worker needs a job, try to assign one
    if (worker.needsJob) {
      debugScheduler(
        `Worker ${workerId} is ready and needs a job, trying to assign one`
      );
      this.assignJobToWorker(workerId);
    }
  }

  /**
   * Handle a 'need_job' message from a worker
   *
   * @param workerId Worker ID
   * @param data The need_job message data
   */
  private handleNeedJobMessage(workerId: string, data?: WorkerToSchedulerMessages['need_job']): void {
    const worker = this.workers.get(workerId);
    if (!worker) {
      return;
    }

    const expertTypes = data?.expert_types;
    if (expertTypes && expertTypes.length > 0) {
      debugScheduler(`Worker ${workerId} needs a job with expert types: ${expertTypes.join(', ')}`);
    } else {
      debugScheduler(`Worker ${workerId} needs a job (any expert type)`);
    }

    // Mark worker as needing a job and store expert types
    worker.needsJob = true;
    worker.expertTypes = expertTypes;

    // Only try to assign a job if the worker is ready
    if (worker.ready) {
      debugScheduler(`Worker ${workerId} is ready, trying to assign a job`);

      // Try to assign a job immediately
      this.assignJobToWorker(workerId).then(assigned => {
        // If no job was assigned, set a timer to check again later
        if (!assigned) {
          debugScheduler(
            `No job available for worker ${workerId}, setting timer`
          );

          // Clear any existing timer
          if (worker.jobTimer) {
            clearTimeout(worker.jobTimer);
          }

          // Set a timer to check for jobs again in 60 seconds
          worker.jobTimer = setTimeout(() => {
            debugScheduler(`Job timer expired for worker ${workerId}`);

            // If worker still needs a job, send no_job message
            if (worker.needsJob) {
              this.sendNoJobMessage(workerId);
            }
          }, 60000); // 60 second timeout
        }
      }).catch(error => {
        debugError(`Error assigning job to worker ${workerId}:`, error);
      });

    } else {
      debugScheduler(
        `Worker ${workerId} is not ready yet, waiting for 'experts' message before assigning a job`
      );
    }
  }

  /**
   * Handle a 'started' message from a worker
   *
   * @param workerId Worker ID
   * @param expertPubkey Expert pubkey
   */
  private handleStartedMessage(workerId: string, expertPubkey: string): void {
    const worker = this.workers.get(workerId);
    if (!worker) {
      return;
    }

    debugScheduler(`Worker ${workerId} started expert ${expertPubkey}`);

    // Clear any start timer for this expert
    const timer = this.startTimers.get(expertPubkey);
    if (timer) {
      clearTimeout(timer);
      this.startTimers.delete(expertPubkey);
      debugScheduler(`Cleared start timer for expert ${expertPubkey}`);
    }

    // Update expert state
    const expertState = this.expertStates.get(expertPubkey);
    if (expertState && expertState.workerId === workerId) {
      this.expertStates.set(expertPubkey, {
        ...expertState,
        state: "started",
        timestamp: Date.now(),
      });

      // Add expert to worker's active experts
      worker.activeExperts.add(expertPubkey);
    } else {
      debugError(
        `Received started message for expert ${expertPubkey} from worker ${workerId}, but expert is not assigned to this worker`
      );
    }
  }

  /**
   * Handle a 'stopped' message from a worker
   *
   * @param workerId Worker ID
   * @param expertPubkey Expert pubkey
   */
  private handleStoppedMessage(workerId: string, expertPubkey: string): void {
    const worker = this.workers.get(workerId);
    if (!worker) {
      return;
    }

    debugScheduler(`Worker ${workerId} stopped expert ${expertPubkey}`);

    // Update expert state
    const expertState = this.expertStates.get(expertPubkey);
    if (expertState && expertState.workerId === workerId) {
      // Remove expert state
      this.expertStates.delete(expertPubkey);

      // Remove expert from worker's active experts
      worker.activeExperts.delete(expertPubkey);
    } else {
      debugError(
        `Received stopped message for expert ${expertPubkey} from worker ${workerId}, but expert is not assigned to this worker`
      );
    }
  }

  /**
   * Assign jobs to workers that need them
   */
  private assignJobsToWorkers(): void {
    // Find workers that need jobs
    for (const [workerId, worker] of this.workers.entries()) {
      if (worker.needsJob) {
        this.assignJobToWorker(workerId).catch(error => {
          debugError(`Error assigning job to worker ${workerId}:`, error);
        });
      }
    }
  }

  /**
   * Assign a job to a specific worker
   *
   * @param workerId Worker ID
   * @returns True if a job was assigned, false otherwise
   */
  /**
   * Assign a job to a specific worker
   *
   * @param workerId Worker ID
   * @returns Promise resolving to true if a job was assigned, false otherwise
   */
  private async assignJobToWorker(workerId: string): Promise<boolean> {
    const worker = this.workers.get(workerId);
    if (!worker || !worker.needsJob || !worker.ready) {
      return false;
    }

    // Check if there are any experts in the queue
    if (this.expertQueue.length === 0) {
      return false;
    }

    // Mark worker as no longer needing a job
    worker.needsJob = false;

    try {
      // Get the expert types this worker can handle
      const expertTypes = worker.expertTypes;
      
      // Variable to store the selected expert
      let selectedExpert: QueuedExpert | undefined;
      let expertIndex: number = -1;
      
      if (expertTypes && expertTypes.length > 0) {
        // If worker has type restrictions, search for matching expert
        for (let i = 0; i < this.expertQueue.length; i++) {
          const queuedExpert = this.expertQueue[i];
          
          // Check if the expert type matches any of the worker's accepted types
          if (queuedExpert.type && expertTypes.includes(queuedExpert.type)) {
            // Found a match
            selectedExpert = queuedExpert;
            expertIndex = i;
            break;
          }
        }
        
        // If a match was found, remove it from the queue
        if (selectedExpert && expertIndex !== -1) {
          this.expertQueue.splice(expertIndex, 1);
        } else {
          debugScheduler(
            `No matching expert found for worker ${workerId} with types ${expertTypes.join(', ')}`
          );
          return false;
        }
      } else {
        // If no type restrictions, just take the next expert from the queue
        if (this.expertQueue.length > 0) {
          selectedExpert = this.expertQueue.shift()!;
        } else {
          return false;
        }
      }

      // Extract the pubkey from the selected expert
      const expertPubkey = selectedExpert.pubkey;

      // At this point expertPubkey should be defined
      if (!expertPubkey) {
        debugError(`Failed to select an expert for worker ${workerId}`);
        return false;
      }

      // Get the expert from the database
      const expert = await this.db.getExpert(expertPubkey);
      
      if (!expert) {
        debugError(`Expert ${expertPubkey} not found in database`);
        // Put back in queue, keeping the same type if it was provided in selectedExpert
        this.expertQueue.push({
          pubkey: expertPubkey,
          type: selectedExpert?.type
        });
        return false;
      }
      
      // Send job to worker
      await this.sendJobToWorker(workerId, expert);
      
      // Update expert state
      this.expertStates.set(expertPubkey, {
        pubkey: expertPubkey,
        state: "starting",
        workerId,
        timestamp: Date.now(),
      });
            
      // Clear any job timer
      if (worker.jobTimer) {
        clearTimeout(worker.jobTimer);
        worker.jobTimer = undefined;
      }
      
      return true;
    } catch (error) {
      debugError(`Error assigning job to worker ${workerId}:`, error);
      return false;
    }
  }

  /**
   * Send a job to a worker
   *
   * @param workerId Worker ID
   * @param expert Expert to start
   */
  private async sendJobToWorker(
    workerId: string,
    expert: DBExpert
  ): Promise<void> {
    const worker = this.workers.get(workerId);
    if (!worker) {
      return;
    }

    debugScheduler(
      `Sending job for expert ${expert.pubkey} to worker ${workerId}`
    );

    try {
      // Get the wallet for this expert to get the NWC string
      const wallet = await this.db.getWallet(expert.wallet_id || "");

      if (!wallet) {
        debugError(
          `Wallet ${expert.wallet_id} not found for expert ${expert.pubkey}`
        );
        return;
      }

      // Create job message
      const message: SchedulerToWorkerMessage = {
        type: "job",
        data: {
          expert_pubkey: expert.pubkey,
          expert_object: expert,
          nwc_string: wallet.nwc,
        },
      };

      // Send message to worker
      this.sendMessageToWorker(workerId, message);

      // Set a timer to check if the expert starts within 60 seconds
      const timer = setTimeout(async () => {
        debugScheduler(
          `Start timeout for expert ${expert.pubkey} on worker ${workerId}`
        );

        // Check if the expert is still in 'starting' state
        const expertState = this.expertStates.get(expert.pubkey);
        if (
          expertState &&
          expertState.state === "starting" &&
          expertState.workerId === workerId
        ) {
          debugScheduler(
            `Expert ${expert.pubkey} failed to start within timeout, requeuing`
          );

          // Update expert state to 'queued'
          this.expertStates.set(expert.pubkey, {
            pubkey: expert.pubkey,
            state: "queued",
            timestamp: Date.now(),
          });

          // Add expert back to the queue with type information
          this.expertQueue.push({
            pubkey: expert.pubkey,
            type: expert.type
          });
        }

        // Remove the timer
        this.startTimers.delete(expert.pubkey);
      }, 60000); // 60 second timeout

      // Store the timer
      this.startTimers.set(expert.pubkey, timer);
    } catch (error) {
      debugError(
        `Error sending job to worker ${workerId} for expert ${expert.pubkey}:`,
        error
      );
    }
  }

  /**
   * Send a no_job message to a worker
   *
   * @param workerId Worker ID
   */
  private sendNoJobMessage(workerId: string): void {
    const worker = this.workers.get(workerId);
    if (!worker) {
      return;
    }

    debugScheduler(`Sending no_job message to worker ${workerId}`);

    // Create no_job message
    const message: SchedulerToWorkerMessage = {
      type: "no_job",
      data: {},
    };

    // Send message to worker
    this.sendMessageToWorker(workerId, message);

    // Mark worker as no longer needing a job
    worker.needsJob = false;

    // Clear any job timer
    if (worker.jobTimer) {
      clearTimeout(worker.jobTimer);
      worker.jobTimer = undefined;
    }
  }

  /**
   * Send a stop message to a worker
   *
   * @param expertPubkey Expert pubkey
   */
  public stopExpert(expertPubkey: string): void {
    const expertState = this.expertStates.get(expertPubkey);
    if (!expertState || !expertState.workerId) {
      debugScheduler(`Expert ${expertPubkey} is not running, cannot stop`);
      return;
    }

    const workerId = expertState.workerId;
    const worker = this.workers.get(workerId);
    if (!worker) {
      debugScheduler(
        `Worker ${workerId} for expert ${expertPubkey} not found, cannot stop`
      );
      return;
    }

    debugScheduler(
      `Sending stop message for expert ${expertPubkey} to worker ${workerId}`
    );

    // Update expert state
    this.expertStates.set(expertPubkey, {
      ...expertState,
      state: "stopping",
      timestamp: Date.now(),
    });

    // Send stop message to worker
    this.sendStopMessageToWorker(workerId, expertPubkey);
  }

  /**
   * Send a stop message to a specific worker for a specific expert
   *
   * @param workerId Worker ID
   * @param expertPubkey Expert pubkey
   */
  private sendStopMessageToWorker(
    workerId: string,
    expertPubkey: string
  ): void {
    const worker = this.workers.get(workerId);
    if (!worker) {
      return;
    }

    debugScheduler(
      `Sending stop message for expert ${expertPubkey} to worker ${workerId}`
    );

    // Create stop message
    const message: SchedulerToWorkerMessage = {
      type: "stop",
      data: {
        expert: expertPubkey,
      },
    };

    // Send message to worker
    this.sendMessageToWorker(workerId, message);
  }

  /**
   * Send a restart message to a specific worker for a specific expert
   *
   * @param workerId Worker ID
   * @param expertPubkey Expert pubkey
   */
  private async sendRestartMessageToWorker(
    workerId: string,
    expertPubkey: string
  ): Promise<void> {
    const worker = this.workers.get(workerId);
    if (!worker) {
      return;
    }

    debugScheduler(
      `Sending restart message for expert ${expertPubkey} to worker ${workerId}`
    );

    try {
      // Get the expert from the database
      const expert = await this.db.getExpert(expertPubkey);
      if (!expert) {
        debugError(`Expert ${expertPubkey} not found in database for restart`);
        return;
      }

      // Get the wallet for this expert to get the NWC string
      const wallet = await this.db.getWallet(expert.wallet_id || "");
      if (!wallet) {
        debugError(
          `Wallet ${expert.wallet_id} not found for expert ${expertPubkey} for restart`
        );
        return;
      }

      // Create restart message with expert object and NWC string
      const message: SchedulerToWorkerMessage = {
        type: "restart",
        data: {
          expert: expertPubkey,
          expert_object: expert,
          nwc_string: wallet.nwc,
        },
      };

      // Send message to worker
      this.sendMessageToWorker(workerId, message);

      // Set a timer to check if the expert restarts within 60 seconds
      const timer = setTimeout(async () => {
        debugScheduler(
          `Restart timeout for expert ${expertPubkey} on worker ${workerId}`
        );

        // Check if the expert is still in 'starting' state
        const expertState = this.expertStates.get(expertPubkey);
        if (
          expertState &&
          expertState.state === "starting" &&
          expertState.workerId === workerId
        ) {
          debugScheduler(
            `Expert ${expertPubkey} failed to restart within timeout, requeuing`
          );

          // Update expert state to 'queued'
          this.expertStates.set(expertPubkey, {
            pubkey: expertPubkey,
            state: "queued",
            timestamp: Date.now(),
          });

          // Get the expert from the database to get its type
          try {
            const expertObj = await this.db.getExpert(expertPubkey);
            // Add expert back to the queue with type information
            this.expertQueue.push({
              pubkey: expertPubkey,
              type: expertObj?.type
            });
          } catch (error) {
            debugError(`Error fetching expert type for requeuing ${expertPubkey}:`, error);
            // Add without type information if we couldn't get it
            this.expertQueue.push({
              pubkey: expertPubkey
            });
          }
        }

        // Remove the timer
        this.startTimers.delete(expertPubkey);
      }, 60000); // 60 second timeout

      // Store the timer
      this.startTimers.set(expertPubkey, timer);
    } catch (error) {
      debugError(
        `Error sending restart message for expert ${expertPubkey}:`,
        error
      );
    }
  }

  /**
   * Send a message to a worker
   *
   * @param workerId Worker ID
   * @param message Message to send
   */
  private sendMessageToWorker(
    workerId: string,
    message: SchedulerToWorkerMessage
  ): void {
    const worker = this.workers.get(workerId);
    if (!worker) {
      return;
    }

    try {
      worker.socket.send(JSON.stringify(message));
    } catch (error) {
      debugError(`Error sending message to worker ${workerId}:`, error);
    }
  }

  /**
   * Check if an expert is running
   *
   * @param pubkey Expert pubkey
   * @returns True if the expert is running, false otherwise
   */
  public isExpertRunning(pubkey: string): boolean {
    const expertState = this.expertStates.get(pubkey);
    return expertState?.state === "started";
  }

  /**
   * Get the current state of an expert
   *
   * @param pubkey Expert pubkey
   * @returns Expert state info, or undefined if not found
   */
  public getExpertState(pubkey: string): ExpertStateInfo | undefined {
    return this.expertStates.get(pubkey);
  }

  /**
   * Get all expert states
   *
   * @returns Map of expert pubkeys to state info
   */
  public getAllExpertStates(): Map<string, ExpertStateInfo> {
    return new Map(this.expertStates);
  }

  /**
   * Get the number of queued experts
   *
   * @returns Number of queued experts
   */
  public getQueueLength(): number {
    return this.expertQueue.length;
  }

  /**
   * Get the number of connected workers
   *
   * @returns Number of connected workers
   */
  public getWorkerCount(): number {
    return this.workers.size;
  }

  /**
   * Resource cleanup
   */
  [Symbol.dispose](): void {
    this.stop().catch((error) => {
      debugError("Error stopping scheduler:", error);
    });
  }

  /**
   * Async resource cleanup
   */
  async [Symbol.asyncDispose](): Promise<void> {
    await this.stop();
  }
}
