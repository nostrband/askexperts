import WebSocket from "ws";
import { SimplePool } from "nostr-tools";
import { ExpertWorker } from "./ExpertWorker.js";
import { DBExpert } from "../../db/interfaces.js";
import {
  WorkerToSchedulerMessage,
  SchedulerToWorkerMessage,
  SchedulerToWorkerMessages,
} from "../scheduler/interfaces.js";
import { debugError, debug } from "../../common/debug.js";
import { generateUUID } from "../../common/uuid.js";

// Create a debug function for the worker
const debugWorker = debug("askexperts:remoteworker");

/**
 * Configuration options for ExpertRemoteWorker
 */
export interface ExpertRemoteWorkerOptions {
  /** URL of the scheduler to connect to */
  schedulerUrl: string;
  /** SimplePool instance for Nostr communication */
  pool: SimplePool;
  /** Host for RAG database */
  ragHost?: string;
  /** Port for RAG database */
  ragPort?: number;
  /** Reconnection delay in milliseconds (default: 5000) */
  reconnectDelay?: number;
  /** Default docstore url */
  defaultDocStoreUrl?: string;
  /** Expert types this worker will handle (if specified) */
  expert_types?: string[];
}

/**
 * ExpertRemoteWorker class for connecting to an ExpertScheduler
 * and running experts as directed
 */
export class ExpertRemoteWorker {
  private options: ExpertRemoteWorkerOptions;
  private worker: ExpertWorker;
  private socket: WebSocket | null = null;
  private reconnectTimer: NodeJS.Timeout | null = null;
  private connected: boolean = false;
  private stopping: boolean = false;

  // Worker ID
  private workerId: string;
  
  // Expert types filter
  private expert_types?: string[];

  /**
   * Create a new ExpertRemoteWorker
   *
   * @param options Configuration options
   */
  constructor(options: ExpertRemoteWorkerOptions) {
    this.options = {
      reconnectDelay: 5000,
      ...options,
    };

    // Generate a unique worker ID
    this.workerId = generateUUID();
    
    // Store expert types filter if provided
    this.expert_types = options.expert_types;

    // Create ExpertWorker instance
    this.worker = new ExpertWorker(
      options.pool,
      options.ragHost,
      options.ragPort,
      options.defaultDocStoreUrl
    );

    debugWorker(
      `ExpertRemoteWorker initialized with ID ${this.workerId} and scheduler URL: ${options.schedulerUrl}`
    );
  }

  /**
   * Start the worker
   */
  public async start(): Promise<void> {
    this.stopping = false;
    await this.connect();
  }

  /**
   * Stop the worker
   */
  public async stop(): Promise<void> {
    this.stopping = true;

    // Clear reconnect timer if it exists
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }

    // Close WebSocket connection if it exists
    if (this.socket) {
      this.socket.close();
      this.socket = null;
    }

    // Dispose the worker
    await this.worker[Symbol.asyncDispose]();

    debugWorker("ExpertRemoteWorker stopped");
  }

  /**
   * Connect to the scheduler
   */
  private async connect(): Promise<void> {
    if (this.stopping) {
      return;
    }

    try {
      debugWorker(`Connecting to scheduler at ${this.options.schedulerUrl}`);

      // Create WebSocket connection
      this.socket = new WebSocket(this.options.schedulerUrl);

      // Set up event handlers
      this.socket.on("open", this.handleOpen.bind(this));
      this.socket.on("message", this.handleMessage.bind(this));
      this.socket.on("close", this.handleClose.bind(this));
      this.socket.on("error", this.handleError.bind(this));
    } catch (error) {
      debugError("Error connecting to scheduler:", error);
      this.scheduleReconnect();
    }
  }

  /**
   * Handle WebSocket open event
   */
  private async handleOpen() {
    debugWorker("Connected to scheduler");
    this.connected = true;

    // Send list of running experts
    this.sendExpertsList();

    // Request a job
    this.requestJob();
  }

  /**
   * Handle WebSocket message event
   *
   * @param data Message data
   */
  private handleMessage(data: WebSocket.Data): void {
    try {
      const message = JSON.parse(data.toString()) as SchedulerToWorkerMessage;

      debugWorker(`Received ${message.type} message from scheduler`);

      // Handle message based on type
      switch (message.type) {
        case "job":
          this.handleJobMessage(message.data);
          break;

        case "no_job":
          this.handleNoJobMessage();
          break;

        case "stop":
          this.handleStopMessage(message.data.expert);
          break;
          
        case "restart":
          this.handleRestartMessage(message.data);
          break;

        default:
          debugError(`Unknown message type: ${(message as any).type}`);
      }
    } catch (error) {
      debugError("Error parsing scheduler message:", error);
    }
  }

  /**
   * Handle WebSocket close event
   */
  private handleClose(): void {
    if (this.connected) {
      debugWorker("Disconnected from scheduler");
      this.connected = false;
    }

    if (!this.stopping) {
      this.scheduleReconnect();
    }
  }

  /**
   * Handle WebSocket error event
   *
   * @param error Error object
   */
  private handleError(error: Error): void {
    debugError("WebSocket error:", error);

    // Close the connection if it's still open
    if (this.socket && this.socket.readyState === WebSocket.OPEN) {
      this.socket.close();
    }
  }

  /**
   * Schedule a reconnection attempt
   */
  private scheduleReconnect(): void {
    if (this.stopping) {
      return;
    }

    // Clear any existing reconnect timer
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
    }

    // Set a new reconnect timer
    this.reconnectTimer = setTimeout(() => {
      debugWorker("Attempting to reconnect to scheduler");
      this.connect();
    }, this.options.reconnectDelay);

    debugWorker(`Scheduled reconnect in ${this.options.reconnectDelay}ms`);
  }

  /**
   * Send a message to the scheduler
   *
   * @param message Message to send
   */
  private sendMessage(message: WorkerToSchedulerMessage): void {
    if (!this.socket || this.socket.readyState !== WebSocket.OPEN) {
      debugError("Cannot send message, not connected to scheduler");
      return;
    }

    try {
      this.socket.send(JSON.stringify(message));
    } catch (error) {
      debugError("Error sending message to scheduler:", error);
    }
  }

  /**
   * Send a list of running experts to the scheduler
   */
  private sendExpertsList(): void {
    const runningExperts = this.worker.getRunningExpertPubkeys();

    debugWorker(
      `Sending list of ${runningExperts.length} running experts to scheduler`
    );

    const message: WorkerToSchedulerMessage = {
      type: "experts",
      data: {
        workerId: this.workerId,
        experts: runningExperts,
      },
    };

    this.sendMessage(message);
  }

  /**
   * Request a job from the scheduler
   */
  private requestJob(): void {
    debugWorker("Requesting job from scheduler");

    const message: WorkerToSchedulerMessage = {
      type: "need_job",
      data: {
        workerId: this.workerId,
        expert_types: this.expert_types,
      },
    };

    this.sendMessage(message);
  }

  /**
   * Handle a job message from the scheduler
   *
   * @param job Job data
   */
  private async handleJobMessage(
    job: SchedulerToWorkerMessages["job"]
  ): Promise<void> {
    const expertPubkey = job.expert_pubkey;
    debugWorker(`Received job for expert ${expertPubkey}`);

    try {
      // Check if the expert is already running
      const runningExperts = this.worker.getRunningExpertPubkeys();
      const existingExpert = runningExperts.includes(expertPubkey);
      if (existingExpert) {
        debugWorker(
          `Expert ${expertPubkey} is already running, not starting again`
        );
      } else {
        // Use the complete DBExpert object from the job message
        const expert: DBExpert = job.expert_object;

        // Start the expert using the NWC string from the job message
        await this.worker.startExpert(expert, job.nwc_string);
      }
      // Send started message
      const message: WorkerToSchedulerMessage = {
        type: "started",
        data: {
          workerId: this.workerId,
          expert: expertPubkey,
        },
      };
      this.sendMessage(message);

      // A small pause to avoid event-storming the relays etc
      if (!existingExpert) await new Promise((ok) => setTimeout(ok, 1000));

      // Request another job
      this.requestJob();
    } catch (error) {
      debugError(`Error starting expert ${expertPubkey}:`, error);

      // Request another job
      this.requestJob();
    }
  }

  /**
   * Handle a no_job message from the scheduler
   */
  private handleNoJobMessage(): void {
    debugWorker("No jobs available from scheduler");

    // Request another job after a delay
    setTimeout(() => {
      this.requestJob();
    }, 5000); // 5 second delay
  }

  /**
   * Handle a stop message from the scheduler
   *
   * @param expertPubkey Expert pubkey to stop
   */
  private async handleStopMessage(expertPubkey: string) {
    debugWorker(`Received stop message for expert ${expertPubkey}`);

    try {
      // Stop the expert
      const stopped = await this.worker.stopExpert(expertPubkey);

      if (stopped) {
        // Send stopped message
        const message: WorkerToSchedulerMessage = {
          type: "stopped",
          data: {
            workerId: this.workerId,
            expert: expertPubkey,
          },
        };

        this.sendMessage(message);
      } else {
        debugError(`Expert ${expertPubkey} was not running, cannot stop`);
      }
    } catch (error) {
      debugError(`Error stopping expert ${expertPubkey}:`, error);
    }
  }

  /**
   * Handle a restart message from the scheduler
   *
   * @param data Restart message data containing expert pubkey, expert object, and NWC string
   */
  private async handleRestartMessage(data: SchedulerToWorkerMessages['restart']) {
    const expertPubkey = data.expert;
    const expertObject = data.expert_object;
    const nwcString = data.nwc_string;
    
    debugWorker(`Received restart message for expert ${expertPubkey}`);

    try {
      // First stop the expert
      const stopped = await this.worker.stopExpert(expertPubkey);
      
      if (stopped) {
        debugWorker(`Expert ${expertPubkey} stopped as part of restart`);
      } else {
        debugWorker(`Expert ${expertPubkey} was not running, proceeding with start`);
      }
      
      // Immediately start the expert with the provided expert object and NWC string
      debugWorker(`Starting expert ${expertPubkey} with updated configuration`);
      await this.worker.startExpert(expertObject, nwcString);
      
      // Send started message
      const startedMessage: WorkerToSchedulerMessage = {
        type: "started",
        data: {
          workerId: this.workerId,
          expert: expertPubkey,
        },
      };
      this.sendMessage(startedMessage);
      
      debugWorker(`Expert ${expertPubkey} restarted successfully`);
    } catch (error) {
      debugError(`Error restarting expert ${expertPubkey}:`, error);
    }
  }

  /**
   * Resource cleanup
   */
  [Symbol.dispose](): void {
    this.stop().catch((error) => {
      debugError("Error stopping remote worker:", error);
    });
  }

  /**
   * Async resource cleanup
   */
  async [Symbol.asyncDispose](): Promise<void> {
    await this.stop();
  }
}
