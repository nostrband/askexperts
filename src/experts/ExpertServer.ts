import express, { Request, Response, NextFunction } from "express";
import cors from "cors";
import * as http from "http";
import { z } from "zod";
import { debugClient, debugError } from "../common/debug.js";
import type { ExpertClient } from "./ExpertClient.js";
import type { DBExpert } from "../db/interfaces.js";
import { getExpertClient } from "./ExpertRemoteClient.js";
import { ExpertServerPerms } from "./interfaces.js";
import { parseAuthToken, AuthRequest } from "../common/auth.js";

/**
 * Configuration options for ExpertServer
 */
export interface ExpertServerOptions {
  /** Port to listen on */
  port: number;
  /** Base path for the API (e.g., '/api') */
  basePath?: string;
  /** Server origin for auth token validation (e.g. 'https://yourdomain.com') */
  origin?: string;
  /** Optional permissions interface for authentication and authorization */
  perms?: ExpertServerPerms;
}

/**
 * ExpertServer class that provides an HTTP API for ExpertClient operations
 */
export class ExpertServer {
  private app: express.Application;
  private port: number;
  private basePath: string;
  private stopped = true;
  private server?: http.Server;
  private expertClient: ExpertClient;
  private perms?: ExpertServerPerms;
  private serverOrigin: string;

  /**
   * Creates a new ExpertServer instance
   *
   * @param options - Configuration options or port number (for backward compatibility)
   * @param basePath - Base path for the API (e.g., '/api') when using port number constructor
   */
  constructor(options: ExpertServerOptions) {
    // New constructor with options object
    this.port = options.port;
    this.basePath = options.basePath
      ? options.basePath.startsWith("/")
        ? options.basePath
        : `/${options.basePath}`
      : "";
    this.perms = options.perms;
    this.serverOrigin = options.origin || `http://localhost:${this.port}`;

    // Get the expert client
    this.expertClient = getExpertClient();

    // Create the Express app
    this.app = express();

    // Configure middleware
    this.app.use(cors());
    this.app.use(express.json({ limit: "1mb" }));

    // Add authentication middleware if perms is provided
    if (this.perms) {
      this.app.use(this.authMiddleware.bind(this));
    }

    // Set up routes
    this.setupRoutes();
  }

  /**
   * Authentication middleware
   * Parses the auth token and checks permissions
   */
  private async authMiddleware(
    req: Request,
    res: Response,
    next: NextFunction
  ): Promise<void> {
    try {
      // Convert the request to AuthRequest
      const authReq: AuthRequest = {
        headers: req.headers,
        method: req.method,
        originalUrl: req.originalUrl,
        rawBody: req.body ? Buffer.from(JSON.stringify(req.body)) : undefined,
      };

      // Parse the auth token
      const pubkey = await parseAuthToken(this.serverOrigin, authReq);

      // If pubkey is empty, authentication failed
      if (!pubkey) {
        debugError("Authentication failed: Invalid or missing token");
        res
          .status(401)
          .json({
            error: "Unauthorized",
            message: "Invalid or missing authentication token",
          });
        return;
      }

      // Store the pubkey in the request for later use
      (req as any).pubkey = pubkey;

      // Check permissions if perms is provided
      if (this.perms) {
        try {
          await this.perms.checkPerms(pubkey, req);
        } catch (error) {
          const errorMessage =
            error instanceof Error
              ? error.message
              : "Permission denied for this operation";
          debugError(`Permission check error: ${errorMessage}`);
          res.status(403).json({ error: "Forbidden", message: errorMessage });
          return;
        }
      }

      // Authentication and authorization successful, proceed to the route handler
      next();
    } catch (error) {
      debugError("Authentication error:", error);
      res
        .status(500)
        .json({
          error: "Internal Server Error",
          message: "Authentication error",
        });
    }
  }

  /**
   * Sets up the API routes
   * @private
   */
  private setupRoutes(): void {
    // Add a leading slash if basePath is not empty
    const path = this.basePath
      ? this.basePath.endsWith("/")
        ? this.basePath
        : `${this.basePath}/`
      : "/";

    // Health check endpoint
    this.app.get(`${path}health`, (req: Request, res: Response) => {
      if (this.stopped) res.status(503).json({ error: "Service unavailable" });
      else res.status(200).json({ status: "ok" });
    });

    // List experts endpoint
    this.app.get(`${path}experts`, this.handleListExperts.bind(this));

    // Get expert endpoint
    this.app.get(`${path}experts/:pubkey`, this.handleGetExpert.bind(this));

    // Insert expert endpoint
    this.app.post(`${path}experts`, this.handleInsertExpert.bind(this));

    // Update expert endpoint
    this.app.put(`${path}experts/:pubkey`, this.handleUpdateExpert.bind(this));

    // Set expert disabled status endpoint
    this.app.patch(
      `${path}experts/:pubkey/disabled`,
      this.handleSetExpertDisabled.bind(this)
    );

    // Delete expert endpoint
    this.app.delete(
      `${path}experts/:pubkey`,
      this.handleDeleteExpert.bind(this)
    );
  }

  /**
   * Handles requests to list all experts
   *
   * @param req - Express request object
   * @param res - Express response object
   * @private
   */
  private async handleListExperts(req: Request, res: Response): Promise<void> {
    if (this.stopped) {
      res.status(503).json({ error: "Service unavailable" });
      return;
    }

    try {
      const experts = await this.expertClient.listExperts();
      res.status(200).json(experts);
    } catch (error) {
      debugError("Error handling list experts request:", error);
      const message = error instanceof Error ? error.message : String(error);
      res.status(500).json({
        error: "Internal server error",
        message: message,
      });
    }
  }

  /**
   * Handles requests to get an expert by pubkey
   *
   * @param req - Express request object
   * @param res - Express response object
   * @private
   */
  private async handleGetExpert(req: Request, res: Response): Promise<void> {
    if (this.stopped) {
      res.status(503).json({ error: "Service unavailable" });
      return;
    }

    try {
      const pubkey = req.params.pubkey;
      if (!pubkey) {
        res.status(400).json({ error: "Missing pubkey parameter" });
        return;
      }

      const expert = await this.expertClient.getExpert(pubkey);
      if (!expert) {
        res.status(404).json({ error: "Expert not found" });
        return;
      }

      res.status(200).json(expert);
    } catch (error) {
      debugError("Error handling get expert request:", error);
      const message = error instanceof Error ? error.message : String(error);
      res.status(500).json({
        error: "Internal server error",
        message: message,
      });
    }
  }

  /**
   * Handles requests to insert a new expert
   *
   * @param req - Express request object
   * @param res - Express response object
   * @private
   */
  private async handleInsertExpert(req: Request, res: Response): Promise<void> {
    if (this.stopped) {
      res.status(503).json({ error: "Service unavailable" });
      return;
    }

    try {
      const expert = req.body as DBExpert;
      if (!expert || !expert.pubkey) {
        res.status(400).json({ error: "Invalid expert data" });
        return;
      }

      const success = await this.expertClient.insertExpert(expert);
      if (success) {
        res.status(201).json({ success: true });
      } else {
        res.status(400).json({ error: "Failed to insert expert" });
      }
    } catch (error) {
      debugError("Error handling insert expert request:", error);
      const message = error instanceof Error ? error.message : String(error);
      res.status(500).json({
        error: "Internal server error",
        message: message,
      });
    }
  }

  /**
   * Handles requests to update an existing expert
   *
   * @param req - Express request object
   * @param res - Express response object
   * @private
   */
  private async handleUpdateExpert(req: Request, res: Response): Promise<void> {
    if (this.stopped) {
      res.status(503).json({ error: "Service unavailable" });
      return;
    }

    try {
      const pubkey = req.params.pubkey;
      if (!pubkey) {
        res.status(400).json({ error: "Missing pubkey parameter" });
        return;
      }

      const expert = req.body as DBExpert;
      if (!expert) {
        res.status(400).json({ error: "Invalid expert data" });
        return;
      }

      // Ensure the pubkey in the URL matches the pubkey in the body
      if (expert.pubkey !== pubkey) {
        res.status(400).json({ error: "Pubkey mismatch" });
        return;
      }

      const success = await this.expertClient.updateExpert(expert);
      if (success) {
        res.status(200).json({ success: true });
      } else {
        res.status(404).json({ error: "Expert not found" });
      }
    } catch (error) {
      debugError("Error handling update expert request:", error);
      const message = error instanceof Error ? error.message : String(error);
      res.status(500).json({
        error: "Internal server error",
        message: message,
      });
    }
  }

  /**
   * Handles requests to set the disabled status of an expert
   *
   * @param req - Express request object
   * @param res - Express response object
   * @private
   */
  private async handleSetExpertDisabled(
    req: Request,
    res: Response
  ): Promise<void> {
    if (this.stopped) {
      res.status(503).json({ error: "Service unavailable" });
      return;
    }

    try {
      const pubkey = req.params.pubkey;
      if (!pubkey) {
        res.status(400).json({ error: "Missing pubkey parameter" });
        return;
      }

      const { disabled } = req.body;
      if (disabled === undefined) {
        res.status(400).json({ error: "Missing disabled parameter" });
        return;
      }

      const success = await this.expertClient.setExpertDisabled(
        pubkey,
        disabled
      );
      if (success) {
        res.status(200).json({ success: true });
      } else {
        res.status(404).json({ error: "Expert not found" });
      }
    } catch (error) {
      debugError("Error handling set expert disabled request:", error);
      const message = error instanceof Error ? error.message : String(error);
      res.status(500).json({
        error: "Internal server error",
        message: message,
      });
    }
  }

  /**
   * Handles requests to delete an expert
   *
   * @param req - Express request object
   * @param res - Express response object
   * @private
   */
  private async handleDeleteExpert(req: Request, res: Response): Promise<void> {
    if (this.stopped) {
      res.status(503).json({ error: "Service unavailable" });
      return;
    }

    try {
      const pubkey = req.params.pubkey;
      if (!pubkey) {
        res.status(400).json({ error: "Missing pubkey parameter" });
        return;
      }

      const success = await this.expertClient.deleteExpert(pubkey);
      if (success) {
        res.status(200).json({ success: true });
      } else {
        res.status(404).json({ error: "Expert not found" });
      }
    } catch (error) {
      debugError("Error handling delete expert request:", error);
      const message = error instanceof Error ? error.message : String(error);
      res.status(500).json({
        error: "Internal server error",
        message: message,
      });
    }
  }

  /**
   * Starts the server
   *
   * @returns Promise that resolves when the server is started
   */
  async start(): Promise<void> {
    if (this.server) throw new Error("Already started");
    this.stopped = false;
    this.server = this.app.listen(this.port);
    debugClient(
      `Expert Server running at http://localhost:${this.port}${this.basePath}`
    );
  }

  /**
   * Stops the server
   *
   * @returns Promise that resolves when the server is stopped
   */
  stop(): Promise<void> {
    return new Promise<void>(async (resolve) => {
      // Mark as stopped
      this.stopped = true;

      if (!this.server) {
        resolve();
        return;
      }

      debugError("Server stopping...");

      // Stop accepting new connections
      const closePromise = new Promise((ok) => this.server!.close(ok));

      // Wait until all connections are closed with timeout
      let to;
      await Promise.race([
        closePromise,
        new Promise((ok) => (to = setTimeout(ok, 5000))),
      ]);
      clearTimeout(to);

      debugError("Server stopped");
      resolve();
    });
  }
}
