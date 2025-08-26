/**
 * Markdown document importer
 */

import { sha256 } from "@noble/hashes/sha2";
import { Doc } from "../docstore/interfaces.js";
import { DocImporter } from "./index.js";
import { randomUUID } from "crypto";
import { bytesToHex } from "nostr-tools/utils";

/**
 * Importer for Markdown documents
 * Converts Markdown strings to Doc objects
 */
export class MarkdownImporter implements DocImporter {
  /**
   * Create a Doc object from a Markdown string
   * @param data - Markdown string content
   * @returns Promise resolving to a Doc object
   */
  async createDoc(data: string): Promise<Doc> {
    // Validate that the input is a string
    if (typeof data !== "string") {
      throw new Error("Invalid Markdown: input must be a string");
    }

    // Create timestamps (current time in seconds)
    const timestamp = Math.floor(Date.now() / 1000);
    
    // Content hash
    const id = bytesToHex(sha256(data));

    // Create Doc object
    const doc: Doc = {
      id,
      docstore_id: "", // This will be set when the document is added to a docstore
      timestamp,
      created_at: timestamp, // Same as timestamp for new documents
      type: "markdown",
      data, // Use the markdown string directly as the data field
      embeddings: [],
      // leaving file and metadata empty
    };

    return doc;
  }
}