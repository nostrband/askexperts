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
  async createDoc(file: { url: string; content: string }): Promise<Doc> {
    // Create timestamps (current time in seconds)
    const timestamp = Math.floor(Date.now() / 1000);

    // Metadata
    const metadata = `
url: ${file.url}
`;

    // Content hash
    const id = bytesToHex(sha256(file.content + file.url));

    // Create Doc object
    const doc: Doc = {
      id,
      docstore_id: "", // This will be set when the document is added to a docstore
      timestamp,
      created_at: timestamp, // Same as timestamp for new documents
      type: "markdown",
      data: file.content, // Use the markdown string directly as the data field
      metadata,
      embeddings: [],
    };

    return doc;
  }
}
