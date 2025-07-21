import { Command } from "commander";
import { AskExpertsClient } from "../../client/AskExpertsClient.js";
import { FORMAT_OPENAI, COMPRESSION_GZIP } from "../../common/constants.js";
import { LightningPaymentManager } from "../../lightning/LightningPaymentManager.js";
import { debugMCP, debugError, debugClient, enableAllDebug, enableErrorDebug } from '../../common/debug.js';
import * as readline from 'readline';

/**
 * Options for the chat command
 */
export interface ChatCommandOptions {
  nwc?: string;
  relays?: string[];
  maxAmount?: string;
  debug?: boolean;
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
export async function executeChatCommand(expertPubkey: string, options: ChatCommandOptions): Promise<void> {
  // Initialize message history for the conversation
  const messageHistory: ChatMessage[] = [];
  // Try to get NWC connection string from options or environment variables
  const nwcString = options.nwc || process.env.NWC_STRING;
  
  // Validate NWC connection string
  if (!nwcString) {
    throw new Error('NWC connection string is required. Use --nwc option or set NWC_STRING environment variable.');
  }
  
  // Try to get discovery relays from options or environment variables
  let discoveryRelays: string[] | undefined = options.relays;
  if (!discoveryRelays && process.env.DISCOVERY_RELAYS) {
    discoveryRelays = process.env.DISCOVERY_RELAYS.split(',').map(relay => relay.trim());
  }

  // Parse max amount
  const maxAmountSats = options.maxAmount ? parseInt(options.maxAmount, 10) : 100;
  if (isNaN(maxAmountSats) || maxAmountSats <= 0) {
    throw new Error('Maximum amount must be a positive number.');
  }

  try {
    // Create the payment manager
    const paymentManager = new LightningPaymentManager(nwcString);
    
    // Create the client
    const client = new AskExpertsClient({
      discoveryRelays,
      onQuote: async (quote, prompt) => {
        // Find the lightning invoice
        const lightningInvoice = quote.invoices.find(inv => inv.method === 'lightning');
        if (!lightningInvoice || !lightningInvoice.invoice) {
          debugClient('No lightning invoice found in quote');
          return false;
        }
        
        // Check if the amount is within the max amount
        if (lightningInvoice.amount <= maxAmountSats) {
          debugClient(`Accepting payment of ${lightningInvoice.amount} sats`);
          return true;
        } else {
          debugClient(`Rejecting payment: amount ${lightningInvoice.amount} exceeds max ${maxAmountSats}`);
          return false;
        }
      },
      onPay: async (quote, prompt) => {
        // Find the lightning invoice
        const lightningInvoice = quote.invoices.find(inv => inv.method === 'lightning');
        if (!lightningInvoice || !lightningInvoice.invoice) {
          throw new Error('No lightning invoice found in quote');
        }
        
        debugClient(`Paying ${lightningInvoice.amount} sats...`);
        
        // Pay the invoice
        const preimage = await paymentManager.payInvoice(lightningInvoice.invoice);
        
        // Return the proof
        return {
          method: 'lightning',
          preimage,
        };
      }
    });
    
    debugClient(`Starting chat with expert ${expertPubkey}`);
    debugClient(`Maximum payment per message: ${maxAmountSats} sats`);
    console.log('Type your messages and press Enter to send. Type "exit" to quit.');
    console.log('-----------------------------------------------------------');
    
    // Create readline interface for reading user input
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
      prompt: '> '
    });
    
    // Start the prompt
    rl.prompt();
    
    // Handle user input
    rl.on('line', async (line) => {
      // Check if user wants to exit
      if (line.trim().toLowerCase() === 'exit') {
        rl.close();
        return;
      }
      
      // Get the user's message
      const message = line.trim();
      if (!message) {
        rl.prompt();
        return;
      }
      
      try {
        console.log(`Sending message to expert...`);
        
        debugClient(`Sending message to expert ${expertPubkey}...`);
        
        // First fetch the expert's profile to get their relays
        const experts = await client.fetchExperts({
          pubkeys: [expertPubkey]
        });
        
        if (experts.length === 0) {
          console.log(`Expert ${expertPubkey} not found. Make sure they have published an expert profile.`);
          rl.prompt();
          return;
        }
        
        const expert = experts[0];
        debugClient(`Found expert: ${expert.description}`);
        
        // Add user message to history
        messageHistory.push({
          role: "user",
          content: message
        });
        
        // Create OpenAI format request with message history
        const openaiRequest = {
          model: expertPubkey,
          messages: messageHistory
        };
        console.log("openaiRequest", JSON.stringify(openaiRequest));
        
        debugClient(`Sending message with history (${messageHistory.length} messages) to expert ${expertPubkey}`);
        
        // Ask the expert using OpenAI format
        const replies = await client.askExpert({
          expert,
          content: openaiRequest,
          format: FORMAT_OPENAI,
          compr: COMPRESSION_GZIP
        });
        
        // Process the replies
        let responseContent = null;
        
        // Iterate through the replies
        for await (const reply of replies) {
          if (reply.done) {
            debugClient(`Received final reply from expert ${expertPubkey}`);
            
            // OpenAI format response
            responseContent = reply.content;
            
            // Extract the assistant's message from the response
            if (responseContent &&
                responseContent.choices &&
                responseContent.choices.length > 0 &&
                responseContent.choices[0].message) {
              
              const assistantMessage = responseContent.choices[0].message;
              
              // Add the assistant's response to the message history
              messageHistory.push({
                role: "assistant",
                content: assistantMessage.content
              });
              
              // Display the response to the user
              console.log(`Expert reply:`);
              console.log(assistantMessage.content);
            } else {
              debugError("Received invalid response format from expert:", JSON.stringify(responseContent, null, 2));
              console.error("Received invalid response format from expert: ", JSON.stringify(responseContent, null, 2));
            }
          }
        }
      } catch (error) {
        debugError('Error sending message:', error instanceof Error ? error.message : String(error));
        console.error(`Error: ${error instanceof Error ? error.message : String(error)}`);
      }
      
      console.log('-----------------------------------------------------------');
      rl.prompt();
    });
    
    // Handle readline close
    rl.on('close', () => {
      debugClient('Chat session ended');
      console.log('Chat ended.');
      
      // Dispose of the client and payment manager resources
      client[Symbol.dispose]();
      paymentManager[Symbol.dispose]();
      
      process.exit(0);
    });
    
  } catch (error) {
    debugError('Failed to execute chat command:', error);
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
    .option("-n, --nwc <string>", "NWC connection string for payments")
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