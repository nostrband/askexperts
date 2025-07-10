import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { DEFAULT_RELAYS } from "./nostr/constants.js";
import { AskExpertsTools } from "./AskExpertsTools.js";
import type {
  Bid,
  ExpertSessionWithContext,
  ExpertSessionStructure,
  AskExpertsParams,
  FindExpertsParams,
  FindExpertsResponse,
  AskExpertsResponse
} from "./AskExpertsTools.js";

// Re-export types from AskExpertsTools for backward compatibility
export type {
  Bid,
  ExpertSessionWithContext,
  ExpertSessionStructure,
  AskExpertsParams,
  FindExpertsParams,
  FindExpertsResponse,
  AskExpertsResponse
};

/**
 * AskExpertsMCP class that extends McpServer and encapsulates AskExpertsTools
 */
export class AskExpertsMCP extends McpServer {
  private askExpertsTools: AskExpertsTools;
  private canPay: boolean;

  /**
   * Create a new AskExpertsMCP instance
   * 
   * @param relays - Array of relay URLs to use
   * @param nwcString - Optional NWC connection string for payments
   */
  constructor(relays: string[] = DEFAULT_RELAYS, nwcString?: string) {
    super({
      name: "askexperts",
      version: "0.2.0",
      description:
        "An MCP server that allows to find experts on a subject and ask them questions, pay them for their answers and post reviews.",
    });

    // Modifies the interface
    this.canPay = !!nwcString;

    // Create an instance of AskExpertsTools
    this.askExpertsTools = new AskExpertsTools(relays, nwcString);

    // Register tools
    this.registerTools();
  }

  /**
   * Register all tools with the MCP server
   */
  private registerTools(): void {
    let bidConfig = z.object({
      message_id: z.string().describe("Bid message ID to pass to ask_experts tool"),
      pubkey: z.string().describe("Expert's public key"),
      bid_sats: z.number().describe("Amount of the bid in satoshis"),
      offer: z.string().describe("Expert's offer description"),
    });

    if (!this.canPay) {
      bidConfig = bidConfig.extend({
        invoice: z
          .string()
          .describe("Lightning Network invoice for payment of bid_sats"),
      });
    }

    const findExpertsConfig = {
      title: "Find Experts",
      description:
        "Find experts on a subject by posting an anonymous publicly visible summary of your question. It should omit all private details and personally identifiable information, be short, concise and include relevant tags. Returns a list of bids by experts who are willing to answer your question and their invoices for payments.",
      inputSchema: {
        public_question_summary: z
          .string()
          .describe(
            "A public summary of the question, omitting private details and PII"
          ),
        tags: z
          .array(z.string())
          .optional()
          .describe(
            "List of tags for discovery (required if expert_pubkeys not set)"
          ),
        expert_pubkeys: z
          .array(z.string())
          .optional()
          .describe(
            "List of expert public keys to direct the question to, if those were already discovered"
          ),
        max_bid_sats: z
          .number()
          .optional()
          .describe(
            "Maximum payment amount willing to pay for an answer, in Bitcoin satoshis"
          ),
      },
      outputSchema: {
        bids: z
          .array(bidConfig)
          .describe("List of bids from experts willing to answer the question"),
        id: z.string().describe("ID of the ask event"),
      },
    };

    // Register the find_experts tool
    this.registerTool(
      "find_experts",
      findExpertsConfig,
      async (params, extra) => {
        return await this.askExpertsTools.findExperts(params);
      }
    );

    let expertConfig = z.object({
      message_id: z
        .string()
        .describe(
          "Message ID from the bid or from last expert answer (if it's a followup question)"
        ),
      pubkey: z.string().describe("Expert's public key"),
    });

    if (this.canPay) {
      expertConfig = expertConfig.extend({
        bid_sats: z
          .number()
          .describe("Amount of the bid in satoshis (for user to verify)"),
      });
    } else {
      expertConfig = expertConfig.extend({
        preimage: z
          .string()
          .describe("Payment preimage received after invoice was paid"),
      });
    }

    let resultConfig = z.object({
      message_id: z.string().describe("Message ID that was provided as input"),
      expert_pubkey: z.string().describe("Expert's public key"),
      payment_hash: z
        .string()
        .optional()
        .describe(
          "Payment hash of the bid, useful to find the payment in client's wallet"
        ),
      status: z
        .enum(["sent", "failed", "received", "timeout"])
        .describe("Status of the question/answer process"),
      content: z.string().optional().describe("Content of the answer if received"),
      error: z.string().optional().describe("Error message if failed"),
      followup_sats: z
        .number()
        .optional()
        .describe(
          "If followup is allowed by expert, includes the amount of sats to pay for a followup question"
        ),
      followup_message_id: z
        .string()
        .optional()
        .describe("ID of the message to ask a followup question, to be passed to ask_experts"),
    });

    if (!this.canPay) {
      resultConfig = resultConfig.extend({
        followup_invoice: z
          .string()
          .optional()
          .describe(
            "Lightning invoice for followup question if followup is allowed"
          ),
      });
    }

    const askExpertsConfig = {
      title: "Ask Experts",
      description: this.canPay
        ? "After you receive bids from experts, select good ones and you can send the question to these experts. For each bid, information received from find_experts tool must be included, you can pay invoices yourself and provide preimages, or leave preimages empty and we pay from built-in wallet. Relays and invoices are stored internally and clients don't have to pass them from bids to questions."
        : "After you receive bids from experts, select good ones and pay their invoices, and then you can send the question to these experts. For each bid, information received from find_experts tool and a preimage of the payment must be included. Relays and invoices are stored internally and clients don't have to pass them from bids to questions.",
      inputSchema: {
        ask_id: z.string().describe("Id of the ask, received from find_experts."),
        question: z
          .string()
          .describe(
            "The detailed question to send to experts, might include more sensitive data as the questions are encrypted."
          ),
        experts: z
          .array(expertConfig)
          .describe("Array of experts to send questions to"),
        timeout: z
          .number()
          .optional()
          .describe(
            "Timeout in milliseconds for sending the questions and receiving the answers (default: 60000 ms)"
          ),
      },
      outputSchema: {
        total: z.number().describe("Total number of question results"),
        sent: z.number().describe("Number of questions successfully sent"),
        failed: z.number().describe("Number of questions that failed to send"),
        failed_payments: z
          .number()
          .describe("Number of questions that failed to get paid"),
        received: z.number().describe("Number of answers received"),
        timeout: z.number().describe("Number of answers that timed out"),
        insufficient_balance: z
          .boolean()
          .describe(
            this.canPay ? "True if internal wallet is out of funds" : "Always false"
          ),
        results: z
          .array(resultConfig)
          .describe("Detailed results for each expert question/answer"),
      },
    };

    // Register the ask_experts tool
    this.registerTool(
      "ask_experts",
      askExpertsConfig,
      async (params: AskExpertsParams, extra) => {
        return await this.askExpertsTools.askExperts(params);
      }
    );
  }

  /**
   * Find experts on a subject by posting a public summary of the question
   *
   * @param params - The parameters for finding experts
   * @returns A formatted response with a list of bids from experts
   */
  async findExperts(params: FindExpertsParams): Promise<{
    content: Array<{ type: "text"; text: string }>;
    structuredContent: FindExpertsResponse;
  }> {
    return await this.askExpertsTools.findExperts(params);
  }

  /**
   * Ask experts a question by sending encrypted questions to each expert
   *
   * @param params - The parameters for asking experts
   * @returns A formatted response with the results of sending questions
   */
  async askExperts(params: AskExpertsParams): Promise<{
    content: Array<{ type: "text"; text: string }>;
    structuredContent: AskExpertsResponse;
  }> {
    return await this.askExpertsTools.askExperts(params);
  }
}
