/**
 * Twitter tweet importer
 */

import { Doc } from "../docstore/interfaces.js";
import { DocImporter } from "./index.js";

/**
 * Interface for Twitter tweet structure
 */
interface Tweet {
  id_str: string;
  created_at: string;
  full_text: string;
  entities?: {
    hashtags?: Array<{ text: string }>;
    user_mentions?: Array<{ screen_name: string; name: string }>;
  };
  user?: {
    screen_name: string;
    name: string;
  };
  lang?: string;
}

/**
 * Importer for Twitter tweets
 * Converts Twitter tweets to Doc objects
 */
export class TwitterImporter implements DocImporter {
  
  private encoder = new TextEncoder();

  /**
   * Create a Doc object from a Twitter tweet
   * @param data - Twitter tweet in JSON format
   * @returns Promise resolving to a Doc object
   * @throws Error if the input is not a valid Twitter tweet
   */
  async createDoc(data: any): Promise<Doc> {
    // Validate that the input is a Twitter tweet
    if (!this.isValidTweet(data)) {
      throw new Error("Invalid Twitter tweet");
    }

    const tweet = data as Tweet;
    
    // Create timestamp (current time in seconds)
    const timestamp = Math.floor(Date.now() / 1000);
    
    // Parse created_at to get Unix timestamp
    const createdAt = new Date(tweet.created_at).getTime() / 1000;
    
    // Extract hashtags if available
    const hashtags = tweet.entities?.hashtags?.map(h => h.text) || [];
    
    // Extract mentions if available
    const mentions = tweet.entities?.user_mentions?.map(m => m.screen_name) || [];
    
    // Format metadata
    const metadata = `
id: ${tweet.id_str}
hashtags: ${hashtags.join(',')}
created_at: ${new Date(tweet.created_at).toUTCString()}
author: ${tweet.user?.screen_name || 'unknown'}
mentions: ${mentions.join(',')}
language: ${tweet.lang || 'unknown'}
`;

    // Create Doc object
    const doc: Doc = {
      id: `twitter:${tweet.id_str}`,
      docstore_id: "", 
      timestamp: timestamp,
      created_at: createdAt,
      type: "twitter",
      data: tweet.full_text,
      file: this.encoder.encode(JSON.stringify(tweet)),
      metadata,
      embeddings: [],
    };

    return doc;
  }

  /**
   * Check if the input is a valid Twitter tweet
   * @param data - Data to validate
   * @returns Boolean indicating if the data is a valid Twitter tweet
   */
  private isValidTweet(data: any): boolean {
    // Basic validation of Twitter tweet structure
    return (
      data &&
      typeof data === "object" &&
      typeof data.id_str === "string" &&
      typeof data.created_at === "string" &&
      typeof data.full_text === "string"
    );
  }
}