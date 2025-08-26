import { Command } from "commander";
import {
  Doc,
  DocStoreClient,
} from "../../../../docstore/index.js";
import {
  DocstoreCommandOptions,
  getDocstore,
  createDocstoreClient,
} from "../index.js";
import {
  debugError,
  debugDocstore,
  enableAllDebug,
} from "../../../../common/debug.js";
import { createRagEmbeddings } from "../../../../rag/index.js";
import { createDocImporter } from "../../../../import/index.js";
import fs from "fs/promises";
import path from "path";

/**
 * Options for the markdown import command
 */
interface MarkdownImportOptions extends DocstoreCommandOptions {
  debug?: boolean;
  file?: string;
  content?: string;
}

/**
 * Import markdown content into a docstore
 * @param options - Command options
 */
export async function importMarkdown(
  options: MarkdownImportOptions
): Promise<void> {
  try {
    // Enable debug output if debug flag is set
    if (options.debug) {
      enableAllDebug();
    }

    const docstoreClient: DocStoreClient = await createDocstoreClient(options);

    // Get docstore ID
    const docstore = await getDocstore(docstoreClient, options.docstore);

    // Get markdown content
    let markdownContent: string;
    
    if (options.content) {
      // Use provided content directly
      markdownContent = options.content;
    } else if (options.file) {
      // Read from file
      try {
        markdownContent = await fs.readFile(options.file, 'utf-8');
      } catch (error) {
        throw new Error(`Failed to read markdown file: ${error instanceof Error ? error.message : String(error)}`);
      }
    } else {
      throw new Error("Either --file or --content must be provided");
    }

    debugDocstore(`Importing markdown content`);
    if (options.file) {
      debugDocstore(`Source: File ${options.file}`);
    } else {
      debugDocstore(`Source: Direct content (${markdownContent.length} characters)`);
    }

    // Initialize embeddings
    const embeddings = createRagEmbeddings(docstore.model);
    await embeddings.start();

    // Get markdown importer
    const markdownImporter = await createDocImporter("markdown");
    
    // Create document from markdown
    const doc = await markdownImporter.createDoc(markdownContent);
    
    // Generate embeddings
    const chunks = await embeddings.embed(markdownContent);

    // Convert embeddings from number[][] to Float32Array[]
    const float32Embeddings = chunks.map((c) => {
      const float32Array = new Float32Array(c.embedding.length);
      for (let i = 0; i < c.embedding.length; i++) {
        float32Array[i] = c.embedding[i];
      }
      return float32Array;
    });

    // Create final document with docstore ID and embeddings
    doc.docstore_id = docstore.id;
    doc.embeddings = float32Embeddings;

    // Add to docstore
    await docstoreClient.upsert(doc);

    debugDocstore(`Successfully imported markdown content with ID: ${doc.id}`);
    docstoreClient[Symbol.dispose]();
  } catch (error) {
    debugError(
      `Error importing markdown: ${
        error instanceof Error ? error.message : String(error)
      }`
    );
    process.exit(1);
  }
}

/**
 * Register the markdown import command
 * @param importCommand - The parent import command
 * @param addCommonOptions - Function to add common options to commands
 */
export function registerMarkdownImportCommand(
  importCommand: Command,
  addCommonOptions: (cmd: Command) => Command
): void {
  const markdownCommand = importCommand
    .command("markdown")
    .description("Import markdown content")
    .option(
      "-s, --docstore <id>",
      "ID of the docstore (required if more than one docstore exists)"
    )
    .option(
      "-f, --file <path>",
      "Path to markdown file to import"
    )
    .option(
      "-c, --content <string>",
      "Direct markdown content to import"
    )
    .action(importMarkdown);

  addCommonOptions(markdownCommand);
}