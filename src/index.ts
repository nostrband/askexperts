import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { AskExpertsMCP } from "./AskExpertsMCP.js";
import { DEFAULT_RELAYS } from "./nostr/constants.js";

// Create an MCP server
const server = new McpServer({
  name: "askexperts",
  version: "0.1.0",
  description:
    "An MCP server that allows to find experts on a subject and ask them questions, pay them for their answers and post reviews.",
});

// Create an instance of AskExpertsMCP
const askExpertsMCP = new AskExpertsMCP(
  DEFAULT_RELAYS, // Use default relays
  process.env.NWC_CONNECTION_STRING // Use NWC connection string from env if available
);

// Check if we can pay invoices automatically
const canPay = !!process.env.NWC_CONNECTION_STRING;

let bidConfig = z.object({
  id: z.string().describe("Bid payload event ID"),
  pubkey: z.string().describe("Expert's public key"),
  bid_sats: z.number().describe("Amount of the bid in satoshis"),
  offer: z.string().describe("Expert's offer description"),
});

if (!canPay) {
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
server.registerTool(
  "find_experts",
  findExpertsConfig,
  async (params, extra) => {
    return await askExpertsMCP.findExperts(params);
  }
);

const expertConfig = z
  .object({
    context_id: z
      .string()
      .describe(
        "Bid payload event ID for the first question, or last answer event ID for a followup"
      ),
    pubkey: z.string().describe("Expert's public key"),
    preimage: canPay
      ? z.string().optional().describe("Payment preimage for verification")
      : z.string().describe("Payment preimage for verification"),
    bid_sats: z
      .number()
      .optional()
      .describe(
        "Amount of the bid in satoshis (required if invoice is provided in context)"
      ),
  })
  .refine(
    (data) => canPay || data.preimage !== undefined,
    {
      message: canPay
        ? "Preimage is optional when using built-in wallet"
        : "Preimage must be provided",
    }
  );

const askExpertsConfig = {
  title: "Ask Experts",
  description: canPay
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
        "Timeout in milliseconds for sending the questions and receiving the answers (default: 5000ms)"
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
        canPay ? "True if internal wallet is out of funds" : "Always false"
      ),
    results: z
      .array(
        z.object({
          context_id: z
            .string()
            .describe("Context ID that was provided as input"),
          expert_pubkey: z.string().describe("Expert's public key"),
          question_id: z.string().describe("ID of the question event"),
          answer_id: z
            .string()
            .optional()
            .describe("ID of the answer event if received"),
          payment_hash: z
            .string()
            .optional()
            .describe(
              "Payment hash of the bid, useful to find the payment in client's wallet"
            ),
          status: z
            .enum(["sent", "failed", "received", "timeout"])
            .describe("Status of the question/answer process"),
          content: z
            .string()
            .optional()
            .describe("Content of the answer if received"),
          followup_invoice: z
            .string()
            .optional()
            .describe("Lightning invoice for followup question if available"),
          error: z.string().optional().describe("Error message if failed"),
        })
      )
      .describe("Detailed results for each expert question/answer"),
  },
};

// Register the ask_experts tool
server.registerTool(
  "ask_experts",
  askExpertsConfig,
  async (params: any, extra) => {
    return await askExpertsMCP.askExperts(params);
  }
);

// Start receiving messages on stdin and sending messages on stdout
const transport = new StdioServerTransport();
server
  .connect(transport)
  .then(() => {
    //console.log('AskExperts MCP server is running');
  })
  .catch((error: unknown) => {
    console.error("Failed to start AskExperts MCP server:", error);
  });
