import { Command } from "commander";
import { AskExpertsChatClient } from "../../client/AskExpertsChatClient.js";
import {
  debugError,
  enableAllDebug,
  enableErrorDebug,
} from "../../common/debug.js";
import * as readline from "readline";
import { DBExpert } from "../../db/interfaces.js";
import * as fs from "fs";
import * as path from "path";
import { getWalletByNameOrDefault } from "./wallet/utils.js";
import { createDBClientForCommands } from "./utils.js";
import { Expert, Quote } from "../../common/types.js";
import { METHOD_LIGHTNING } from "../../common/constants.js";
import { parseBolt11 } from "../../common/bolt11.js";

/**
 * Options for the chat command
 */
export interface ChatCommandOptions {
  wallet?: string;
  relays?: string[];
  maxAmount?: string;
  debug?: boolean;
  stream?: boolean;
  stdin?: boolean;
  remote?: boolean;
  url?: string;
}

/**
 * Execute the chat command with the given options and expert pubkey
 *
 * @param expertPubkey The pubkey of the expert to chat with
 * @param options Command line options
 */
export async function executeChatCommand(
  expertIdentifier: string,
  options: ChatCommandOptions
): Promise<void> {
  try {
    const db = await createDBClientForCommands(options);

    // Check if the identifier is a pubkey or a nickname
    let expertPubkey = expertIdentifier;
    let foundByNickname = false;

    // Try to find expert by nickname if it doesn't look like a pubkey
    if (
      !expertIdentifier.startsWith("npub") &&
      expertIdentifier.length !== 64
    ) {
      const experts = await db.listExperts();
      const expertByNickname = experts.find(
        (expert: DBExpert) =>
          expert.nickname?.toLowerCase() === expertIdentifier.toLowerCase()
      );

      if (expertByNickname) {
        expertPubkey = expertByNickname.pubkey;
        foundByNickname = true;
        debugError(
          `Found expert with nickname "${expertIdentifier}", using pubkey: ${expertPubkey}`
        );
      } else {
        // If not found by nickname, assume it's a pubkey
        debugError(
          `No expert found with nickname "${expertIdentifier}", assuming it's a pubkey`
        );
      }
    }

    // Get the wallet and NWC string
    const wallet = await getWalletByNameOrDefault(db, options.wallet);
    const nwcString = wallet.nwc;

    if (!nwcString) {
      throw new Error(
        `Wallet ${
          options.wallet || "default"
        } does not have an NWC string configured.`
      );
    }

    // Create the chat client with the NWC string
    let expert: Expert;
    const chatClient = new AskExpertsChatClient(expertPubkey, {
      nwcString,
      discoveryRelays: options.relays,
      maxAmount: options.maxAmount,
      stream: options.stream,
      onPaid: async (prompt, quote: Quote, proof, fees_msat): Promise<void> => {
        try {
          // Find the lightning invoice
          const lightningInvoice = quote.invoices.find(
            (inv) => inv.method === METHOD_LIGHTNING
          );

          if (lightningInvoice && lightningInvoice.invoice) {
            // Parse the invoice to get the amount
            const { amount_sats } = parseBolt11(lightningInvoice.invoice);

            // Get expert name or use a default
            const expertName = expert.name || "Expert";

            // Print payment information to console
            console.log(
              `Paid ${amount_sats}+${Math.ceil(
                fees_msat / 1000
              )} sats to ${expertName}`
            );
          }
        } catch (error) {
          debugError("Error in onPaid callback:", error);
        }
      },
    });

    // Initialize the client and fetch expert profile
    expert = await chatClient.initialize();

    if (foundByNickname) {
      console.log(`Expert: ${expert.name} (nickname: ${expertIdentifier})`);
    } else {
      console.log(`Expert: ${expert.name}`);
    }
    console.log(`Description: ${expert.description}`);
    console.log("-----------------------------------------------------------");
    console.log(
      'Type your messages and press Enter to send. Type "exit" to quit.'
    );
    console.log("-----------------------------------------------------------");

    // Function to process an image and return the appropriate text
    const processImage = (image: string): string => {
      if (image.startsWith("data:")) {
        // It's a data URL, decode and save to file
        try {
          // Parse the data URL
          const match = image.match(/^data:image\/([^;]+);base64,(.+)$/);
          if (!match) {
            return `Invalid data URL format for image\n`;
          }
          
          const [, imageType, base64Data] = match;
          
          // Decode the base64 data
          const binaryData = Buffer.from(base64Data, 'base64');
          
          // Generate filename with current datetime
          const now = new Date();
          const datetime = now.toISOString().replace(/[:.]/g, '-').replace('T', '_').slice(0, 19);
          const filename = `image_${datetime}.${imageType}`;
          
          // Save to current directory
          fs.writeFileSync(filename, binaryData);
          
          return `Image saved to ${filename}\n`;
        } catch (error) {
          debugError("Error processing data URL image:", error);
          return `Error saving image: ${error instanceof Error ? error.message : String(error)}\n`;
        }
      } else {
        // Not a data URL, just print the reference
        return `Image ${image}. `;
      }
    };

    // Function to process a message and get a response
    const processMessage = async (message: string): Promise<void> => {
      if (!message) {
        return;
      }

      const start = Date.now();
      try {
        // Process the message using the chat client
        const expertReply = await chatClient.processMessageExt(message, (reply) => {
          // Handle text output
          if (reply.text) {
            process.stdout.write(reply.text);
          }
          
          // Handle images
          if (reply.images) {
            for (const image of reply.images) {
              const imageText = processImage(image);
              if (imageText) {
                process.stdout.write(imageText);
              }
            }
          }
        });

        // Display the expert's reply
        if (options.stream) {
          // In stream mode, the output is already written to stdout
          // Just add a newline at the end
          console.log();
        } else {
          // In non-stream mode, write the full reply
          process.stdout.write(`${expert.name || "Expert"} > ${expertReply.text}`);
          
          // Handle images in non-stream mode
          if (expertReply.images) {
            for (const image of expertReply.images) {
              const imageText = processImage(image);
              if (imageText) {
                process.stdout.write(imageText);
              }
            }
          }
          
          console.log();
        }
      } catch (error) {
        debugError(
          "Error in chat:",
          error instanceof Error ? error.message : String(error)
        );
        console.error(
          `Error: ${error instanceof Error ? error.message : String(error)}`
        );
      }

      console.log(
        `-------------------------(${
          Date.now() - start
        } ms)----------------------------`
      );
    };

    // Check if we should read from stdin
    if (options.stdin) {
      // Read the first message from stdin
      let stdinMessage = "";
      const stdinChunks: Buffer[] = [];

      process.stdin.on("data", (chunk) => {
        stdinChunks.push(chunk);
      });

      process.stdin.on("end", async () => {
        stdinMessage = Buffer.concat(stdinChunks).toString().trim();
        if (stdinMessage) {
          await processMessage(stdinMessage);

          // Dispose of resources and exit
          chatClient[Symbol.dispose]();
          process.exit(0);
        } else {
          console.error("Error: No message provided via stdin");
          process.exit(1);
        }
      });

      // Make sure stdin is in flowing mode
      process.stdin.resume();
    } else {
      // Interactive mode with readline
      const rl = readline.createInterface({
        input: process.stdin,
        output: process.stdout,
        prompt: "You > ",
      });

      // Start the prompt
      rl.prompt();

      // Handle user input
      rl.on("line", async (line) => {
        // Check if user wants to exit
        if (line.trim().toLowerCase() === "exit") {
          rl.close();
          return;
        }

        // Get the user's message
        const message = line.trim();
        if (!message) {
          rl.prompt();
          return;
        }

        // Process file attachments
        const processedMessage = await processFileAttachments(message, rl);

        await processMessage(processedMessage);
        rl.prompt();
      });

      // Handle readline close
      rl.on("close", () => {
        console.log("Chat ended.");

        // Dispose of the chat client resources
        chatClient[Symbol.dispose]();

        process.exit(0);
      });
    }
  } catch (error) {
    debugError("Failed to execute chat command:", error);
    throw error;
  }
}

/**
 * Process a message to handle file attachments
 *
 * @param message The original message
 * @param rl The readline interface to use for confirmation prompts
 * @returns The processed message with file contents appended (if any)
 */
async function processFileAttachments(
  message: string,
  rl: readline.Interface
): Promise<string> {
  // Regular expression to match attach_file: prefix
  const attachFileRegex = /\battach_file:([^\s]+)\b/g;

  // Find all file paths in the message
  const filePaths: string[] = [];
  let match;
  while ((match = attachFileRegex.exec(message)) !== null) {
    filePaths.push(match[1]);
  }

  // If no file attachments, return the original message
  if (filePaths.length === 0) {
    return message;
  }

  // Remove all attach_file: words from the message
  let processedMessage = message.replace(attachFileRegex, "").trim();

  // Process each file
  for (const filePath of filePaths) {
    try {
      // Ask for confirmation
      const answer = await new Promise<string>((resolve) => {
        rl.question(`Attach file ${filePath}? y/N `, resolve);
      });

      // If confirmed, read the file and append to message
      if (answer.toLowerCase() === "y") {
        try {
          // Resolve the file path (handle relative paths)
          const resolvedPath = path.resolve(filePath);

          // Read the file as UTF-8
          const fileContent = fs.readFileSync(resolvedPath, "utf8");

          // Append the file content to the message
          processedMessage += `\n${fileContent}`;

          debugError(`Attached file: ${filePath}`);
        } catch (error) {
          console.error(
            `Error reading file ${filePath}: ${
              error instanceof Error ? error.message : String(error)
            }`
          );
        }
      }
    } catch (error) {
      debugError(`Error processing file ${filePath}:`, error);
    }
  }

  return processedMessage;
}

/**
 * Helper function to parse comma-separated lists
 * @param value The comma-separated string
 * @returns Array of trimmed strings
 */
function commaSeparatedList(value: string): string[] {
  return value.split(",").map((item) => item.trim());
}

/**
 * Register the chat command with the CLI
 *
 * @param program The commander program
 */
export function registerChatCommand(program: Command): void {
  program
    .command("chat")
    .description("Start a chat with a specific expert using pubkey or nickname")
    .argument(
      "<expert-identifier>",
      "The pubkey or nickname of the expert to chat with"
    )
    .option(
      "-w, --wallet <name>",
      "Wallet name to use for payments (uses default if not specified)"
    )
    .option(
      "--relays <items>",
      "Comma-separated list of discovery relays",
      commaSeparatedList
    )
    .option(
      "-m, --max-amount <number>",
      "Maximum amount to pay in satoshis per message",
      "100"
    )
    .option("-d, --debug", "Enable debug logging")
    .option("-s, --stream", "Enable streaming")
    .option("--stdin", "Read first message from stdin and exit after reply")
    .option("-r, --remote", "Use remote wallet client")
    .option(
      "-u, --url <url>",
      "URL of remote wallet server (default: https://api.askexperts.io)"
    )
    .action(async (expertIdentifier, options) => {
      if (options.debug) enableAllDebug();
      else enableErrorDebug();
      try {
        await executeChatCommand(expertIdentifier, options);
      } catch (error) {
        debugError("Error executing chat command:", error);
        process.exit(1);
      }
    });
}
