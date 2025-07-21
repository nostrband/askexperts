import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { makeTool } from "./utils.js";
import { AskExpertsSmartClient, ReplyMCP } from "../client/AskExpertsSmartClient.js";

/**
 * AskExpertsSmartMCP class that extends McpServer and provides a simplified interface
 * for clients to interact with the AskExpertsClient with LLM capabilities
 */
export class AskExpertsSmartMCP extends McpServer {
  private client: AskExpertsSmartClient;

  /**
   * Creates a new AskExpertsSmartMCP instance
   *
   * @param nwcString - NWC connection string for payments
   * @param openaiApiKey - OpenAI API key
   * @param openaiBaseUrl - OpenAI base URL
   * @param discoveryRelays - Optional list of discovery relays
   */
  constructor(
    nwcString: string,
    openaiApiKey: string,
    openaiBaseUrl: string,
    discoveryRelays?: string[]
  ) {
    // Read version from package.json
    const __filename = fileURLToPath(import.meta.url);
    const __dirname = path.dirname(__filename);
    const packageJsonPath = path.resolve(__dirname, "../../../package.json"); // from dist/src/mcp
    const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, "utf8"));

    super({
      name: "askexpertssmartmcp",
      version: packageJson.version,
      description:
        "An MCP server that allows asking questions to experts with LLM-powered summarization and expert selection.",
    });

    // Create the client
    this.client = new AskExpertsSmartClient(
      nwcString,
      openaiApiKey,
      openaiBaseUrl,
      discoveryRelays
    );

    // Register tools
    this.registerTools();
  }

  /**
   * Register all tools with the MCP server
   */
  private registerTools(): void {
    // Schema for askExperts tool
    const askExpertsConfig = {
      title: "Ask Experts",
      description:
        "Ask a question to experts. The question should be detailed and may include sensitive data as it is encrypted. Provide max amount of payment you are willing to pay to each expert, good default is 100 sats.",
      inputSchema: {
        question: z.string().describe("The question to ask the experts"),
        max_amount_sats: z
          .number()
          .describe("Maximum amount user is ready to pay to each expert in satoshis"),
        requirements: z
          .string()
          .optional()
          .describe(
            "Additional requirements for the experts that should be selected, can include sensitive data as it's not published or sent to the experts"
          ),
      },
      outputSchema: {
        replies: z
          .array(
            z.object({
              expert_pubkey: z.string().describe("Expert's public key"),
              expert_offer: z.string().describe("Expert's offer from the bid"),
              content: z.string().optional().describe("Content of the expert's answer"),
              amount_sats: z
                .number()
                .optional()
                .describe("Amount user paid to the expert in satoshis"),
              error: z
                .string()
                .optional()
                .describe("Error message if the expert request failed"),
            })
          )
          .describe("Array of replies from experts"),
      },
      annotations: {
        title: "Ask experts a question and receive their answers",
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: true,
      },
    };

    // Register the askExperts tool
    this.registerTool(
      "ask_experts",
      askExpertsConfig,
      makeTool(async (params, extra) => {
        const { question, max_amount_sats, requirements } = params;
        const replies = await this.askExperts(
          question,
          max_amount_sats,
          requirements
        );
        return { replies };
      })
    );
  }


  /**
   * Delegates to the client to ask experts a question
   *
   * @param question - Question to ask
   * @param max_amount_sats - Maximum amount to pay in satoshis
   * @param requirements - Optional requirements to experts that should be selected
   * @returns Promise resolving to array of ReplyMCP objects
   */
  async askExperts(
    question: string,
    max_amount_sats: number,
    requirements?: string
  ): Promise<ReplyMCP[]> {
    return this.client.askExperts(question, max_amount_sats, requirements);
  }

  /**
   * Disposes of resources when the object is no longer needed
   */
  [Symbol.dispose](): void {
    // Dispose of the client
    this.client[Symbol.dispose]();

    // Stop itself
    this.close().catch(() => console.error("Failed to close the MCP server"));
  }
}
