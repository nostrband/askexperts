import express, { Request, Response, NextFunction } from "express";
import cors from "cors";
import * as http from "http";
import { debugClient, debugError } from "../common/debug.js";
import type { WalletClient } from "./WalletClient.js";
import type { DBWallet } from "../db/interfaces.js";
import { parseAuthToken, AuthRequest } from "../common/auth.js";
import { getDB } from "../db/utils.js";

/**
 * Interface for wallet server permissions
 */
export interface WalletServerPerms {
  /**
   * Check if the user has permission to perform the requested operation
   * @param user_id - User ID
   * @param req - Express request object
   * @returns Promise that resolves with optional listIds if the user has permission, rejects otherwise
   */
  checkPerms(user_id: string, req: Request): Promise<{ listIds?: string[] }>;

  /**
   * Get the user ID associated with a public key
   * @param pubkey - Public key of the user
   * @returns Promise that resolves with the user ID
   */
  getUserId(pubkey: string): Promise<string>;
}

/**
 * Configuration options for WalletServer
 */
export interface WalletServerOptions {
  /** Port to listen on */
  port: number;
  /** Base path for the API (e.g., '/api') */
  basePath?: string;
  /** Server origin for auth token validation (e.g. 'https://yourdomain.com') */
  origin?: string;
  /** Optional permissions interface for authentication and authorization */
  perms?: WalletServerPerms;
}

/**
 * WalletServer class that provides an HTTP API for WalletClient operations
 */
export class WalletServer {
  private app: express.Application;
  private port: number;
  private basePath: string;
  private stopped = true;
  private server?: http.Server;
  private walletClient: WalletClient;
  private perms?: WalletServerPerms;
  private serverOrigin: string;

  /**
   * Creates a new WalletServer instance
   *
   * @param options - Configuration options
   */
  constructor(options: WalletServerOptions) {
    this.port = options.port;
    this.basePath = options.basePath
      ? options.basePath.startsWith("/")
        ? options.basePath
        : `/${options.basePath}`
      : "";
    this.perms = options.perms;
    this.serverOrigin = options.origin || `http://localhost:${this.port}`;

    // Get the wallet client
    this.walletClient = getDB();

    // Create the Express app
    this.app = express();

    // Configure middleware
    this.app.use(cors());
    this.app.use(
      express.json({
        limit: "1mb",
        verify: (req: http.IncomingMessage, res, buf) => {
          (req as any).rawBody = buf;
        },
      })
    );

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
        rawBody: (req as any).rawBody,
      };

      // Parse the auth token
      const pubkey = await parseAuthToken(this.serverOrigin, authReq);

      // If pubkey is empty, authentication failed
      if (!pubkey) {
        debugError("Authentication failed: Invalid or missing token");
        res.status(401).json({
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
          // Get user_id and store it in the request
          const user_id = await this.perms.getUserId(pubkey);
          (req as any).user_id = user_id;

          const permsResult = await this.perms.checkPerms(user_id, req);
          // Store the perms result in the request for later use
          (req as any).perms = permsResult;
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
      res.status(500).json({
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

    // List wallets endpoint
    this.app.get(`${path}wallets`, this.handleListWallets.bind(this));

    // Get wallet by ID endpoint
    this.app.get(`${path}wallets/:id`, this.handleGetWallet.bind(this));

    // Get wallet by name endpoint
    this.app.get(
      `${path}wallets/name/:name`,
      this.handleGetWalletByName.bind(this)
    );

    // Get default wallet endpoint
    this.app.get(
      `${path}wallets/default`,
      this.handleGetDefaultWallet.bind(this)
    );

    // Insert wallet endpoint
    this.app.post(`${path}wallets`, this.handleInsertWallet.bind(this));

    // Update wallet endpoint
    this.app.put(`${path}wallets/:id`, this.handleUpdateWallet.bind(this));

    // Delete wallet endpoint
    this.app.delete(`${path}wallets/:id`, this.handleDeleteWallet.bind(this));
  }

  /**
   * Handles requests to list all wallets
   *
   * @param req - Express request object
   * @param res - Express response object
   * @private
   */
  private async handleListWallets(req: Request, res: Response): Promise<void> {
    if (this.stopped) {
      res.status(503).json({ error: "Service unavailable" });
      return;
    }

    try {
      let wallets;

      // Check if we have listIds in the perms object
      if ((req as any).perms?.listIds !== undefined) {
        // Use the listWalletsByIds method with the provided string IDs
        wallets = await this.walletClient.listWalletsByIds((req as any).perms.listIds);
      } else {
        // Use the regular listWallets method
        wallets = await this.walletClient.listWallets();
      }

      res.status(200).json(wallets);
    } catch (error) {
      debugError("Error handling list wallets request:", error);
      const message = error instanceof Error ? error.message : String(error);
      res.status(500).json({
        error: "Internal server error",
        message: message,
      });
    }
  }

  /**
   * Handles requests to get a wallet by ID
   *
   * @param req - Express request object
   * @param res - Express response object
   * @private
   */
  private async handleGetWallet(req: Request, res: Response): Promise<void> {
    if (this.stopped) {
      res.status(503).json({ error: "Service unavailable" });
      return;
    }

    try {
      const id = req.params.id;
      if (!id) {
        res.status(400).json({ error: "Invalid wallet ID" });
        return;
      }

      const wallet = await this.walletClient.getWallet(id);
      if (!wallet) {
        res.status(404).json({ error: "Wallet not found" });
        return;
      }

      res.status(200).json(wallet);
    } catch (error) {
      debugError("Error handling get wallet request:", error);
      const message = error instanceof Error ? error.message : String(error);
      res.status(500).json({
        error: "Internal server error",
        message: message,
      });
    }
  }

  /**
   * Handles requests to get a wallet by name
   *
   * @param req - Express request object
   * @param res - Express response object
   * @private
   */
  private async handleGetWalletByName(
    req: Request,
    res: Response
  ): Promise<void> {
    if (this.stopped) {
      res.status(503).json({ error: "Service unavailable" });
      return;
    }

    try {
      const name = req.params.name;
      if (!name) {
        res.status(400).json({ error: "Missing wallet name" });
        return;
      }

      const wallet = await this.walletClient.getWalletByName(name);
      if (!wallet) {
        res.status(404).json({ error: "Wallet not found" });
        return;
      }

      res.status(200).json(wallet);
    } catch (error) {
      debugError("Error handling get wallet by name request:", error);
      const message = error instanceof Error ? error.message : String(error);
      res.status(500).json({
        error: "Internal server error",
        message: message,
      });
    }
  }

  /**
   * Handles requests to get the default wallet
   *
   * @param req - Express request object
   * @param res - Express response object
   * @private
   */
  private async handleGetDefaultWallet(
    req: Request,
    res: Response
  ): Promise<void> {
    if (this.stopped) {
      res.status(503).json({ error: "Service unavailable" });
      return;
    }

    try {
      const wallet = await this.walletClient.getDefaultWallet();
      if (!wallet) {
        res.status(404).json({ error: "Default wallet not found" });
        return;
      }

      res.status(200).json(wallet);
    } catch (error) {
      debugError("Error handling get default wallet request:", error);
      const message = error instanceof Error ? error.message : String(error);
      res.status(500).json({
        error: "Internal server error",
        message: message,
      });
    }
  }

  /**
   * Handles requests to insert a new wallet
   *
   * @param req - Express request object
   * @param res - Express response object
   * @private
   */
  private async handleInsertWallet(req: Request, res: Response): Promise<void> {
    if (this.stopped) {
      res.status(503).json({ error: "Service unavailable" });
      return;
    }

    try {
      const wallet = req.body as Omit<DBWallet, "id">;
      if (!wallet || !wallet.name || !wallet.nwc) {
        res.status(400).json({ error: "Invalid wallet data" });
        return;
      }

      // Use user_id from the request object if available
      if ((req as any).user_id) {
        wallet.user_id = (req as any).user_id;
      }

      const id = await this.walletClient.insertWallet(wallet);
      res.status(201).json({ id });
    } catch (error) {
      debugError("Error handling insert wallet request:", error);
      const message = error instanceof Error ? error.message : String(error);
      res.status(500).json({
        error: "Internal server error",
        message: message,
      });
    }
  }

  /**
   * Handles requests to update an existing wallet
   *
   * @param req - Express request object
   * @param res - Express response object
   * @private
   */
  private async handleUpdateWallet(req: Request, res: Response): Promise<void> {
    if (this.stopped) {
      res.status(503).json({ error: "Service unavailable" });
      return;
    }

    try {
      const id = req.params.id;
      if (!id) {
        res.status(400).json({ error: "Invalid wallet ID" });
        return;
      }

      const wallet = req.body as DBWallet;
      if (!wallet) {
        res.status(400).json({ error: "Invalid wallet data" });
        return;
      }

      // Ensure the ID in the URL matches the ID in the body
      if (wallet.id !== id) {
        res.status(400).json({ error: "ID mismatch" });
        return;
      }

      // Use user_id from the request object if available
      if ((req as any).user_id) {
        wallet.user_id = (req as any).user_id;
      }

      const success = await this.walletClient.updateWallet(wallet);
      if (success) {
        res.status(200).json({ success: true });
      } else {
        res.status(404).json({ error: "Wallet not found" });
      }
    } catch (error) {
      debugError("Error handling update wallet request:", error);
      const message = error instanceof Error ? error.message : String(error);
      res.status(500).json({
        error: "Internal server error",
        message: message,
      });
    }
  }

  /**
   * Handles requests to delete a wallet
   *
   * @param req - Express request object
   * @param res - Express response object
   * @private
   */
  private async handleDeleteWallet(req: Request, res: Response): Promise<void> {
    if (this.stopped) {
      res.status(503).json({ error: "Service unavailable" });
      return;
    }

    try {
      const id = req.params.id;
      if (!id) {
        res.status(400).json({ error: "Invalid wallet ID" });
        return;
      }

      const success = await this.walletClient.deleteWallet(id);
      if (success) {
        res.status(200).json({ success: true });
      } else {
        res.status(404).json({ error: "Wallet not found" });
      }
    } catch (error) {
      debugError("Error handling delete wallet request:", error);
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
      `Wallet Server running at http://localhost:${this.port}${this.basePath}`
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
