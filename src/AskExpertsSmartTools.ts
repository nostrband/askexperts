import { OpenAI } from "openai";
import {
  AskExpertsTools,
  AskExpertsParams,
  AskExpertsResponse,
} from "./AskExpertsTools.js";
import { MAX_EXPERTS } from "./nostr/constants.js";

/**
 * AskExpertsToolsSmart class that encapsulates AskExpertsTools and OpenAI
 * for enhanced expert discovery and evaluation
 */
export class AskExpertsSmartTools {
  private askExpertsTools: AskExpertsTools;
  private openai: OpenAI;

  /**
   * Create a new AskExpertsToolsLLM instance
   *
   * @param relays - Array of relay URLs to use
   * @param nwcString - Optional NWC connection string for payments
   * @param openaiApiKey - OpenAI API key
   * @param openaiBaseUrl - Optional base URL for OpenAI API
   */
  constructor(
    relays: string[],
    openaiBaseUrl: string,
    openaiApiKey: string,
    nwcString?: string
  ) {
    // Initialize AskExpertsTools
    this.askExpertsTools = new AskExpertsTools(relays, nwcString);

    // Initialize OpenAI
    this.openai = new OpenAI({
      apiKey: openaiApiKey,
      baseURL: openaiBaseUrl,
      defaultHeaders: {
        "HTTP-Referer": "https://askexperts.io", // Site URL for rankings on openrouter.ai
        "X-Title": "AskExperts", // Site title for rankings on openrouter.ai
      },
    });
  }

  /**
   * Ask experts a question
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
    // Parse question, prepare for findExperts call
    let publicQuestionSummary: string | undefined;
    let hashtags: string[] = [];
    let max_bid_sats: number | undefined;

    try {
      // Use OpenAI to generate an answer
      const completion = await this.openai.chat.completions.create({
        model: "openai/gpt-4o-mini",
        messages: [
          {
            role: "developer",
            content: `Your job is to look at the user's detailed question that might include sensitive or private information, 
and come up with a short anonymized summarized question that can be shared publicly to find experts on the subject, without revealing
any private data. You must also determine up to 10 hashtags this summarized question might have to simplify discovery for experts - hashtags
must be one word each, english, lowercase, and be as specific as possible. Reply in a structured way in two lines:
\`\`\`
hashtags: hashtag1, hashtag2, etc
question: <summarized question>
\`\`\`

If you believe the question is malformed or makes no sense, reply with one word "error".
`,
          },
          {
            role: "user",
            content: question,
          },
        ],
      });

      // Extract the response content
      const responseContent = completion.choices[0]?.message?.content;
      console.log("prepare ask responseContent", responseContent);
      if (!responseContent || responseContent === "error")
        throw new Error("Failed to parse the question");

      const lines = responseContent
        .split("\n")
        .map((s) => s.trim())
        .filter((s) => !!s);
      if (
        lines.length !== 2 ||
        !lines[0].startsWith("hashtags: ") ||
        !lines[1].startsWith("question: ")
      )
        throw new Error("Bad question parsing reply");

      hashtags = lines[0].substring("hashtags: ".length)
        .split(",")
        .map((t) => t.trim())
        .filter((t) => !!t);
      publicQuestionSummary = lines[1].substring("question: ".length).trim();
    } catch (error) {
      console.error("Error processing ask with OpenAI:", error);
      throw error;
    }

    if (!hashtags.length || !publicQuestionSummary)
      throw new Error("Parsed question or hashtags empty");

    if (max_payment_sats)
      max_bid_sats = Math.floor(max_payment_sats / MAX_EXPERTS);

    console.log("Parsed question", question, {
      publicQuestionSummary,
      hashtags,
      max_bid_sats,
    });

    const bids = await this.askExpertsTools.findExperts({
      public_question_summary: publicQuestionSummary,
      tags: hashtags,
      expert_pubkeys,
      max_bid_sats,
    });

    console.log("Received bids", bids);
    if (!bids.structuredContent.bids.length)
      throw new Error("No bids from experts");

    // FIXME evaluate offers and bid sizes and select up to MAX_EXPERTS

    const goodBids = [...bids.structuredContent.bids];
    if (goodBids.length > MAX_EXPERTS) goodBids.length = MAX_EXPERTS;

    const answers = await this.askExpertsTools.askExperts({
      ask_id: bids.structuredContent.id,
      experts: goodBids,
      question,
    });

    // FIXME evaluate the answers, update expert scores

    return answers;
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

    const answers = await this.askExpertsTools.askExperts(params);

    // FIXME evaluate the answers, update expert scores

    return answers;

  }
}
