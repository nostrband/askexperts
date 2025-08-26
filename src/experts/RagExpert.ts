import { Ask, ExpertBid, Prompt } from "../common/types.js";
import { debugExpert, debugError } from "../common/debug.js";
import { FORMAT_OPENAI, FORMAT_TEXT } from "../common/constants.js";
import { RagDB, RagEmbeddings } from "../rag/interfaces.js";
import { OpenaiProxyExpertBase } from "./OpenaiProxyExpertBase.js";
import { Doc, DocStoreClient } from "../docstore/interfaces.js";
import { DocstoreToRag, createRagEmbeddings } from "../rag/index.js";
import { DBExpert } from "../db/interfaces.js";
import { str2arr } from "../common/utils.js";
import { Prompts } from "./Prompts.js";

/**
 * RagExpert implementation for NIP-174
 * Provides expert access to context using docstore and rag
 */
export class RagExpert {
  /**
   * OpenaiExpertBase instance
   */
  private openaiExpert: OpenaiProxyExpertBase;

  /** Expert info */
  private expert: DBExpert;

  /** Hashtags we're watching */
  private discovery_hashtags: string[] = [];

  /**
   * Documents
   */
  private docs: Doc[] = [];

  /**
   * RAG embeddings provider
   */
  private ragEmbeddings?: RagEmbeddings;

  /**
   * RAG database
   */
  private ragDB: RagDB;

  /**
   * Sync process
   */
  private docstoreToRag: DocstoreToRag;

  /**
   * DocStore client
   */
  private docStoreClient: DocStoreClient;

  /**
   * Docstore ID
   */
  private docstoreId: string;

  /**
   * Docstore-to-rag sync object
   */
  private syncController?: { stop: () => void };

  /**
   * Creates a new RagExpert instance
   *
   * @param options - Configuration options
   */
  constructor(options: {
    openaiExpert: OpenaiProxyExpertBase;
    expert: DBExpert;
    ragDB: RagDB;
    docStoreClient: DocStoreClient;
    docstoreId: string;
  }) {
    this.expert = options.expert;
    this.openaiExpert = options.openaiExpert;

    // Store RAG database
    this.ragDB = options.ragDB;

    // Store DocStore components
    this.docStoreClient = options.docStoreClient;
    this.docstoreId = options.docstoreId;

    // Sync from docstore to rag
    this.docstoreToRag = new DocstoreToRag(this.ragDB, this.docStoreClient);

    // Set our onAsk to the openaiExpert.server
    this.openaiExpert.server.onAsk = this.onAsk.bind(this);

    // Set onGetContext (renamed from onPromptContext)
    this.openaiExpert.onGetContext = this.onGetContext.bind(this);
    this.openaiExpert.onGetInvoiceDescription =
      this.onGetInvoiceDescription.bind(this);
  }

  /**
   * Starts the expert and crawls the Nostr profile
   */
  async start(): Promise<void> {
    try {
      debugExpert(`Starting RagExpert`);

      // Get docstore to determine model
      const docstore = await this.docStoreClient.getDocstore(this.docstoreId);
      if (!docstore) {
        throw new Error(`Docstore with ID ${this.docstoreId} not found`);
      }

      // Use docstore model for embeddings
      debugExpert(`Using docstore model: ${docstore.model}`);

      // Create and initialize embeddings with the docstore model
      this.ragEmbeddings = createRagEmbeddings(docstore.model);
      await this.ragEmbeddings.start();
      debugExpert("RAG embeddings initialized with docstore model");

      // Start syncing docs to RAG
      const collectionName = this.ragCollectionName();
      debugExpert(
        `Starting sync from docstore ${this.docstoreId} to RAG collection ${collectionName}`
      );

      // Sync from docstore to RAG
      const decoder = new TextDecoder();
      await new Promise<void>(async (resolve) => {
        this.syncController = await this.docstoreToRag.sync({
          docstore_id: this.docstoreId,
          collection_name: collectionName,
          onDoc: async (doc: Doc) => {
            this.docs.push(doc);
            return true;
          },
          onEof: resolve,
        });
      });

      debugExpert(
        `Completed syncing docstore to RAG collection ${collectionName}, docs ${this.docs.length}`
      );

      // Parse hashtags
      this.discovery_hashtags = str2arr(this.expert.discovery_hashtags) || [];

      // Set hashtags to openaiExpert.server.hashtags
      this.openaiExpert.server.hashtags = [...this.discovery_hashtags];

      const system_prompt =
        this.expert.system_prompt || Prompts.defaultExpertPrompt();

      // Set onGetSystemPrompt to return the static systemPrompt
      this.openaiExpert.onGetSystemPrompt = (_: Prompt) =>
        Promise.resolve(system_prompt);

      // Set nickname and description to openaiExpert.server
      this.openaiExpert.server.nickname = this.expert.nickname || "";
      this.openaiExpert.server.description = this.expert.description || "";

      // Start the OpenAI expert
      await this.openaiExpert.start();

      debugExpert(`RagExpert started successfully`);
    } catch (error) {
      debugError("Error starting RagExpert:", error);
      throw error;
    }
  }

  /**
   * Handles ask events
   *
   * @param ask - The ask event
   * @returns Promise resolving to a bid if interested, or undefined to ignore
   */
  private async onAsk(ask: Ask): Promise<ExpertBid | undefined> {
    try {
      const tags = ask.hashtags;

      // Check if the ask is relevant to this expert
      if (!tags.find((s) => this.discovery_hashtags.includes(s))) {
        return undefined;
      }

      debugExpert(`RagExpert received ask: ${ask.id}`);

      // Return a bid with our offer
      return {
        offer: this.expert.description || "I can answer your question",
      };
    } catch (error) {
      debugError("Error handling ask in RagExpert:", error);
      return undefined;
    }
  }

  /**
   * Disposes of resources when the expert is no longer needed
   */
  async [Symbol.asyncDispose]() {
    debugExpert("Clearing RagExpert");
    this.docstoreToRag[Symbol.dispose]();
    this.syncController?.stop();
  }

  private ragCollectionName() {
    return `expert_${this.expert.pubkey}`;
  }

  private onGetInvoiceDescription(prompt: Prompt): Promise<string> {
    return Promise.resolve(`Payment to expert ${this.expert.pubkey}...`);
  }

  /**
   * Callback for OpenaiExpert to get context for prompts
   *
   * @param prompt - The prompt to get context for
   * @returns Promise resolving to context string
   */
  private async onGetContext(prompt: Prompt): Promise<string> {
    try {
      // We will throw this to signal that the expert doesn't
      // have any relevant knowledge and quote should include this error
      const notFound = new Error("Expert has no knowledge on the subject");

      if (!this.ragEmbeddings || !this.docs.length) {
        throw notFound;
      }

      // Extract text from prompt based on format
      let promptText: string = "";

      if (prompt.format === FORMAT_OPENAI) {
        // For OpenAI format, extract text from up to last 10 messages
        const messages = prompt.content.messages;
        if (messages && messages.length > 0) {
          // Get up to last 10 messages (except for system prompt)
          const userMessages = messages
            .filter((msg: any) => msg.role !== "system")
            .slice(-10);

          promptText = userMessages
            .map((msg: any) =>
              typeof msg.content === "string"
                ? msg.content
                : JSON.stringify(msg.content)
            )
            .join("\n");
        }
      } else if (prompt.format === FORMAT_TEXT) {
        // For text format, use content directly
        promptText = prompt.content;
      }

      if (!promptText) {
        throw notFound;
      }

      // Generate embeddings for all prompt texts sequentially
      const embeddings: number[][] = [];
      // debugExpert("promptText", promptText);

      // Process each text sequentially
      const chunks = await this.ragEmbeddings!.embed(promptText);

      // Extract embeddings from chunks
      for (const chunk of chunks) {
        embeddings.push(chunk.embedding);
      }

      if (embeddings.length === 0) {
        throw notFound;
      }

      // Take up to 20 most recent chunks
      const recentEmbeddings = embeddings.slice(-20);

      // Search for similar content in the RAG database using batch search
      const batchResults = await this.ragDB.searchBatch(
        this.ragCollectionName(),
        recentEmbeddings,
        50 // Limit to 50 results per query
      );
      const results = batchResults
        .flat()
        .sort((a, b) => a.distance - b.distance);
      if (!results.length) {
        throw notFound;
      }

      debugExpert(
        `Rag search results ${results.length} docs distance ${
          results[0].distance
        }:${results[results.length - 1].distance}`
      );

      // Collect post IDs from all results
      const docIds = new Map<string, number>();
      for (const result of results) {
        if (result.metadata && result.metadata.id) {
          const docDistance = Math.min(
            result.distance,
            docIds.get(result.metadata.id) || result.distance
          );
          docIds.set(result.metadata.id, docDistance);
        }
      }

      // Find matching posts in profileInfo
      const matchingDocs = this.docs
        .filter((doc) => docIds.has(doc.id))
        .sort((a, b) => docIds.get(b.id)! - docIds.get(a.id)!);

      // Nothing?
      if (!matchingDocs.length) {
        throw notFound;
      }

      // Remove useless fields, return as string
      const context = matchingDocs.map((d) => {
        return { content: d.data, metadata: d.metadata || "" };
      });
      return JSON.stringify(context, null, 2);
    } catch (error) {
      debugError("Error generating prompt context:", error);
      throw error;
    }
  }
}
