import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { AskExpertsClient } from "../client/AskExpertsClient.js";
import { LightningPaymentManager } from "../lightning/LightningPaymentManager.js";
import { parseBolt11 } from "../common/bolt11.js";
import { debugMCP, debugError } from "../common/debug.js";
import {
  DEFAULT_DISCOVERY_RELAYS,
  FORMAT_TEXT,
  METHOD_LIGHTNING,
} from "../common/constants.js";
import { Bid, Proof, Quote, Prompt, Replies } from "../common/types.js";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { makeTool } from "./utils.js";

const BID_TTL = 3600;

/**
 * Interface for BidMCP objects returned by findExperts
 */
export interface BidMCP {
  id: string;
  expert_pubkey: string;
  offer: string;
}

/**
 * Interface for ReplyMCP objects returned by askExperts/askExpert
 */
export interface ReplyMCP {
  expert_pubkey: string;
  content?: string;
  amount_sats?: number;
  error?: string;
}

/**
 * AskExpertsMCP class that extends McpServer and provides a simplified interface
 * for clients to interact with the AskExpertsClient
 */
export class AskExpertsMCP extends McpServer {
  private client: AskExpertsClient;
  private paymentManager: LightningPaymentManager;
  private bidMap: Map<string, Bid> = new Map();

  /**
   * Creates a new AskExpertsMCP instance
   *
   * @param nwcString - NWC connection string for payments
   * @param discoveryRelays - Optional list of discovery relays
   */
  constructor(nwcString: string, discoveryRelays?: string[]) {
    if (!nwcString) {
      throw new Error("NWC connection string is required");
    }

    // Read version from package.json
    const __filename = fileURLToPath(import.meta.url);
    const __dirname = path.dirname(__filename);
    const packageJsonPath = path.resolve(__dirname, "../../../package.json"); // from dist/src/mcp
    const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, "utf8"));

    super({
      name: "askexpertsmcp",
      version: packageJson.version,
      description:
        "An MCP server that allows finding experts on a subject, asking them questions, and paying them for their answers.",
    });

    // Create the payment manager
    this.paymentManager = new LightningPaymentManager(nwcString);

    // Create the client with callbacks for quotes and payments
    this.client = new AskExpertsClient({
      discoveryRelays: discoveryRelays || DEFAULT_DISCOVERY_RELAYS,
    });

    // Register tools
    this.registerTools();
  }

  /**
   * Register all tools with the MCP server
   */
  private registerTools(): void {
    // Schema for find_experts tool
    const findExpertsConfig = {
      title: "Find Experts",
      description:
        "Find experts on a subject by posting an anonymous publicly visible summary of your question. It should omit all private details and personally identifiable information, be short, concise and include relevant hashtags. Returns a list of bids by experts who are willing to answer your question.",
      inputSchema: {
        summary: z.string().describe("A summary of the question"),
        hashtags: z
          .array(z.string())
          .describe("List of hashtags for discovery, lowercase, English, one word per hashtag"),
      },
      outputSchema: {
        bids: z
          .array(
            z.object({
              id: z.string().describe("Bid ID"),
              expert_pubkey: z.string().describe("Expert's public key"),
              offer: z.string().describe("Expert's offer description"),
            })
          )
          .describe("List of bids from experts willing to answer the question"),
      },
      annotations: {
        title: "Find experts on a subject",
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
    };

    // Register the find_experts tool
    this.registerTool(
      "find_experts",
      findExpertsConfig,
      makeTool(async (params, extra) => {
        const { summary, hashtags } = params;
        const bids = await this.findExperts(summary, hashtags);
        return { bids };
      })
    );

    // Schema for ask_experts tool
    const askExpertsConfig = {
      title: "Ask Experts",
      description:
        "After you receive bids from experts, select good ones and you can send the question to these experts. Question should be detailed and may include sensitive data as it is encrypted. For each bid, provide the id you received from find_experts tool. Provide max amount of payment you are willing to pay to each expert, good default is 100 sats.",
      inputSchema: {
        question: z.string().describe("The question to ask the experts"),
        bids: z
          .array(
            z.object({
              id: z.string().describe("Bid ID"),
            })
          )
          .describe("Array of bids to send questions to"),
        max_amount_sats: z
          .number()
          .describe("Maximum amount to pay in satoshis"),
      },
      outputSchema: {
        replies: z
          .array(
            z.object({
              expert_pubkey: z.string().describe("Expert's public key"),
              content: z.string().optional().describe("Content of the answer"),
              amount_sats: z.number().optional().describe("Amount paid in satoshis"),
              error: z.string().optional().describe("Error message if the expert request failed"),
            })
          )
          .describe("Array of replies from experts"),
      },
      annotations: {
        title: "Ask multiple experts a question and receive their answers",
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: true,
      },
    };

    // Register the ask_experts tool
    this.registerTool(
      "ask_experts",
      askExpertsConfig,
      makeTool(async (params, extra) => {
        const { question, bids, max_amount_sats } = params;
        const replies = await this.askExperts(
          question,
          bids as BidMCP[],
          max_amount_sats
        );
        return { replies };
      })
    );

    // Schema for ask_expert tool
    const askExpertConfig = {
      title: "Ask Expert",
      description:
        "After you receive a bid from experts, you can send a question to a particular expert by their pubkey. Question should be detailed and may include sensitive data as it is encrypted. Provide max amount of payment you are willing to pay, good default is 100 sats.",
      inputSchema: {
        question: z.string().describe("The question to ask the expert"),
        expert_pubkey: z.string().describe("Expert's public key"),
        max_amount_sats: z
          .number()
          .describe("Maximum amount to pay in satoshis"),
      },
      outputSchema: {
        reply: z
          .object({
            expert_pubkey: z.string().describe("Expert's public key"),
            content: z.string().optional().describe("Content of the answer"),
            amount_sats: z.number().optional().describe("Amount paid in satoshis"),
            error: z.string().optional().describe("Error message if the expert request failed"),
          })
          .describe("Reply from the expert"),
      },
      annotations: {
        title:
          "Ask a single expert a question and receive their answer",
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: true,
      },
    };

    // Register the ask_expert tool
    this.registerTool(
      "ask_expert",
      askExpertConfig,
      makeTool(async (params, extra) => {
        const { question, expert_pubkey, max_amount_sats } = params;
        const reply = await this.askExpert(
          question,
          expert_pubkey,
          max_amount_sats
        );
        return { reply };
      })
    );
  }

  /**
   * Handles quote events from experts
   *
   * @param quote - Quote from expert
   * @param prompt - Prompt sent to expert
   * @param max_amount_sats - Maximum amount to pay in satoshis
   * @returns Promise resolving to the invoice amount if it's within max_amount_sats, otherwise 0
   * @private
   */
  private async handleQuote(
    quote: Quote,
    prompt: Prompt,
    max_amount_sats: number
  ): Promise<number> {
    // Check if there's a lightning invoice
    const lightningInvoice = quote.invoices.find(
      (inv) => inv.method === "lightning"
    );

    if (!lightningInvoice || !lightningInvoice.invoice) {
      debugError("No lightning invoice found in quote");
      return 0;
    }

    // Parse the invoice to get the amount
    try {
      const { amount_sats } = parseBolt11(lightningInvoice.invoice);

      // Check if the amount is within the max amount
      if (amount_sats <= max_amount_sats) {
        return amount_sats;
      } else {
        debugMCP(
          `Invoice amount (${amount_sats}) exceeds max amount (${max_amount_sats})`
        );
        return 0;
      }
    } catch (error) {
      debugError("Failed to parse invoice:", error);
      return 0;
    }
  }

  /**
   * Handles payment for quotes
   *
   * @param quote - Quote from expert
   * @param prompt - Prompt sent to expert
   * @returns Promise resolving to Proof object
   * @private
   */
  private async handlePayment(quote: Quote, prompt: Prompt): Promise<Proof> {
    // Find the lightning invoice
    const lightningInvoice = quote.invoices.find(
      (inv) => inv.method === "lightning"
    );

    if (!lightningInvoice || !lightningInvoice.invoice) {
      throw new Error("No lightning invoice found in quote");
    }

    try {
      // Pay the invoice using the payment manager
      const preimage = await this.paymentManager.payInvoice(
        lightningInvoice.invoice
      );

      // Return the proof
      return {
        method: "lightning",
        preimage,
      };
    } catch (error) {
      throw new Error(
        `Payment failed: ${
          error instanceof Error ? error.message : String(error)
        }`
      );
    }
  }

  private gc() {
    const now = Math.floor(Date.now() / 1000);
    for (const [id, bid] of this.bidMap.entries()) {
      if (now - bid.event.created_at > BID_TTL) this.bidMap.delete(id);
    }
  }

  /**
   * Finds experts based on a summary and hashtags
   *
   * @param summary - Summary of the question
   * @param hashtags - Hashtags for discovery
   * @returns Promise resolving to array of BidMCP objects
   */
  async findExperts(summary: string, hashtags: string[]): Promise<BidMCP[]> {
    if (!summary || summary.trim() === "") {
      throw new Error("Summary is required");
    }

    if (!hashtags || hashtags.length === 0) {
      throw new Error("At least one hashtag is required");
    }

    this.gc();

    try {
      // Find experts using the client
      const bids = await this.client.findExperts({
        summary,
        hashtags,
        formats: [FORMAT_TEXT],
        methods: [METHOD_LIGHTNING],
      });

      // Convert bids to BidMCP objects and store in the map
      return bids.map((bid) => {
        const bidMCP: BidMCP = {
          id: bid.id,
          expert_pubkey: bid.pubkey,
          offer: bid.offer,
        };

        // Store the bid in the map for later use
        this.bidMap.set(bidMCP.id, bid);

        return bidMCP;
      });
    } catch (error) {
      throw new Error(
        `Failed to find experts: ${
          error instanceof Error ? error.message : String(error)
        }`
      );
    }
  }

  /**
   * Asks multiple experts a question
   *
   * @param question - Question to ask
   * @param bids - Array of BidMCP objects
   * @param max_amount_sats - Maximum amount to pay in satoshis
   * @returns Promise resolving to array of ReplyMCP objects
   */
  async askExperts(
    question: string,
    bids: BidMCP[],
    max_amount_sats: number
  ): Promise<ReplyMCP[]> {
    if (!question || question.trim() === "") {
      throw new Error("Question is required");
    }

    if (!bids || bids.length === 0) {
      throw new Error("At least one bid is required");
    }

    if (max_amount_sats <= 0) {
      throw new Error("Maximum amount must be greater than zero");
    }

    const results: ReplyMCP[] = [];

    // Process each bid in parallel
    const promiseResults = await Promise.allSettled(
      bids.map(async (bidMCP) => {
        // Get the original bid from the map
        const bid = this.bidMap.get(bidMCP.id);
        if (!bid) {
          throw new Error(`Bid not found for ID: ${bidMCP.id}`);
        }

        // Ask the expert
        return this.askExpertInternal(
          question,
          bid,
          max_amount_sats
        );
      })
    );

    // Process the results, including errors
    promiseResults.forEach((result, index) => {
      if (result.status === 'fulfilled') {
        // Add successful result to the array
        results.push(result.value);
      } else {
        // Create an error reply
        const errorMessage = result.reason instanceof Error
          ? result.reason.message
          : String(result.reason);
        
        debugError(`Failed to ask expert:`, result.reason);
        
        // Add error reply to results
        results.push({
          expert_pubkey: bids[index].expert_pubkey,
          error: `Failed to ask expert: ${errorMessage}`
        });
      }
    });

    return results;
  }

  /**
   * Asks a single expert a question
   *
   * @param question - Question to ask
   * @param expert_pubkey - Expert's public key
   * @param max_amount_sats - Maximum amount to pay in satoshis
   * @returns Promise resolving to ReplyMCP object
   */
  async askExpert(
    question: string,
    expert_pubkey: string,
    max_amount_sats: number
  ): Promise<ReplyMCP> {
    if (!question || question.trim() === "") {
      throw new Error("Question is required");
    }

    if (!expert_pubkey) {
      throw new Error("Expert public key is required");
    }

    if (max_amount_sats <= 0) {
      throw new Error("Maximum amount must be greater than zero");
    }

    // Find the bid for this expert
    const bid = Array.from(this.bidMap.values()).find(
      (b) => b.pubkey === expert_pubkey
    );

    if (!bid) {
      throw new Error(`No bid found for expert: ${expert_pubkey}`);
    }

    return await this.askExpertInternal(question, bid, max_amount_sats);
  }

  /**
   * Internal method to ask an expert a question
   *
   * @param question - Question to ask
   * @param bid - Bid object
   * @param max_amount_sats - Maximum amount to pay in satoshis
   * @returns Promise resolving to ReplyMCP object
   * @private
   */
  private async askExpertInternal(
    question: string,
    bid: Bid,
    max_amount_sats: number
  ): Promise<ReplyMCP> {
    try {
      // Track the invoice amount
      let invoice_amount = 0;

      // Ask the expert using the client
      const replies: Replies = await this.client.askExpert({
        bid,
        content: question,
        format: FORMAT_TEXT,
        compr: bid.compressions[0],
        onQuote: async (quote, prompt) => {
          // Call our handleQuote method with the max amount
          const amount = await this.handleQuote(quote, prompt, max_amount_sats);

          // Store the amount for later use
          invoice_amount = amount;

          // Return true if the amount is greater than 0
          return amount > 0;
        },
        onPay: (quote, prompt) => this.handlePayment(quote, prompt),
      });

      // Process the replies
      let content = "";

      // Iterate through the replies
      for await (const reply of replies) {
        // Append the content
        if (typeof reply.content === "string") {
          content += reply.content;
        } else {
          content += JSON.stringify(reply.content);
        }
      }

      // Return the ReplyMCP object
      return {
        expert_pubkey: bid.pubkey,
        content,
        amount_sats: invoice_amount,
      };
    } catch (error) {
      throw new Error(
        `Failed to ask expert: ${
          error instanceof Error ? error.message : String(error)
        }`
      );
    }
  }

  /**
   * Disposes of resources when the object is no longer needed
   */
  [Symbol.dispose](): void {
    // Dispose of the client
    this.client[Symbol.dispose]();

    // Dispose of the payment manager
    this.paymentManager[Symbol.dispose]();

    // Stop itself
    this.close().catch(() => debugError("Failed to close the MCP server"));
  }
}
