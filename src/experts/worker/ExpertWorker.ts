import { getPublicKey, SimplePool } from "nostr-tools";
import { DBExpert } from "../../db/interfaces.js";
import { NostrExpert } from "../../experts/NostrExpert.js";
import { OpenaiProxyExpertBase } from "../../experts/OpenaiProxyExpertBase.js";
import { OpenaiProxyExpert } from "../../experts/OpenaiProxyExpert.js";
import { debugError, debugExpert } from "../../common/debug.js";
import { ChromaRagDB, RagDB } from "../../rag/index.js";
import { createOpenAI } from "../../openai/index.js";
import { AskExpertsServer } from "../../server/AskExpertsServer.js";
import { LightningPaymentManager } from "../../payments/LightningPaymentManager.js";
import { DocStoreClient } from "../../docstore/interfaces.js";
import { DocStoreWebSocketClient } from "../../docstore/DocStoreWebSocketClient.js";
import { getDocstorePath } from "../../bin/commands/docstore/index.js";
import dotenv from "dotenv";
import { DocStoreLocalClient } from "../../docstore/DocStoreLocalClient.js";
import { hexToBytes } from "nostr-tools/utils";
import { str2arr } from "../../common/utils.js";

/**
 * Interface for tracking running experts
 */
interface RunningExpert {
  pubkey: string;
  type: string;
  stopFn: () => void;
  disposed: Promise<void>;
}

/**
 * ExpertWorker class for managing experts
 */
export class ExpertWorker {
  private runningExperts: Map<string, RunningExpert> = new Map();
  private paymentManagers: Map<string, LightningPaymentManager> = new Map();
  private pool: SimplePool;
  private ragDB: RagDB;
  private defaultDocStoreUrl?: string;

  /**
   * Get the pubkeys of all running experts
   *
   * @returns Array of pubkeys of running experts
   */
  public getRunningExpertPubkeys(): string[] {
    return Array.from(this.runningExperts.keys());
  }

  /**
   * Create a new ExpertWorker
   *
   * @param pool SimplePool instance for Nostr communication
   * @param ragHost Host for RAG database
   * @param ragPort Port for RAG database
   */
  constructor(
    pool: SimplePool,
    ragHost?: string,
    ragPort?: number,
    defaultDocStoreUrl?: string
  ) {
    this.pool = pool;
    this.defaultDocStoreUrl = defaultDocStoreUrl;
    this.ragDB = new ChromaRagDB(ragHost, ragPort);
    debugExpert("ExpertWorker initialized with RAG database");
  }

  /**
   * Start an expert
   *
   * @param expert The expert to start
   * @param nwcString NWC connection string for the expert's wallet
   * @returns Promise that resolves when the expert is started
   */
  public async startExpert(expert: DBExpert, nwcString: string): Promise<void> {
    if (this.runningExperts.has(expert.pubkey)) {
      debugExpert(
        `Expert ${expert.nickname} (${expert.pubkey}) is already running`
      );
      return;
    }

    try {
      // Get or create payment manager for this expert's wallet
      let paymentManager: LightningPaymentManager;
      if (this.paymentManagers.has(expert.wallet_id)) {
        paymentManager = this.paymentManagers.get(expert.wallet_id)!;
        debugExpert(
          `Reusing existing payment manager for wallet ID ${expert.wallet_id}`
        );
      } else {
        paymentManager = new LightningPaymentManager(nwcString);
        this.paymentManagers.set(expert.wallet_id, paymentManager);
        debugExpert(
          `Created new payment manager for wallet ID ${expert.wallet_id}`
        );
      }

      // Create individual stop promise for this expert
      let stopResolve: () => void;
      const expertStopPromise = new Promise<void>((resolve) => {
        stopResolve = resolve;
      });

      let result: { disposed: Promise<void> };

      // Start the expert based on its type
      if (expert.type === "nostr") {
        // Parse docstores - exactly one must be specified
        const parsedDocstores = ExpertWorker.parseDocstoreIdsList(
          expert.docstores,
          this.defaultDocStoreUrl
        );
        if (parsedDocstores.length !== 1) {
          throw new Error(
            `Expert ${expert.nickname} must have exactly one docstore specified, found ${parsedDocstores.length}`
          );
        }
        const parsedDocstore = parsedDocstores[0];

        // Create the appropriate DocStoreClient based on the docstore ID format,
        // Authenticate using expert privkey
        const privkey = expert.privkey ? hexToBytes(expert.privkey) : undefined;
        const expertDocStoreClient =
          ExpertWorker.createDocStoreClientFromParsed(parsedDocstore, privkey);

        result = await this.startNostrExpert(
          expert,
          this.pool,
          paymentManager,
          this.ragDB,
          expertDocStoreClient,
          expertStopPromise
        );
      } else if (expert.type === "openrouter") {
        result = await ExpertWorker.startOpenRouterExpert(
          expert,
          this.pool,
          paymentManager,
          expertStopPromise
        );
      } else {
        throw new Error(`Unknown expert type: ${expert.type}`);
      }

      // Add to running experts
      this.runningExperts.set(expert.pubkey, {
        pubkey: expert.pubkey,
        type: expert.type,
        stopFn: stopResolve!,
        disposed: result.disposed,
      });

      debugExpert(
        `Started expert ${expert.nickname} (${expert.pubkey}) of type ${expert.type}`
      );
    } catch (error) {
      debugError(
        `Error starting expert ${expert.nickname} (${expert.pubkey}):`,
        error
      );
      throw error;
    }
  }

  /**
   * Stop an expert
   *
   * @param pubkey The pubkey of the expert to stop
   * @returns True if the expert was running and is now stopped, false otherwise
   */
  public async stopExpert(pubkey: string): Promise<boolean> {
    const expert = this.runningExperts.get(pubkey);
    if (expert) {
      debugExpert(`Stopping expert ${pubkey}...`);
      expert.stopFn();
      await expert.disposed;
      this.runningExperts.delete(pubkey);
      return true;
    }
    return false;
  }

  /**
   * Dispose all resources
   */
  async [Symbol.asyncDispose]() {
    // Collect all disposed promises
    const disposedPromises: Promise<void>[] = [];

    // Stop all running experts
    for (const [pubkey, expert] of this.runningExperts.entries()) {
      debugExpert(`Stopping expert ${pubkey}...`);
      expert.stopFn();
      disposedPromises.push(expert.disposed);
    }

    // Wait for all experts to be fully disposed
    await Promise.all(disposedPromises);

    this.runningExperts.clear();

    // Dispose all payment managers
    for (const [walletId, paymentManager] of this.paymentManagers.entries()) {
      debugExpert(`Disposing payment manager for wallet ID ${walletId}`);
      paymentManager[Symbol.dispose]();
    }

    this.paymentManagers.clear();
  }

  /**
   * Start a Nostr expert
   *
   * @param expert The expert to start
   * @param pool SimplePool instance
   * @param paymentManager Payment manager
   * @param ragDB RAG database
   * @param docStoreClient DocStore client
   * @param onStop Promise that resolves when the expert should be stopped
   */
  public async startNostrExpert(
    expert: DBExpert,
    pool: SimplePool,
    paymentManager: LightningPaymentManager,
    ragDB: RagDB,
    docStoreClient: DocStoreClient,
    onStop: Promise<void>
  ): Promise<{ disposed: Promise<void> }> {
    // Get private key from the expert
    if (!expert.privkey) {
      throw new Error(
        `Expert ${expert.nickname} (${expert.pubkey}) does not have a private key`
      );
    }
    const privkey = new Uint8Array(Buffer.from(expert.privkey!, "hex"));

    // Parse environment variables if not provided
    const expertEnvVars = dotenv.parse(expert.env);

    // Target nostr pubkey
    const nostrPubkey = expertEnvVars.NOSTR_PUBKEY;
    if (!nostrPubkey) {
      throw new Error(
        "Nostr pubkey is required. Set NOSTR_PUBKEY in the expert's env configuration."
      );
    }

    // Get model and margin from environment or use defaults
    const model = expert.model || "openai/gpt-4.1";
    const margin = parseFloat(expert.price_margin || "0.1");

    // Parse docstores - exactly one must be specified
    const parsedDocstores = ExpertWorker.parseDocstoreIdsList(
      expert.docstores,
      this.defaultDocStoreUrl
    );
    if (parsedDocstores.length !== 1) {
      throw new Error(
        `Expert ${expert.nickname} must have exactly one docstore specified, found ${parsedDocstores.length}`
      );
    }
    const parsedDocstore = parsedDocstores[0];
    const docstoreId = parsedDocstore.id;

    // Get API key from environment
    const apiKey = expertEnvVars.OPENAI_API_KEY || process.env.OPENAI_API_KEY;
    const baseURL =
      expertEnvVars.OPENAI_BASE_URL || process.env.OPENAI_BASE_URL;

    // Create OpenAI interface instance
    const openai = createOpenAI({
      apiKey,
      baseURL,
      margin,
      pool,
      paymentManager,
    });

    // Create server
    const server = new AskExpertsServer({
      privkey,
      pool,
      paymentManager,
      description: expert.description,
      discoveryRelays: str2arr(expert.discovery_relays),
      hashtags: str2arr(expert.discovery_hashtags),
      nickname: expert.nickname,
      picture: expert.picture,
      profileHashtags: str2arr(expert.hashtags),
    });

    // Create OpenaiProxyExpertBase instance
    const openaiExpert = new OpenaiProxyExpertBase({
      server,
      openai,
      model,
    });

    // Create the expert
    const nostrExpert = new NostrExpert({
      openaiExpert,
      expert,
      pubkey: nostrPubkey,
      ragDB,
      docStoreClient,
      docstoreId,
    });

    // Start the expert
    await nostrExpert.start();

    // Create a promise that will resolve when all resources are disposed
    let disposeResolve: () => void;
    const disposedPromise = new Promise<void>((resolve) => {
      disposeResolve = resolve;
    });

    // Destroy on stop signal
    onStop.then(async () => {
      try {
        await nostrExpert[Symbol.asyncDispose]();
        await openaiExpert[Symbol.asyncDispose]();
        await server[Symbol.asyncDispose]();
      } finally {
        disposeResolve();
      }
    });

    return { disposed: disposedPromise };
  }

  /**
   * Start an OpenRouter expert
   *
   * @param expert The expert to start
   * @param pool SimplePool instance
   * @param paymentManager Payment manager
   * @param onStop Promise that resolves when the expert should be stopped
   */
  public static async startOpenRouterExpert(
    expert: DBExpert,
    pool: SimplePool,
    paymentManager: LightningPaymentManager,
    onStop: Promise<void>
  ): Promise<{ disposed: Promise<void> }> {
    // Get private key from the expert
    if (!expert.privkey) {
      throw new Error(
        `Expert ${expert.nickname} (${expert.pubkey}) does not have a private key`
      );
    }
    const privkey = new Uint8Array(Buffer.from(expert.privkey!, "hex"));

    // Parse environment variables if not provided
    const expertEnvVars = dotenv.parse(expert.env);

    const margin = parseFloat(expert.price_margin || "0.1");

    // Get API key from environment
    const apiKey =
      expertEnvVars.OPENROUTER_API_KEY || process.env.OPENROUTER_API_KEY || "";
    if (!apiKey) {
      throw new Error(
        "OpenRouter API key is required. Set OPENROUTER_API_KEY in the expert's env configuration."
      );
    }

    // Create OpenAI interface instance
    const openai = createOpenAI({
      apiKey,
      baseURL: "https://openrouter.ai/api/v1",
      margin,
    });

    // Create server
    const server = new AskExpertsServer({
      privkey,
      pool,
      paymentManager,
      description: expert.description,
      discoveryRelays: str2arr(expert.discovery_relays),
      hashtags: str2arr(expert.discovery_hashtags),
      nickname: expert.nickname,
      picture: expert.picture,
      profileHashtags: str2arr(expert.hashtags),
    });

    // Create OpenaiProxyExpert instance
    const openaiExpert = new OpenaiProxyExpert({
      server,
      openai,
      expert,
    });

    // Start the expert
    await openaiExpert.start();

    debugExpert(
      `Started expert ${expert.nickname} (${expert.pubkey}) with model ${expert.model} and margin ${margin}`
    );

    // Create a promise that will resolve when all resources are disposed
    let disposeResolve: () => void;
    const disposedPromise = new Promise<void>((resolve) => {
      disposeResolve = resolve;
    });

    // Destroy on stop signal
    onStop.then(async () => {
      try {
        await openaiExpert[Symbol.asyncDispose]();
        await server[Symbol.asyncDispose]();
      } finally {
        disposeResolve();
      }
    });

    return { disposed: disposedPromise };
  }

  /**
   * Parse a docstore ID string into URL and ID components
   *
   * If the docstore ID contains a ":", it's treated as a remote docstore with format:
   * url:docstore_id (e.g., https://docstore.askexperts.io:docstore_id)
   *
   * @param docstoreIdStr - The docstore ID string to parse
   * @returns An object containing the URL (if remote) and the actual docstore ID
   */
  public static parseDocstoreId(docstoreIdStr: string): {
    url?: string;
    id: string;
  } {
    // Check if the docstore ID contains a ":" character
    if (docstoreIdStr.includes(":")) {
      // Find the last ":" to separate URL from docstore ID
      const lastColonIndex = docstoreIdStr.lastIndexOf(":");

      // Extract URL (everything before the last colon)
      const url = docstoreIdStr.substring(0, lastColonIndex);

      // Extract actual docstore ID (everything after the last colon)
      const id = docstoreIdStr.substring(lastColonIndex + 1);

      return { url, id };
    } else {
      // No ":" in the docstore ID, use as-is
      return { id: docstoreIdStr };
    }
  }

  /**
   * Parse a comma-separated list of docstore IDs
   *
   * @param docstoresStr - Comma-separated list of docstore IDs
   * @returns Array of parsed docstore ID objects
   */
  public static parseDocstoreIdsList(
    docstoresStr: string,
    defaultDocStoreUrl?: string
  ): Array<{
    url?: string;
    id: string;
  }> {
    const docstores = docstoresStr
      .split(",")
      .map((d) => d.trim())
      .filter((d) => d !== "");

    const ids = docstores.map(ExpertWorker.parseDocstoreId);
    if (!defaultDocStoreUrl) return ids;
    return ids.map((p) => {
      p.url = defaultDocStoreUrl;
      return p;
    });
  }

  /**
   * Create the appropriate DocStoreClient based on a parsed docstore ID
   *
   * @param parsedDocstore - Parsed docstore ID object
   * @returns DocStoreClient instance
   */
  public static createDocStoreClientFromParsed(
    parsedDocstore: {
      url?: string;
      id: string;
    },
    privateKey?: Uint8Array
  ): DocStoreClient {
    if (parsedDocstore.url) {
      // Remote docstore
      debugExpert(
        `Creating DocStoreWebSocketClient for URL: ${
          parsedDocstore.url
        }, docstore ID: ${parsedDocstore.id}, auth: ${
          privateKey ? getPublicKey(privateKey) : "none"
        }`
      );
      return new DocStoreWebSocketClient({
        url: parsedDocstore.url,
        privateKey,
      });
    } else {
      // Local docstore
      const docstorePath = getDocstorePath();
      debugExpert(`Using local DocStoreSQLite at: ${docstorePath}`);
      return new DocStoreLocalClient(docstorePath);
    }
  }

  /**
   * Parse a docstore ID string and create the appropriate DocStoreClient
   *
   * If the docstore ID contains a ":", it's treated as a remote docstore with format:
   * url:docstore_id (e.g., https://docstore.askexperts.io:docstore_id)
   *
   * @param docstoreIdStr - The docstore ID string to parse
   * @returns An object containing the DocStoreClient and the actual docstore ID
   */
  public static createDocStoreClient(docstoreIdStr: string): {
    client: DocStoreClient;
    docstoreId: string;
  } {
    const parsedDocstore = ExpertWorker.parseDocstoreId(docstoreIdStr);
    return {
      client: ExpertWorker.createDocStoreClientFromParsed(parsedDocstore),
      docstoreId: parsedDocstore.id,
    };
  }
}
