import { Event, nip19, validateEvent } from "nostr-tools";
import { Ask, ExpertBid, Prompt } from "../common/types.js";
import { debugExpert, debugError } from "../common/debug.js";
import { FORMAT_OPENAI, FORMAT_TEXT } from "../common/constants.js";
import { RagDB, RagEmbeddings } from "../rag/interfaces.js";
import { OpenaiProxyExpertBase } from "./OpenaiProxyExpertBase.js";
import { Doc, DocStoreClient } from "../docstore/interfaces.js";
import { DocstoreToRag, createRagEmbeddings } from "../rag/index.js";

/**
 * NostrExpert implementation for NIP-174
 * Provides an expert that imitates a Nostr user based on their profile and posts
 */
export class NostrExpert {
  /**
   * OpenaiExpertBase instance
   */
  private openaiExpert: OpenaiProxyExpertBase;

  /**
   * Public key of the Nostr user to imitate
   */
  private pubkey: string;

  /**
   * Crawled profile data
   */
  // private profileInfo?: ProfileInfo;
  private profile?: any;
  private posts: Event[] = [];

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
   * Creates a new NostrExpert instance
   *
   * @param options - Configuration options
   */
  constructor(options: {
    openaiExpert: OpenaiProxyExpertBase;
    pubkey: string;
    ragDB: RagDB;
    docStoreClient: DocStoreClient;
    docstoreId: string;
  }) {
    this.pubkey = options.pubkey;
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
  }

  private pubkeyNickname() {
    return this.profile?.name || this.pubkey.substring(0, 6);
  }

  /**
   * Starts the expert and crawls the Nostr profile
   */
  async start(): Promise<void> {
    try {
      debugExpert(`Starting NostrExpert for pubkey: ${this.pubkey}`);

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
      await new Promise<void>((resolve) => {
        this.docstoreToRag.sync({
          docstore_id: this.docstoreId,
          collection_name: collectionName,
          onDoc: async (doc: Doc) => {
            const event = JSON.parse(doc.data);
            if (!validateEvent(event)) return false;
            if (event.pubkey !== this.pubkey) return false;
            switch (event.kind) {
              case 1:
                this.posts.push(event);
                break;
              case 0:
                try {
                  this.profile = JSON.parse(event.content);
                } catch {
                  debugError("Bad profile event content", event.content);
                }
                break;
              default:
                return false;
            }
            return true;
          },
          onEof: () => {
            debugExpert(
              `Completed syncing docstore to RAG collection ${collectionName}`
            );
            resolve();
          },
        });
      });

      // // Crawl the profile data
      // this.profileInfo = await this.nostr.crawlProfile(this.pubkey, 2000);

      // // Store the profile data as JSON string
      // const profileData = JSON.stringify(this.profileInfo, null, 2);
      // debugExpert(
      //   `Fetched profile data of size ${profileData.length} chars, posts ${this.profileInfo.posts.length}`
      // );

      // // Add posts to RAG database
      // if (this.profileInfo) {
      //   await this.addPostsToRagDB(this.profileInfo.posts);
      // }

      // Extract hashtags from profile info
      const extractedHashtags = await this.extractHashtags(); // this.profileInfo
      debugExpert(`Extracted hashtags: ${extractedHashtags.sort().join(", ")}`);

      // Create the system prompt with the profile data
      const systemPrompt = `You will be given a person's profile in json format below. Also, for every user's message a relevant
selection of person's posts will be prepended to user message in this format:
'
### CONTEXT
[<person's posts>]
### Message
<user message>
'
Act like you are that person - when users talk to you, look through the person's profile
and posts and reply as if you were that person, preserve their unique style, their opinions and their preferences.

${JSON.stringify(this.profile)}`;
      // Posts in the provided json context may contain in_reply_to object with the message that the person was replying
      // to - this should add more context to help you imitate the person better.

      //         : `You will be given a person's profile and his posts in json format below.
      // Act like you are that person - if users ask you questions or talk to you, look through the person's profile
      // and posts and reply as if you were that person, preserve their unique style. Posts in the provided json file may contain in_reply_to object
      // with the message that the person was replying to - this should add more context to help you imitate the person better.

      // # Profile

      // ${this.profile}

      // # Posts

      // ${this.posts}
      // `;

      // Set hashtags to openaiExpert.server.hashtags
      this.openaiExpert.server.hashtags = [
        this.pubkey,
        nip19.npubEncode(this.pubkey),
        ...extractedHashtags,
      ];

      // Set onGetSystemPrompt to return the static systemPrompt
      this.openaiExpert.onGetSystemPrompt = (_: Prompt) =>
        Promise.resolve(systemPrompt);

      // Set nickname and description to openaiExpert.server
      this.openaiExpert.server.nickname = this.pubkeyNickname() + "_clone";
      this.openaiExpert.server.description = await this.getDescription();

      // Start the OpenAI expert
      await this.openaiExpert.start();

      debugExpert(
        `NostrExpert started successfully for pubkey: ${this.pubkey}`
      );
    } catch (error) {
      debugError("Error starting NostrExpert:", error);
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
      console.log("ask", ask);

      // Check if the ask is relevant to this expert
      // if (!tags.includes(this.pubkey)) {
      //   return undefined;
      // }

      debugExpert(`NostrExpert received ask: ${ask.id}`);

      // Return a bid with our offer
      return {
        offer: await this.getDescription(),
      };
    } catch (error) {
      debugError("Error handling ask in NostrExpert:", error);
      return undefined;
    }
  }

  private async getDescription(): Promise<string> {
    return `I am imitating ${this.pubkeyNickname()} pubkey ${
      this.pubkey
    } (${nip19.npubEncode(
      this.pubkey
    )}), ask me questions and I can answer like them. Profile description of ${this.pubkeyNickname()}: 
${this.profile?.about || "-"}`;
  }

  /**
   * Disposes of resources when the expert is no longer needed
   */
  async [Symbol.asyncDispose]() {
    debugExpert("Clearing NostrExpert")
    this.docstoreToRag[Symbol.dispose]();
  }

  /**
   * Extracts hashtags from profile information using OpenAI
   *
   * @returns Promise resolving to an array of hashtags
   */
  private async extractHashtags(): Promise<string[]> {
    try {
      // Use the OpenAI instance from the provided OpenaiProxyExpertBase
      const openai = this.openaiExpert.openai;

      // Create system prompt for hashtag extraction
      const systemPrompt = `You are an expert at analyzing user profiles and determining what topics they are knowledgeable about.
Analyze the provided profile information and identify at least 10 hashtags that represent topics this person would be considered an expert on.
Focus on content of their posts, areas where they demonstrate knowledge.
Then for each hashtag, come up with 4 additional variations of it and add variations to the hashtag list too.
Return ONLY a JSON array of hashtags - english, lowercase, without # symbol, with - instead of spaces, with no explanation or other text.
Example response: ["bitcoin", "programming", "javascript", "webapps", "openprotocols"]`;

      const input = JSON.stringify(
        {
          profile: this.profile,
          // Use latest 500 posts
          posts: this.posts
            .sort((a, b) => a.created_at - b.created_at)
            .slice(-Math.min(this.posts.length, 500)),
        },
        null,
        2
      );
      debugExpert(
        `Extract hashtags, input size ${input.length} chars`
      );

      // Make completion request
      const completion = await openai.chat.completions.create({
        model: this.openaiExpert.model,
        messages: [
          { role: "system", content: systemPrompt },
          {
            role: "user",
            content: input,
          },
        ],
        temperature: 0.5,
      });

      // Extract and parse the hashtags from the response
      const content = completion.choices[0]?.message?.content || "[]";

      // Try to parse the JSON array
      try {
        const hashtags = JSON.parse(content);
        if (Array.isArray(hashtags)) {
          return hashtags.filter((tag) => typeof tag === "string");
        }
      } catch (error) {
        debugError("Error parsing hashtags JSON:", error);
        // If parsing fails, try to extract hashtags using regex
        const matches = content.match(/["']([^"']+)["']/g);
        if (matches) {
          return matches.map((m: string) => m.replace(/["']/g, ""));
        }
      }

      return [];
    } catch (error) {
      debugError("Error extracting hashtags:", error);
      return [];
    }
  }

  private ragCollectionName() {
    return `expert_${this.pubkey}`;
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

      if (!this.ragEmbeddings || !this.posts.length) {
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
      // console.log(
      //   "results",
      //   JSON.stringify(results.map((r) => ({
      //     d: r.distance,
      //     post: this.profileInfo?.posts.find((p) => p.id === r.metadata.postId),
      //   })))
      // );
      if (!results.length) {
        throw notFound;
      }

      debugExpert(
        `Rag search results ${results.length} docs distance ${
          results[0].distance
        }:${results[results.length - 1].distance}`
      );

      // Collect post IDs from all results
      const postIds = new Map<string, number>();
      for (const result of results) {
        if (result.metadata && result.metadata.id) {
          const postDistance = Math.min(
            result.distance,
            postIds.get(result.metadata.id) || result.distance
          );
          postIds.set(result.metadata.id, postDistance);
        }
      }

      // Find matching posts in profileInfo
      const matchingPosts = this.posts
        .filter((post) => postIds.has(post.id))
        .sort((a, b) => postIds.get(b.id)! - postIds.get(a.id)!);

      // Nothing?
      if (!matchingPosts.length) {
        throw notFound;
      }

      // Remove useless fields, return as string
      const context = matchingPosts.map((p) => {
        const post: any = { content: p.content, created_at: p.created_at };
        // if (p.in_reply_to)
        //   post.in_reply_to = {
        //     content: p.in_reply_to.content,
        //     pubkey: p.in_reply_to.pubkey,
        //   };
        return post;
      });
      // console.log("context", context);
      return JSON.stringify(context, null, 2);
    } catch (error) {
      debugError("Error generating prompt context:", error);
      throw error;
    }
  }
}
