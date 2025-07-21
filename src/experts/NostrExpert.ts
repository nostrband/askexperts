import { nip19, SimplePool } from "nostr-tools";
import { OpenaiExpert } from "./OpenaiExpert.js";
import { Nostr, ProfileInfo } from "./utils/Nostr.js";
import { ModelPricing } from "./utils/ModelPricing.js";
import { Ask, ExpertBid } from "../common/types.js";
import { debugExpert, debugError } from "../common/debug.js";
import OpenAI from "openai";

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
  }) {
    // Store options for later use
    this.options = { ...options };
    
    this.pubkey = options.pubkey;
    
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
      debugExpert(`Fetched profile data of size ${profileData.length} chars, posts ${this.profileInfo.posts.length}`);

      // Extract hashtags from profile info
      const extractedHashtags = await this.extractHashtags(this.profileInfo);
      debugExpert(`Extracted hashtags: ${extractedHashtags.sort().join(', ')}`);
      
      // Create the system prompt with the profile data
      const systemPrompt = `You will be given a person's profile and his posts in json format below.
Act like you are that person - if users ask you questions or talk to you, look through the person's profile
and posts and reply as if you were that person, preserve their unique style. Posts in the provided json file may contain in_reply_to object
with the message that the person was replying to - this should add more context to help you imitate the person better.

${profileData}`;
      
      // Create a new OpenAI expert with the system prompt
      // We need to recreate it with all the original parameters plus our new system prompt
      this.openaiExpert = new OpenaiExpert({
        ...this.options,
        systemPrompt: systemPrompt,
        hashtags: [this.pubkey, nip19.npubEncode(this.pubkey), ...extractedHashtags],
        onAsk: this.onAsk.bind(this)
      });
      
      // Start the OpenAI expert
      await this.openaiExpert.start();
      
      debugExpert(`NostrExpert started successfully for pubkey: ${this.pubkey}`);
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
        offer: `I am imitating ${this.pubkey} (${nip19.npubEncode(this.pubkey)}), ask me questions and I can answer like them.
The profile info: ${JSON.stringify(this.profileInfo?.profile, null, 2)}`
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
          { role: "user", content: JSON.stringify(profileInfo, null, 2) }
        ],
        temperature: 0.5,
      });

      // Extract and parse the hashtags from the response
      const content = completion.choices[0]?.message?.content || "[]";
      
      // Try to parse the JSON array
      try {
        const hashtags = JSON.parse(content);
        if (Array.isArray(hashtags)) {
          return hashtags.filter(tag => typeof tag === 'string');
        }
      } catch (error) {
        debugError("Error parsing hashtags JSON:", error);
        // If parsing fails, try to extract hashtags using regex
        const matches = content.match(/["']([^"']+)["']/g);
        if (matches) {
          return matches.map((m: string) => m.replace(/["']/g, ''));
        }
      }
      
      return [];
    } catch (error) {
      debugError("Error extracting hashtags:", error);
      throw error;
    }
  }
}