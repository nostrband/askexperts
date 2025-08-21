/**
 * Interfaces for the Expert Scheduler
 */
import WebSocket from 'ws';

/**
 * Expert state types
 */
export type ExpertState = 'queued' | 'starting' | 'started' | 'stopping' | 'stopped';

/**
 * Interface for expert state tracking
 */
export interface ExpertStateInfo {
  pubkey: string;
  state: ExpertState;
  workerId?: string;
  timestamp: number;
}

/**
 * Interface for worker connection tracking
 */
export interface WorkerConnection {
  id: string;
  socket: WebSocket;
  activeExperts: Set<string>;
  lastActivity: number;
  needsJob: boolean;
  ready: boolean;
  jobTimer?: NodeJS.Timeout;
}

/**
 * Message types from worker to scheduler
 */
export interface WorkerToSchedulerMessages {
  // Worker reports which experts it's running
  experts: {
    workerId: string;
    experts: string[];
  };
  
  // Worker requests a job
  need_job: {
    workerId: string;
  };
  
  // Worker confirms expert started
  started: {
    workerId: string;
    expert: string;
  };
  
  // Worker confirms expert stopped
  stopped: {
    workerId: string;
    expert: string;
  };
}

/**
 * Message types from scheduler to worker
 */
export interface SchedulerToWorkerMessages {
  // Scheduler sends a job to worker
  job: {
    expert_pubkey: string;  // The pubkey of the expert (for backward compatibility)
    expert_object: any;     // The complete DBExpert object
    nwc_string: string;     // NWC connection string
  };
  
  // Scheduler tells worker no jobs are available
  no_job: {
    // No additional fields
  };
  
  // Scheduler tells worker to stop an expert
  stop: {
    expert: string;
  };

  // Scheduler tells worker to restart an expert
  restart: {
    expert: string;
    expert_object: any;     // The complete updated DBExpert object
    nwc_string: string;     // NWC connection string
  };
}

/**
 * Union type for all messages from worker to scheduler
 */
export type WorkerToSchedulerMessage = 
  | { type: 'experts', data: WorkerToSchedulerMessages['experts'] }
  | { type: 'need_job', data: WorkerToSchedulerMessages['need_job'] }
  | { type: 'started', data: WorkerToSchedulerMessages['started'] }
  | { type: 'stopped', data: WorkerToSchedulerMessages['stopped'] };

/**
 * Union type for all messages from scheduler to worker
 */
export type SchedulerToWorkerMessage =
  | { type: 'job', data: SchedulerToWorkerMessages['job'] }
  | { type: 'no_job', data: SchedulerToWorkerMessages['no_job'] }
  | { type: 'stop', data: SchedulerToWorkerMessages['stop'] }
  | { type: 'restart', data: SchedulerToWorkerMessages['restart'] };