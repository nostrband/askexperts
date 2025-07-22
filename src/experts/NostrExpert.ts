import { nip19, SimplePool } from "nostr-tools";
import { OpenaiExpert } from "./OpenaiExpert.js";
import { Nostr, ProfileInfo, PostWithContext } from "./utils/Nostr.js";
import { ModelPricing } from "./utils/ModelPricing.js";
import { Ask, ExpertBid, Prompt } from "../common/types.js";
import { debugExpert, debugError } from "../common/debug.js";
import { FORMAT_OPENAI, FORMAT_TEXT } from "../common/constants.js";
import OpenAI from "openai";
import { RagDB, RagDocument, RagEmbeddings } from "../rag/interfaces.js";

/**
 * NostrExpert implementation for NIP-174
 * Provides an expert that imitates a Nostr user based on their profile and posts
 */
export class NostrExpert {
  /**
   * OpenaiExpert instance
   */
  private openaiExpert?: OpenaiExpert;

  /**
   * Nostr utility instance
   */
  private nostr: Nostr;

  /**
   * Public key of the Nostr user to imitate
   */
  private pubkey: string;

  /**
   * Crawled profile data
   */
  private profileInfo?: ProfileInfo;

  /**
   * RAG embeddings provider
   */
  private ragEmbeddings?: RagEmbeddings;

  /**
   * RAG database
   */
  private ragDB?: RagDB;

  /**
   * Configuration options
   */
  private options: {
    privkey: Uint8Array;
    openaiBaseUrl: string;
    openaiApiKey: string;
    model: string;
    nwcString: string;
    margin: number;
    pricingProvider: ModelPricing;
    pubkey: string;
    discoveryRelays?: string[];
    promptRelays?: string[];
    pool?: SimplePool;
    avgOutputTokens?: number;
    ragEmbeddings?: RagEmbeddings;
    ragDB?: RagDB;
  };

  /**
   * Creates a new NostrExpert instance
   *
   * @param options - Configuration options
   */
  constructor(options: {
    privkey: Uint8Array;
    openaiBaseUrl: string;
    openaiApiKey: string;
    model: string;
    nwcString: string;
    margin: number;
    pricingProvider: ModelPricing;
    pubkey: string;
    discoveryRelays?: string[];
    promptRelays?: string[];
    pool?: SimplePool;
    avgOutputTokens?: number;
    ragEmbeddings?: RagEmbeddings;
    ragDB?: RagDB;
  }) {
    // Store options for later use
    this.options = { ...options };

    this.pubkey = options.pubkey;

    // Store RAG components if provided
    this.ragEmbeddings = options.ragEmbeddings;
    this.ragDB = options.ragDB;
    if (!!this.ragDB !== !!this.ragEmbeddings)
      throw new Error("Both RAG DB and embeddings should be provided");

    // Create SimplePool if not provided
    const pool = options.pool || new SimplePool();

    // Create Nostr utility
    this.nostr = new Nostr(pool);
  }

  /**
   * Starts the expert and crawls the Nostr profile
   */
  async start(): Promise<void> {
    if (this.openaiExpert) throw new Error("Already started");

    try {
      debugExpert(`Starting NostrExpert for pubkey: ${this.pubkey}`);

      // Crawl the profile data
      this.profileInfo = await this.nostr.crawlProfile(this.pubkey, 2000);

      // Store the profile data as JSON string
      const profileData = JSON.stringify(this.profileInfo, null, 2);
      debugExpert(
        `Fetched profile data of size ${profileData.length} chars, posts ${this.profileInfo.posts.length}`
      );

      // Add posts to RAG database if RAG components are available
      if (this.ragEmbeddings && this.ragDB && this.profileInfo) {
        await this.addPostsToRagDB(this.profileInfo.posts);
      }

      // Extract hashtags from profile info
      const extractedHashtags = await this.extractHashtags(this.profileInfo);
      debugExpert(`Extracted hashtags: ${extractedHashtags.sort().join(", ")}`);

      // Create the system prompt with the profile data
      const systemPrompt = this.ragDB
        ? `You will be given a person's profile in json format below. Also, for every user's message a relevant
selection of person's posts will be prepended to user message in this format:
'
### CONTEXT
[<person's posts>]
### Message
<user message>
'
Act like you are that person - when users talk to you, look through the person's profile
and posts and reply as if you were that person, preserve their unique style, their opinions and their preferences.
Posts in the provided json context may contain in_reply_to object with the message that the person was replying 
to - this should add more context to help you imitate the person better.

${JSON.stringify(this.profileInfo.profile)}`
        : `You will be given a person's profile and his posts in json format below.
Act like you are that person - if users ask you questions or talk to you, look through the person's profile
and posts and reply as if you were that person, preserve their unique style. Posts in the provided json file may contain in_reply_to object
with the message that the person was replying to - this should add more context to help you imitate the person better.

${profileData}
`;

      // Create a new OpenAI expert with the system prompt
      // We need to recreate it with all the original parameters plus our new system prompt
      this.openaiExpert = new OpenaiExpert({
        ...this.options,
        systemPrompt: systemPrompt,
        hashtags: [
          this.pubkey,
          nip19.npubEncode(this.pubkey),
          ...extractedHashtags,
        ],
        onAsk: this.onAsk.bind(this),
        onPromptContext: this.onPromptContext.bind(this),
      });

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
        offer: `I am imitating ${this.pubkey} (${nip19.npubEncode(
          this.pubkey
        )}), ask me questions and I can answer like them.
The profile info: ${JSON.stringify(this.profileInfo?.profile, null, 2)}`,
      };
    } catch (error) {
      debugError("Error handling ask in NostrExpert:", error);
      return undefined;
    }
  }

  /**
   * Disposes of resources when the expert is no longer needed
   */
  [Symbol.dispose](): void {
    // Dispose of the OpenAI expert
    this.openaiExpert?.[Symbol.dispose]();
    this.openaiExpert = undefined;
  }

  /**
   * Extracts hashtags from profile information using OpenAI
   *
   * @param profileInfo - The profile information object
   * @returns Promise resolving to an array of hashtags
   */
  private async extractHashtags(profileInfo: any): Promise<string[]> {
    try {
      // Create OpenAI instance
      const openai = new OpenAI({
        apiKey: this.options.openaiApiKey,
        baseURL: this.options.openaiBaseUrl,
      });

      // Create system prompt for hashtag extraction
      const systemPrompt = `You are an expert at analyzing user profiles and determining what topics they are knowledgeable about.
Analyze the provided profile information and identify at least 10 hashtags that represent topics this person would be considered an expert on.
Focus on content of their posts, areas where they demonstrate knowledge.
Then for each hashtag, come up with 4 additional variations of it and add variations to the hashtag list too.
Return ONLY a JSON array of hashtags - english, lowercase, without # symbol, with - instead of spaces, with no explanation or other text.
Example response: ["bitcoin", "programming", "javascript", "webapps", "openprotocols"]`;

      // Make completion request
      const completion = await openai.chat.completions.create({
        model: this.options.model,
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: JSON.stringify(profileInfo, null, 2) },
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
   * Adds posts to the RAG database
   *
   * @param posts - Array of posts to add
   */
  private async addPostsToRagDB(posts: PostWithContext[]): Promise<void> {
    if (!this.ragEmbeddings || !this.ragDB) {
      debugExpert("RAG components not available, skipping RAG indexing");
      return;
    }

    try {
      debugExpert(`Adding ${posts.length} posts to RAG database`);

      // Queue for collecting chunks before writing to DB
      const documents: RagDocument[] = [];
      const CHUNK_BATCH_SIZE = 20;
      let totalChunks = 0;
      let batchCounter = 0;

      // Process each post one by one
      for (let i = 0; i < posts.length; i++) {
        const post = posts[i];
        debugExpert(`Processing post ${i + 1} of ${posts.length}`);

        // Create text from post content and reply context if available
        const text = `${post.in_reply_to?.content || ""}\n${post.content}`;

        // Generate embeddings for the text (sequentially)
        const chunks = await this.ragEmbeddings!.embed(text);

        // Add chunks to the queue
        for (let j = 0; j < chunks.length; j++) {
          const chunk = chunks[j];
          documents.push({
            id: `${post.id}_chunk_${j}`,
            vector: chunk.embedding,
            metadata: { postId: post.id },
          });

          totalChunks++;
        }

        // If we have enough chunks, write to DB and clear the queue
        if (documents.length >= CHUNK_BATCH_SIZE) {
          batchCounter++;
          await this.ragDB.storeBatch(this.ragCollectionName(), documents);
          debugExpert(
            `Stored ${documents.length} chunks (batch ${batchCounter})`
          );
          documents.length = 0; // Clear the array
        }
      }

      // Store any remaining chunks
      if (documents.length > 0) {
        batchCounter++;
        await this.ragDB.storeBatch(this.ragCollectionName(), documents);
        debugExpert(
          `Stored final ${documents.length} chunks (batch ${batchCounter})`
        );
      }

      debugExpert(
        `Successfully added ${totalChunks} chunks from ${posts.length} posts to RAG database`
      );
    } catch (error) {
      debugError("Error adding posts to RAG database:", error);
    }
  }

  /**
   * Callback for OpenaiExpert to get context for prompts
   *
   * @param prompt - The prompt to get context for
   * @returns Promise resolving to context string
   */
  private async onPromptContext(prompt: Prompt): Promise<string> {
    if (!this.ragEmbeddings || !this.ragDB || !this.profileInfo) {
      return "";
    }

    try {
      // We will throw this to signal that the expert doesn't
      // have any relevant knowledge and quote should include this error
      const notFound = new Error("Expert has no knowledge on the subject");

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
        if (result.metadata && result.metadata.postId) {
          const postDistance = Math.min(
            result.distance,
            postIds.get(result.metadata.postId) || result.distance
          );
          postIds.set(result.metadata.postId, postDistance);
        }
      }

      // Find matching posts in profileInfo
      const matchingPosts = this.profileInfo.posts.filter((post) =>
        postIds.has(post.id)
      ).sort((a, b) => postIds.get(b.id)! - postIds.get(a.id)!);

      // Nothing?
      if (!matchingPosts.length) {
        throw notFound;
      }

      // Remove useless fields, return as string
      const context = matchingPosts.map((p) => {
        const post: any = { content: p.content, created_at: p.created_at };
        if (p.in_reply_to)
          post.in_reply_to = {
            content: p.in_reply_to.content,
            pubkey: p.in_reply_to.pubkey,
          };
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
