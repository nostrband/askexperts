import { Command } from "commander";
import { AskExpertsClient } from "../../client/AskExpertsClient.js";
import { FORMAT_OPENAI } from "../../common/constants.js";
import { LightningPaymentManager } from "../../payments/LightningPaymentManager.js";
import {
  debugMCP,
  debugError,
  debugClient,
  enableAllDebug,
  enableErrorDebug,
} from "../../common/debug.js";
import * as readline from "readline";
import { Expert } from "../../common/types.js";
import { getWalletByNameOrDefault } from "./wallet/utils.js";
import { COMPRESSION_GZIP } from "../../stream/compression.js";

/**
 * Options for the chat command
 */
export interface ChatCommandOptions {
  wallet?: string;
  relays?: string[];
  maxAmount?: string;
  debug?: boolean;
  stream?: boolean;
}

/**
 * Message in OpenAI chat format
 */
interface ChatMessage {
  role: "user" | "assistant";
  content: string;
}

/**
 * Execute the chat command with the given options and expert pubkey
 *
 * @param expertPubkey The pubkey of the expert to chat with
 * @param options Command line options
 */
export async function executeChatCommand(
  expertPubkey: string,
  options: ChatCommandOptions
): Promise<void> {
  // Initialize message history for the conversation
  const messageHistory: ChatMessage[] = [];
  // Get wallet from database using the provided wallet name or default
  const wallet = getWalletByNameOrDefault(options.wallet);
  const nwcString = wallet.nwc;

  // Try to get discovery relays from options or environment variables
  let discoveryRelays: string[] | undefined = options.relays;
  if (!discoveryRelays && process.env.DISCOVERY_RELAYS) {
    discoveryRelays = process.env.DISCOVERY_RELAYS.split(",").map((relay) =>
      relay.trim()
    );
  }

  // Parse max amount
  const maxAmountSats = options.maxAmount
    ? parseInt(options.maxAmount, 10)
    : 100;
  if (isNaN(maxAmountSats) || maxAmountSats <= 0) {
    throw new Error("Maximum amount must be a positive number.");
  }

  try {
    // Create the payment manager
    const paymentManager = new LightningPaymentManager(nwcString);
    let expert: Expert;

    // Create the client
    const client = new AskExpertsClient({
      discoveryRelays,
      onQuote: async (quote, prompt) => {
        // Find the lightning invoice
        const lightningInvoice = quote.invoices.find(
          (inv) => inv.method === "lightning"
        );
        if (!lightningInvoice || !lightningInvoice.invoice) {
          debugClient("No lightning invoice found in quote");
          return false;
        }

        // Check if the amount is within the max amount
        if (lightningInvoice.amount <= maxAmountSats) {
          debugClient(`Accepting payment of ${lightningInvoice.amount} sats`);
          return true;
        } else {
          debugClient(
            `Rejecting payment: amount ${lightningInvoice.amount} exceeds max ${maxAmountSats}`
          );
          return false;
        }
      },
      onPay: async (quote, prompt) => {
        // Find the lightning invoice
        const lightningInvoice = quote.invoices.find(
          (inv) => inv.method === "lightning"
        );
        if (!lightningInvoice || !lightningInvoice.invoice) {
          throw new Error("No lightning invoice found in quote");
        }

        debugClient(`Paying ${lightningInvoice.amount} sats...`);

        // Pay the invoice
        const preimage = await paymentManager.payInvoice(
          lightningInvoice.invoice
        );
        console.log(
          `Paid ${lightningInvoice.amount} sats to ${expert?.name || "expert"}.`
        );

        // Return the proof
        return {
          method: "lightning",
          preimage,
        };
      },
    });

    debugClient(`Starting chat with expert ${expertPubkey}`);
    debugClient(`Maximum payment per message: ${maxAmountSats} sats`);

    // Fetch the expert's profile once at the beginning
    debugClient(`Fetching expert profile for ${expertPubkey}...`);
    const experts = await client.fetchExperts({
      pubkeys: [expertPubkey],
    });

    if (experts.length === 0) {
      throw new Error(
        `Expert ${expertPubkey} not found. Make sure they have published an expert profile.`
      );
    }

    expert = experts[0];
    debugClient(`Found expert: ${expert.description}`);

    // Verify that the expert supports FORMAT_OPENAI
    if (!expert.formats.includes(FORMAT_OPENAI)) {
      throw new Error(
        `Expert ${expertPubkey} doesn't support OpenAI format. Supported formats: ${expert.formats.join(
          ", "
        )}`
      );
    }

    console.log(`Expert: ${expert.name}`);
    console.log(`Description: ${expert.description}`);
    console.log("-----------------------------------------------------------");
    console.log(
      'Type your messages and press Enter to send. Type "exit" to quit.'
    );
    console.log("-----------------------------------------------------------");

    // Create readline interface for reading user input
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

      const start = Date.now();
      try {
        debugClient(`Sending message to expert ${expertPubkey}...`);

        // Add user message to history
        messageHistory.push({
          role: "user",
          content: message,
        });

        // Create OpenAI format request with message history
        const openaiRequest = {
          model: expertPubkey,
          messages: messageHistory,
          stream: !!options.stream,
        };

        debugClient(
          `Sending message with history (${messageHistory.length} messages) to expert ${expertPubkey}`
        );

        // Ask the expert using OpenAI format
        const replies = await client.askExpert({
          expert,
          content: openaiRequest,
          format: FORMAT_OPENAI,
          stream: true,
        });

        // Process the replies
        let expertReply: string = "";
        let first = true;

        // Iterate through the replies
        for await (const reply of replies) {
          // console.log("chunk", JSON.stringify(reply.content, null, 2));
          if (first) process.stdout.write(`${expert.name || "Expert"} > `);
          first = false;

          if (reply.done) {
            debugClient(`Received final reply from expert ${expertPubkey}`);

            // OpenAI format response
            let chunk = "";
            if (options.stream) {
              for (const c of reply.content) {
                chunk +=
                  c.choices[0]?.[options.stream ? "delta" : "message"].content;
              }
            } else {
              chunk = reply.content.choices[0]?.message.content;
            }
            expertReply += chunk;
            console.log(chunk);
          } else {
            debugClient(`Received chunk from expert ${expertPubkey}`);
            let chunk = "";
            for (const c of reply.content) {
              chunk += c.choices[0]?.delta.content;
            }
            expertReply += chunk;
            process.stdout.write(chunk);
          }
        }

        // Add the full expert's response to the message history
        if (expertReply)
          messageHistory.push({
            role: "assistant",
            content: expertReply,
          });
      } catch (error) {
        debugError(
          "Error sending message:",
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
      rl.prompt();
    });

    // Handle readline close
    rl.on("close", () => {
      debugClient("Chat session ended");
      console.log("Chat ended.");

      // Dispose of the client and payment manager resources
      client[Symbol.dispose]();
      paymentManager[Symbol.dispose]();

      process.exit(0);
    });
  } catch (error) {
    debugError("Failed to execute chat command:", error);
    throw error;
  }
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
    .description("Start a chat with a specific expert")
    .argument("<expert-pubkey>", "The pubkey of the expert to chat with")
    .option(
      "-w, --wallet <name>",
      "Wallet name to use for payments (uses default if not specified)"
    )
    .option(
      "-r, --relays <items>",
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
    .action(async (expertPubkey, options) => {
      if (options.debug) enableAllDebug();
      else enableErrorDebug();
      try {
        await executeChatCommand(expertPubkey, options);
      } catch (error) {
        debugError("Error executing chat command:", error);
        process.exit(1);
      }
    });
}
