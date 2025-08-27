/**
 * Document importer interfaces and factory
 */

import { Doc } from "../docstore/interfaces.js";
import { NostrImporter } from "./nostr.js";
import { MarkdownImporter } from "./markdown.js";
import { TwitterImporter } from "./twitter.js";

/**
 * Interface for document importers
 * Each importer converts a specific document type to a Doc object
 */
export interface DocImporter {
  /**
   * Create a Doc object from input data
   * @param data - Input data specific to the document type
   * @returns Promise resolving to a Doc object
   */
  createDoc(data: any): Promise<Doc>;
}

/**
 * Factory function to create a document importer for a specific type
 * @param type - Document type (e.g., "nostr")
 * @returns Promise resolving to a DocImporter instance
 * @throws Error if the importer type is not supported
 */
export async function createDocImporter(type: string): Promise<DocImporter> {
  switch (type.toLowerCase()) {
    case "nostr":
      return new NostrImporter();
    case "markdown":
      return new MarkdownImporter();
    case "twitter":
      return new TwitterImporter();
    default:
      throw new Error(`Unsupported document importer type: ${type}`);
  }
}