import { Command } from "commander";
import fs from "fs/promises";
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

/**
 * Options for the twitter import command
 */
interface TwitterImportOptions extends DocstoreCommandOptions {
  debug?: boolean;
}

/**
 * Import Twitter tweets into a docstore
 * @param filePath - Path to the JSON file containing tweets
 * @param options - Command options
 */
export async function importTwitter(
  filePath: string,
  options: TwitterImportOptions
): Promise<void> {
  try {
    // Enable debug output if debug flag is set
    if (options.debug) {
      enableAllDebug();
    }

    const docstoreClient: DocStoreClient = await createDocstoreClient(options);

    // Get docstore ID
    const docstore = await getDocstore(docstoreClient, options.docstore);

    debugDocstore(`Importing Twitter tweets from file: ${filePath}`);

    // Read the file
    let fileContent = await fs.readFile(filePath, 'utf-8');
    let tweets;
    
    try {
      if (fileContent.startsWith("window.YTD.tweets.part0 = ")) {
        fileContent = fileContent.substring("window.YTD.tweets.part0 = ".length)
      }

      // Parse the JSON content
      const jsonContent: any = JSON.parse(fileContent);
      tweets = jsonContent.map((t: any) => t.tweet);
      
      // // Handle different possible formats
      // if (Array.isArray(jsonContent)) {
      //   tweets = jsonContent;
      // } else if (jsonContent.tweet) {
      //   // Single tweet in an object with 'tweet' property
      //   tweets = [jsonContent.tweet];
      // } else if (jsonContent.tweets) {
      //   // Array of tweets in a 'tweets' property
      //   tweets = jsonContent.tweets;
      // } else {
      //   // Assume it's a single tweet
      //   tweets = [jsonContent];
      // }
    } catch (error) {
      throw new Error(`Failed to parse JSON file: ${error instanceof Error ? error.message : String(error)}`);
    }

    debugDocstore(`Found ${tweets.length} tweets. Preparing embeddings...`);

    // Initialize embeddings
    const embeddings = createRagEmbeddings(docstore.model);
    await embeddings.start();

    // Get twitter importer
    const importer = await createDocImporter("twitter");

    // Process each tweet
    let successCount = 0;
    for (const tweet of tweets) {
      try {
        // Convert to doc
        let doc = await importer.createDoc(tweet);
        doc.docstore_id = docstore.id;

        // Generate embeddings and update doc with embeddings and embedding_offsets
        doc = await embeddings.embedDoc(doc);

        // Add to docstore
        await docstoreClient.upsert(doc);
        successCount++;

        // Log progress
        if (successCount % 10 === 0) {
          debugDocstore(`Processed ${successCount}/${tweets.length} tweets`);
        }
      } catch (error) {
        debugError(
          `Error processing tweet ${tweet.id_str}: ${
            error instanceof Error ? error.message : String(error)
          }`
        );
      }
    }

    debugDocstore(`Successfully imported ${successCount} Twitter tweets`);
    docstoreClient[Symbol.dispose]();
  } catch (error) {
    debugError(
      `Error importing Twitter tweets: ${
        error instanceof Error ? error.message : String(error)
      }`
    );
    process.exit(1);
  }
}

/**
 * Register the twitter import command
 * @param importCommand - The parent import command
 */
export function registerTwitterImportCommand(
  importCommand: Command,
  addCommonOptions: (cmd: Command) => Command
): void {
  const twitterCommand = importCommand
    .command("twitter")
    .description("Import Twitter tweets from a JSON file")
    .argument("<file>", "Path to the JSON file containing tweets")
    .option(
      "-s, --docstore <id>",
      "ID of the docstore (required if more than one docstore exists)"
    )
    .action(importTwitter);

  addCommonOptions(twitterCommand);
}