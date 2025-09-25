import express, { Request, Response, NextFunction } from "express";
import cors from "cors";
import * as http from "http";
import { debugServer, debugError } from "../common/debug.js";
import type { DBWallet, DBExpert } from "./interfaces.js";
import { parseAuthToken, AuthRequest, AuthTokenInfo } from "../common/auth.js";
import { getDB } from "./utils.js";
import { DB } from "./DB.js";
import { bytesToHex, hexToBytes } from "nostr-tools/utils";
import { getPublicKey } from "nostr-tools";
import { generateRandomKeyPair } from "../common/crypto.js";
import { LightningPaymentManager } from "../payments/LightningPaymentManager.js";
import { createWallet } from "../common/utils.js";

/**
 * Interface for DB server permissions
 */
export interface DBServerPerms {
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

  /**
   * Parse and validate a NIP-98 authentication token
   * @param origin - Origin URL for validation
   * @param req - Request object with headers and other properties
   * @returns Public key if token is valid, empty string otherwise
   */
  parseAuthToken(origin: string, req: AuthRequest): Promise<AuthTokenInfo>;
}

/**
 * Configuration options for DBServer
 */
export interface DBServerOptions {
  /** Port to listen on */
  port: number;
  /** Base path for the API (e.g., '/api') */
  basePath?: string;
  /** Server origin for auth token validation (e.g. 'https://yourdomain.com') */
  origin?: string;
  /** Optional permissions interface for authentication and authorization */
  perms?: DBServerPerms;
  /** Optional payment manager for bonus top-ups */
  paymentManager?: LightningPaymentManager;
  /** Optional bonus amount in sats for new external users */
  bonusAmountSats?: number;
}

/**
 * DBServer class that provides an HTTP API for DBInterface operations
 */
export class DBServer {
  private app: express.Application;
  private port: number;
  private basePath: string;
  private stopped = true;
  private server?: http.Server;
  private db: DB = getDB();
  private perms?: DBServerPerms;
  private serverOrigin: string;
  private paymentManager?: LightningPaymentManager;
  private bonusAmountSats?: number;

  /**
   * Creates a new DBServer instance
   *
   * @param options - Configuration options
   */
  constructor(options: DBServerOptions) {
    this.port = options.port;
    this.basePath = options.basePath
      ? options.basePath.startsWith("/")
        ? options.basePath
        : `/${options.basePath}`
      : "";
    this.perms = options.perms;
    this.serverOrigin = options.origin || `http://localhost:${this.port}`;
    this.paymentManager = options.paymentManager;
    this.bonusAmountSats = options.bonusAmountSats;

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

  public getApp() {
    return this.app;
  }

  public getDB() {
    return this.db;
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
        cookies: req.cookies,
        rawBody: (req as any).rawBody,
        req,
      };

      // Parse the auth token
      const { pubkey } = this.perms
        ? await this.perms.parseAuthToken(this.serverOrigin, authReq)
        : await parseAuthToken(this.serverOrigin, authReq);

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

      // Check if this is the signup endpoint - skip permission check for it
      const isSignupEndpoint = req.path.endsWith("/signup");

      // Check permissions if perms is provided
      if (this.perms && !isSignupEndpoint) {
        try {
          // Get user_id and store it in the request
          const user_id = await this.perms.getUserId(pubkey);
          (req as any).user_id = user_id;
          debugServer(`Request by user ${user_id} to ${req.path}`);

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

    // Signup endpoint
    this.app.post(`${path}signup`, this.handleSignup.bind(this));

    // Health check endpoint
    this.app.get(`${path}health`, (req: Request, res: Response) => {
      if (this.stopped) res.status(503).json({ error: "Service unavailable" });
      else res.status(200).json({ status: "ok" });
    });

    // Whoami endpoint - maps to getUserId()
    this.app.get(`${path}whoami`, this.handleWhoami.bind(this));

    // Wallet endpoints
    this.app.get(`${path}wallets`, this.handleListWallets.bind(this));
    this.app.get(
      `${path}wallets/default`,
      this.handleGetDefaultWallet.bind(this)
    );
    this.app.get(`${path}wallets/:id`, this.handleGetWallet.bind(this));
    this.app.get(
      `${path}wallets/name/:name`,
      this.handleGetWalletByName.bind(this)
    );
    this.app.post(`${path}wallets`, this.handleInsertWallet.bind(this));
    this.app.put(`${path}wallets/:id`, this.handleUpdateWallet.bind(this));
    this.app.delete(`${path}wallets/:id`, this.handleDeleteWallet.bind(this));

    // Expert endpoints
    this.app.get(`${path}experts`, this.handleListExperts.bind(this));
    this.app.get(`${path}experts/:pubkey`, this.handleGetExpert.bind(this));
    this.app.post(`${path}experts`, this.handleInsertExpert.bind(this));
    this.app.put(`${path}experts/:pubkey`, this.handleUpdateExpert.bind(this));
    this.app.put(
      `${path}experts/:pubkey/disabled`,
      this.handleSetExpertDisabled.bind(this)
    );
    this.app.delete(
      `${path}experts/:pubkey`,
      this.handleDeleteExpert.bind(this)
    );
  }

  /**
   * Handles requests to get the current user ID
   *
   * @param req - Express request object
   * @param res - Express response object
   * @private
   */
  private async handleWhoami(req: Request, res: Response): Promise<void> {
    if (this.stopped) {
      res.status(503).json({ error: "Service unavailable" });
      return;
    }

    try {
      res.status(200).json({ user_id: (req as any).user_id });
    } catch (error) {
      debugError("Error handling whoami request:", error);
      const message = error instanceof Error ? error.message : String(error);
      res.status(500).json({
        error: "Internal server error",
        message: message,
      });
    }
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
      const user_id = (req as any).user_id;

      // Check if we have listIds in the perms object
      if ((req as any).perms?.listIds !== undefined) {
        // Use the listWalletsByIds method with the provided string IDs
        wallets = await this.db.listWalletsByIds((req as any).perms.listIds);
      } else {
        // Use the regular listWallets method with user_id if available
        wallets = await this.db.listWallets(user_id);
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

      const user_id = (req as any).user_id;
      const wallet = await this.db.getWallet(id, user_id);
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

      const user_id = (req as any).user_id;
      const wallet = await this.db.getWalletByName(name, user_id);
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
      const user_id = (req as any).user_id;
      const wallet = await this.db.getDefaultWallet(user_id);
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
      if (!wallet || !wallet.name) {
        res.status(400).json({ error: "Invalid wallet data" });
        return;
      }

      // Use user_id from the request object if available
      if ((req as any).user_id) {
        wallet.user_id = (req as any).user_id;
      }

      if (!wallet.nwc) {
        debugServer(`New wallet has no NWC, generating it`);
        const { nwcString } = await createWallet();
        wallet.nwc = nwcString;
      }

      const id = await this.db.insertWallet(wallet);
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

      const success = await this.db.updateWallet(wallet);
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

      const user_id = (req as any).user_id;
      const success = await this.db.deleteWallet(id, user_id);
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
      let experts;
      const user_id = (req as any).user_id;

      // Check if we have listIds in the perms object
      if ((req as any).perms?.listIds !== undefined) {
        // Use the listExpertsByIds method with the provided string IDs
        experts = await this.db.listExpertsByIds((req as any).perms.listIds);
      } else {
        // Use the regular listExperts method with user_id if available
        experts = await this.db.listExperts(user_id);
      }

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
        res.status(400).json({ error: "Invalid expert pubkey" });
        return;
      }

      const user_id = (req as any).user_id;
      const expert = await this.db.getExpert(pubkey, user_id);
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
      if (
        !expert ||
        !expert.pubkey ||
        !expert.type ||
        !expert.nickname
      ) {
        res.status(400).json({ error: "Invalid expert data" });
        return;
      }

      // Use user_id from the request object if available
      if ((req as any).user_id) {
        expert.user_id = (req as any).user_id;
      }

      const success = await this.db.insertExpert(expert);
      if (success) {
        res.status(201).json({ success: true });
      } else {
        res.status(500).json({ error: "Failed to insert expert" });
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
        res.status(400).json({ error: "Invalid expert pubkey" });
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

      // Use user_id from the request object if available
      if ((req as any).user_id) {
        expert.user_id = (req as any).user_id;
      }

      const success = await this.db.updateExpert(expert);
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
        res.status(400).json({ error: "Invalid expert pubkey" });
        return;
      }

      const { disabled } = req.body;
      if (disabled === undefined) {
        res.status(400).json({ error: "Missing disabled status" });
        return;
      }

      const user_id = (req as any).user_id;
      const success = await this.db.setExpertDisabled(
        pubkey,
        !!disabled,
        user_id
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
        res.status(400).json({ error: "Invalid expert pubkey" });
        return;
      }

      const user_id = (req as any).user_id;
      const success = await this.db.deleteExpert(pubkey, user_id);
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

  public async ensureExternalUser(user_id_ext: string) {
    // FIXME make it all a tx!!!
    const user = await this.db.getUserByExtId(user_id_ext);
    debugServer(
      `External user request with external ID ${user_id_ext}, pubkey ${user?.pubkey}`
    );
    if (user) return user.pubkey;

    const { privateKey, publicKey } = generateRandomKeyPair();
    const { nwcString } = await createWallet();
    await this.addUser(
      publicKey,
      nwcString,
      bytesToHex(privateKey),
      user_id_ext
    );
    debugServer(
      `Created external user with external ID ${user_id_ext} pubkey ${publicKey}`
    );

    // Handle bonus top-up if both paymentManager and bonusAmountSats are provided
    if (this.paymentManager && this.bonusAmountSats) {
      try {
        debugServer(
          `Topping up new external user ${user_id_ext} with ${this.bonusAmountSats} sats`
        );

        // Create a temporary LightningPaymentManager for the user's wallet
        const userPaymentManager = new LightningPaymentManager(nwcString);

        // Create an invoice for the bonus amount
        const { invoice } = await userPaymentManager.makeInvoice(
          this.bonusAmountSats,
          `Welcome bonus for user ${user_id_ext}`,
          60 // 1 min expiry
        );

        // Pay the invoice using the constructor's payment manager
        const { preimage } = await this.paymentManager.payInvoice(invoice);

        debugServer(
          `Successfully topped up user ${user_id_ext} with ${this.bonusAmountSats} sats. Preimage: ${preimage}`
        );

        // Clean up the temporary payment manager
        userPaymentManager[Symbol.dispose]();
      } catch (error) {
        debugError(
          `Failed to top up user ${user_id_ext} with bonus sats:`,
          error
        );
        // Don't throw the error - user creation should still succeed even if bonus fails
      }
    }

    return publicKey;
  }

  public async addUser(
    pubkey: string,
    nwc: string,
    privkey?: string,
    user_id_ext?: string
  ) {
    // FIXME create user and wallet as one tx

    const newUser = {
      pubkey,
      privkey: privkey || "",
      user_id_ext,
    };
    const user_id = await this.db.insertUser(newUser);
    debugServer(
      `Created user ${user_id} pubkey ${pubkey}${
        user_id_ext ? ` with external ID ${user_id_ext}` : ""
      }`
    );

    // Create a default wallet named 'main'
    await this.db.insertWallet({
      user_id,
      name: "main",
      nwc,
      default: true,
    });
    debugServer(`Created default wallet 'main' for new user ${user_id}`);

    return user_id;
  }

  /**
   * Handles signup requests
   * Gets user ID by pubkey or creates a new user if it doesn't exist
   *
   * @param req - Express request object
   * @param res - Express response object
   * @private
   */
  private async handleSignup(req: Request, res: Response): Promise<void> {
    if (this.stopped) {
      res.status(503).json({ error: "Service unavailable" });
      return;
    }

    try {
      const pubkey = (req as any).pubkey;
      if (!pubkey) {
        res.status(400).json({ error: "Missing pubkey" });
        return;
      }

      if (req.body.privkey) {
        const privkey = hexToBytes(req.body.privkey);
        if (pubkey !== getPublicKey(privkey)) {
          res.status(400).json({ error: "Wrong privkey" });
          return;
        }
      }

      let user_id: string;

      // Try to get user by pubkey
      // If no perms interface is provided, check directly in the database
      const user = await this.db.getUserByPubkey(pubkey);
      if (user) {
        user_id = user.id;
      } else {
        // User doesn't exist, create a new one

        // Create wallet first
        let nwc: string;
        try {
          const { nwcString } = await createWallet();
          nwc = nwcString;
        } catch (e) {
          debugError("Failed to create wallet", e);
          res.status(500).json({ error: "Failed to create user wallet" });
          return;
        }

        user_id = await this.addUser(
          pubkey,
          nwc,
          req.body.privkey,
          req.body.user_id_ext
        );
      }

      res.status(200).json({ user_id });
    } catch (error) {
      debugError("Error handling signup request:", error);
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
    debugServer(
      `DB Server running at http://localhost:${this.port}${this.basePath}`
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
