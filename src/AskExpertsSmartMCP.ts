import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { DEFAULT_RELAYS } from "./nostr/constants.js";
import { AskExpertsSmartTools } from "./AskExpertsSmartTools.js";
import type {
  AskExpertsParams,
  AskExpertsResponse,
  ExpertSessionStructure
} from "./AskExpertsTools.js";

/**
 * AskExpertsSmartMCP class that extends McpServer and encapsulates AskExpertsToolsSmart
 */
export class AskExpertsSmartMCP extends McpServer {
  private askExpertsToolsSmart: AskExpertsSmartTools;
  private canPay: boolean;

  /**
   * Create a new AskExpertsSmartMCP instance
   * 
   * @param relays - Array of relay URLs to use
   * @param openaiBaseUrl - Base URL for OpenAI API
   * @param openaiApiKey - OpenAI API key
   * @param nwcString - NWC connection string for payments (required)
   */
  constructor(
    relays: string[] = DEFAULT_RELAYS,
    openaiBaseUrl: string,
    openaiApiKey: string,
    nwcString: string
  ) {
    super({
      name: "askexperts",
      version: "0.1.0",
      description:
        "An MCP server that allows to find experts on a subject, ask them questions and pay for the answers.",
    });

    // Modifies the interface
    this.canPay = true; // Always true since nwcString is required

    // Create an instance of AskExpertsToolsSmart
    this.askExpertsToolsSmart = new AskExpertsSmartTools(
      relays,
      openaiBaseUrl,
      openaiApiKey,
      nwcString
    );

    // Register tools
    this.registerTools();
  }

  /**
   * Register all tools with the MCP server
   */
  private registerTools(): void {
    // Register the askExperts tool
    this.registerTool(
      "ask_experts",
      {
        title: "Ask Experts",
        description: "Ask a question to experts. Experts are automatically discovered and evaluated. Good experts are paid and provide their answers. Answers are evaluated and expert score lists are maintained.",
        inputSchema: {
          question: z
            .string()
            .describe(
              "The detailed question to send to experts. Can include sensitive data as it will be encrypted."
            ),
          max_payment_sats: z
            .number()
            .describe(
              "Maximum total payment amount in satoshis to be distributed among experts."
            ),
          expert_pubkeys: z
            .array(z.string())
            .optional()
            .describe(
              "Optional list of expert public keys to direct the question to, if those were already discovered."
            ),
        },
        outputSchema: {
          ask_id: z.string().describe("Id of the ask, copied from input parameters"),
          total: z.number().describe("Total number of question results"),
          sent: z.number().describe("Number of questions successfully sent"),
          failed: z.number().describe("Number of questions that failed to send"),
          failed_payments: z.number().describe("Number of questions that failed to get paid"),
          received: z.number().describe("Number of answers received"),
          timeout: z.number().describe("Number of answers that timed out"),
          insufficient_balance: z.boolean().describe("True if internal wallet is out of funds"),
          results: z.array(z.object({
            message_id: z.string().describe("Message ID that was provided as input"),
            expert_pubkey: z.string().describe("Expert's public key"),
            payment_hash: z.string().optional().describe("Payment hash of the bid, useful to find the payment in client's wallet"),
            status: z.enum(["sent", "failed", "received", "timeout"]).describe("Status of the question/answer process"),
            content: z.string().optional().describe("Content of the answer if received"),
            error: z.string().optional().describe("Error message if failed"),
            followup_sats: z.number().optional().describe("If followup is allowed by expert, includes the amount of sats to pay for a followup question"),
            followup_message_id: z.string().optional().describe("ID of the message to ask a followup question, to be passed to followupExperts"),
          })).describe("Detailed results for each expert question/answer"),
        },
      },
      async (params: { question: string; max_payment_sats: number; expert_pubkeys?: string[] }, extra) => {
        return await this.askExpertsToolsSmart.askExperts(
          params.question,
          params.max_payment_sats,
          params.expert_pubkeys
        );
      }
    );

    // Register the followupExperts tool
    this.registerTool(
      "followup_experts",
      {
        title: "Follow Up with Experts",
        description: "Send a followup question to experts who have previously answered your question and offered a followup option.",
        inputSchema: {
          ask_id: z.string().describe("Id of the ask, received from askExperts."),
          question: z
            .string()
            .describe(
              "The detailed followup question to send to experts. Can include sensitive data as it will be encrypted."
            ),
          experts: z
            .array(z.object({
              message_id: z
                .string()
                .describe(
                  "Message ID from the expert's answer that offered a followup option"
                ),
              pubkey: z.string().describe("Expert's public key"),
              bid_sats: z
                .number()
                .describe("Amount of the followup bid in satoshis (for verification)"),
            }))
            .describe("Array of experts to send followup questions to"),
          timeout: z
            .number()
            .optional()
            .describe(
              "Timeout in milliseconds for sending the questions and receiving the answers (default: 60000 ms)"
            ),
        },
        outputSchema: {
          ask_id: z.string().describe("Id of the ask, copied from input parameters"),
          total: z.number().describe("Total number of question results"),
          sent: z.number().describe("Number of questions successfully sent"),
          failed: z.number().describe("Number of questions that failed to send"),
          failed_payments: z.number().describe("Number of questions that failed to get paid"),
          received: z.number().describe("Number of answers received"),
          timeout: z.number().describe("Number of answers that timed out"),
          insufficient_balance: z.boolean().describe("True if internal wallet is out of funds"),
          results: z.array(z.object({
            message_id: z.string().describe("Message ID that was provided as input"),
            expert_pubkey: z.string().describe("Expert's public key"),
            payment_hash: z.string().optional().describe("Payment hash of the bid, useful to find the payment in client's wallet"),
            status: z.enum(["sent", "failed", "received", "timeout"]).describe("Status of the question/answer process"),
            content: z.string().optional().describe("Content of the answer if received"),
            error: z.string().optional().describe("Error message if failed"),
            followup_sats: z.number().optional().describe("If another followup is allowed by expert, includes the amount of sats to pay"),
            followup_message_id: z.string().optional().describe("ID of the message to ask another followup question"),
          })).describe("Detailed results for each expert question/answer"),
        },
      },
      async (params: AskExpertsParams, extra) => {
        return await this.askExpertsToolsSmart.followupExperts(params);
      }
    );
  }

  /**
   * Ask experts a question with AI enhancement
   *
   * @param question - The question to ask
   * @param max_payment_sats - Maximum payment amount in satoshis
   * @param expert_pubkeys - Optional list of expert public keys
   * @returns AskExpertsResponse with results
   */
  async askExperts(
    question: string,
    max_payment_sats: number,
    expert_pubkeys?: string[]
  ): Promise<{
    content: Array<{ type: "text"; text: string }>;
    structuredContent: AskExpertsResponse;
  }> {
    return await this.askExpertsToolsSmart.askExperts(
      question,
      max_payment_sats,
      expert_pubkeys
    );
  }

  /**
   * Send a followup question to experts
   *
   * @param params - The parameters for asking experts
   * @returns AskExpertsResponse with results
   */
  async followupExperts(params: AskExpertsParams): Promise<{
    content: Array<{ type: "text"; text: string }>;
    structuredContent: AskExpertsResponse;
  }> {
    return await this.askExpertsToolsSmart.followupExperts(params);
  }
}