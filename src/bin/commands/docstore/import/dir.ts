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
import fs from "fs/promises";
import path from "path";
import { DOC_FILE_EXT } from "../../../../common/constants.js";

/**
 * Options for the directory import command
 */
interface DirImportOptions extends DocstoreCommandOptions {
  debug?: boolean;
  remove?: boolean;
}

/**
 * Import DOC_FILE_EXT files from a directory into a docstore
 * @param dirPath - Path to directory containing DOC_FILE_EXT files
 * @param options - Command options
 */
export async function importDir(
  dirPath: string,
  options: DirImportOptions
): Promise<void> {
  try {
    // Enable debug output if debug flag is set
    if (options.debug) {
      enableAllDebug();
    }

    const docstoreClient: DocStoreClient = await createDocstoreClient(options);

    // Get docstore ID
    const docstore = await getDocstore(docstoreClient, options.docstore);

    debugDocstore(`Scanning directory: ${dirPath} for ${DOC_FILE_EXT} files`);

    // Read directory contents
    let files: string[];
    try {
      files = await fs.readdir(dirPath);
    } catch (error) {
      throw new Error(`Failed to read directory: ${error instanceof Error ? error.message : String(error)}`);
    }

    // Filter for .doc files
    const docFiles = files.filter(file => file.endsWith(DOC_FILE_EXT));

    if (docFiles.length === 0) {
      debugDocstore(`No ${DOC_FILE_EXT} files found in ${dirPath}`);
      docstoreClient[Symbol.dispose]();
      return;
    }

    debugDocstore(`Found ${docFiles.length} ${DOC_FILE_EXT} files. Preparing embeddings...`);

    // Initialize embeddings
    const embeddings = createRagEmbeddings(docstore.model);
    await embeddings.start();

    // Process each .doc file
    let successCount = 0;
    for (const file of docFiles) {
      const filePath = path.join(dirPath, file);
      
      try {
        // Read file content
        const content = await fs.readFile(filePath, 'utf-8');
        
        // Parse content as JSON into Doc structure
        let doc: Doc;
        try {
          doc = JSON.parse(content);
        } catch (error) {
          throw new Error(`Failed to parse ${file} as JSON: ${error instanceof Error ? error.message : String(error)}`);
        }
        
        // Set docstore ID
        doc.docstore_id = docstore.id;
        
        // Generate embeddings and update doc with embeddings and embedding_offsets
        doc = await embeddings.embedDoc(doc);
        
        // Add to docstore
        await docstoreClient.upsert(doc);
        successCount++;
        
        // Delete the file if remove option is set
        if (options.remove) {
          await fs.unlink(filePath);
          debugDocstore(`Removed file after import: ${file}`);
        }
        
        // Log progress
        if (successCount % 10 === 0) {
          debugDocstore(`Processed ${successCount}/${docFiles.length} files`);
        }
      } catch (error) {
        debugError(
          `Error processing file ${file}: ${
            error instanceof Error ? error.message : String(error)
          }`
        );
      }
    }

    debugDocstore(`Successfully imported ${successCount} documents from ${DOC_FILE_EXT} files`);
    docstoreClient[Symbol.dispose]();
  } catch (error) {
    debugError(
      `Error importing from directory: ${
        error instanceof Error ? error.message : String(error)
      }`
    );
    process.exit(1);
  }
}

/**
 * Register the directory import command
 * @param importCommand - The parent import command
 * @param addCommonOptions - Function to add common options to commands
 */
export function registerDirImportCommand(
  importCommand: Command,
  addCommonOptions: (cmd: Command) => Command
): void {
  const dirCommand = importCommand
    .command("dir")
    .description(`Import ${DOC_FILE_EXT} files from a directory`)
    .argument("<path>", `Path to directory containing ${DOC_FILE_EXT} files`)
    .option(
      "-s, --docstore <id>",
      "ID of the docstore (required if more than one docstore exists)"
    )
    .option(
      "--remove",
      `Delete ${DOC_FILE_EXT} files after successful import`,
      false
    )
    .action(importDir);

  addCommonOptions(dirCommand);
}