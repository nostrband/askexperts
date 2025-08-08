import { AskExpertsPayingClient } from "./AskExpertsPayingClient.js";
import { LightningPaymentManager } from "../payments/LightningPaymentManager.js";
import { debugMCP, debugError } from "../common/debug.js";
import {
  DEFAULT_DISCOVERY_RELAYS,
  FORMAT_TEXT,
  METHOD_LIGHTNING,
} from "../common/constants.js";
import { Bid, Replies, Quote, Prompt } from "../common/types.js";
import { OpenaiInterface, createOpenAI } from "../openai/index.js";

/**
 * Interface for ReplyMCP objects returned by askExperts
 */
export interface ReplyMCP {
  expert_pubkey: string;
  expert_offer: string;
  content?: string;
  amount_sats?: number;
  error?: string;
}

/**
 * AskExpertsSmartClient class that provides a simplified interface
 * for clients to interact with the AskExpertsClient with LLM capabilities
 */
export class AskExpertsSmartClient {
  private client: AskExpertsPayingClient;
  private openai: OpenaiInterface;

  /**
   * Creates a new AskExpertsSmartClient instance
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
    if (!nwcString) {
      throw new Error("NWC connection string is required");
    }

    if (!openaiBaseUrl) {
      throw new Error("OpenAI base URL is required");
    }

    // Create the payment manager
    const paymentManager = new LightningPaymentManager(nwcString);

    // Initialize the paying client
    this.client = new AskExpertsPayingClient(paymentManager, {
      discoveryRelays: discoveryRelays || DEFAULT_DISCOVERY_RELAYS,
    });

    // Initialize OpenAI
    this.openai = createOpenAI({
      apiKey: openaiApiKey,
      baseURL: openaiBaseUrl,
      paymentManager
    });
  }

  private async parseQuestion(question: string, requirements?: string) {
    try {
      let content = `Question: ${question}\n`;
      if (requirements) {
        content += `\nExpert requirements: ${requirements}`;
      }
      // console.error("question parsing content", content);

      // Use OpenAI to generate an answer
      const model = "openai/gpt-4o-mini";
      const quoteResult = await this.openai.getQuote(model, {
        model,
        messages: [
          {
            role: "system",
            content: `Your job is to look at the user's detailed question or prompt that might include sensitive or private information,
and come up with a short anonymized summarized version that can be shared publicly to find experts on the subject, without revealing
any private data.

You must also determine at least 10 hashtags that this summarized question/prompt might have to simplify discovery for experts. After you
select the initial list of hashtags, for each initial hashtag come up with 4 additional variations of it and add those variations to the list as well,
to make the total of at least 50 hashtags. Hashtags must be without # symbol, with - instead of spaces, english, lowercase.

If the question is super simple and looks like a test, come up with appropriate hashtags but don't summarize the question - just return the input question as summarized one, don't invent your own question/summary.

If additional "expert requirements" are provided by the user, use them to figure out which hashtags the required experts might be monitoring and print those as the last line in your output.

Reply in a structured way in three lines:

hashtags: hashtag1, hashtag2, etc
question: <summarized question>
expert_hashtags: expert_hashtag1, expert_hashtag2, etc
`,
          },
          {
            role: "user",
            content,
          },
        ],
      });
      
      // Make sure quoteId is defined
      if (!quoteResult.quoteId) {
        throw new Error("No quoteId returned from getQuote");
      }
      
      const completion = await this.openai.execute(quoteResult.quoteId);

      // Extract the response content
      // Handle the completion result which could be a ChatCompletion or AsyncIterable<ChatCompletionChunk>
      let responseContent: string | null = null;
      
      if ('choices' in completion) {
        // It's a ChatCompletion
        responseContent = completion.choices[0]?.message?.content || null;
      } else {
        // It's an AsyncIterable<ChatCompletionChunk>, but we don't expect this case
        throw new Error("Unexpected streaming response");
      }
      debugMCP("Prepared ask", { responseContent, question, requirements });
      if (!responseContent || responseContent === "error")
        throw new Error("Failed to parse the question");
      const lines = responseContent
        .split("\n")
        .map((s) => s.trim())
        .filter((s) => !!s);
      if (
        lines.length !== 3 ||
        !lines[0].startsWith("hashtags: ") ||
        !lines[1].startsWith("question: ") ||
        !lines[2].startsWith("expert_hashtags: ")
      )
        throw new Error("Bad question parsing reply");

      const hashtags = lines[0]
        .substring("hashtags: ".length)
        .split(",")
        .map((t) => t.trim())
        .filter((t) => !!t);

      hashtags.push(
        ...lines[2]
          .substring("expert_hashtags: ".length)
          .split(",")
          .map((t) => t.trim())
          .filter((t) => !!t)
      );

      const publicQuestionSummary = lines[1]
        .substring("question: ".length)
        .trim();
      if (!hashtags.length || !publicQuestionSummary)
        throw new Error("Parsed question or hashtags empty");

      return { hashtags, publicQuestionSummary };
    } catch (error) {
      debugError("Error processing ask with OpenAI:", error);
      throw error;
    }
  }

  private async selectBids(
    bids: Bid[],
    question: string,
    requirements?: string
  ) {
    debugMCP(
      `Got bids ${bids.length} from experts ${bids.map((b) => b.pubkey)}`
    );
    if (!bids.length) return bids;

    try {
      let content = `Question: ${question}\n\nExpert requirements: ${
        requirements || "<no additional requirements>"
      }\n\nBids:`;
      for (const bid of bids) {
        content += `\nid: ${bid.id} offer: ${bid.offer.replace(/\s+/g, " ")}`;
      }
      // console.error("select bids content", content);

      // Use OpenAI to generate an answer
      const model = "openai/gpt-4o-mini";
      const quoteResult = await this.openai.getQuote(model, {
        model,
        messages: [
          {
            role: "system",
            content: `Your job is to look at the question of the user, at the requirements to experts that user provided, and then at the list of
"bids" that were received from experts (one per line).

Choose bids that are more likely to answer the question.

If pricing is indicated in the offer, take it into account in your evaluation.

If expert requirements are provided - skip bids that don't match.

Then print up to 5 top bid ids, one per line.

If expert requirements are asking to use several kinds of experts - make sure to include at least 1 bid of each kind in the printed list.

Return nothing else, only bid ids.
`,
          },
          {
            role: "user",
            content,
          },
        ],
      });
      
      // Make sure quoteId is defined
      if (!quoteResult.quoteId) {
        throw new Error("No quoteId returned from getQuote");
      }
      
      const completion = await this.openai.execute(quoteResult.quoteId);

      // Extract the response content
      // Handle the completion result which could be a ChatCompletion or AsyncIterable<ChatCompletionChunk>
      let responseContent: string | null = null;
      
      if ('choices' in completion) {
        // It's a ChatCompletion
        responseContent = completion.choices[0]?.message?.content || null;
      } else {
        // It's an AsyncIterable<ChatCompletionChunk>, but we don't expect this case
        throw new Error("Unexpected streaming response");
      }
      // debugMCP("select bids ", { responseContent, question, requirements, bids });
      if (responseContent === null) throw new Error("Failed to parse the bids");
      const lines = responseContent
        .split("\n")
        .map((s) => s.trim())
        .filter((s) => !!s);

      const results: Bid[] = [];
      for (const line of lines) {
        const bid = bids.find((b) => b.id === line.trim());
        if (bid) results.push(bid);
      }
      if (!results.length) results.push(bids[0]);

      debugMCP(
        `Selected bids ${results.length}:\n${JSON.stringify(
          results.map((b) => ({ pubkey: b.pubkey, offer: b.offer })),
          null,
          2
        )}`
      );

      return results;
    } catch (error) {
      debugError("Error processing bids with OpenAI:", error);
      throw error;
    }
  }

  /**
   * Asks experts a question with LLM-powered summarization and expert selection
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
    if (!question || question.trim() === "") {
      throw new Error("Question is required");
    }

    if (max_amount_sats <= 0) {
      throw new Error("Maximum amount must be greater than zero");
    }

    // Prepare to find experts
    const { hashtags, publicQuestionSummary } = await this.parseQuestion(
      question,
      requirements
    );

    // Find experts using the paying client
    const bids = await this.client.findExperts({
      summary: publicQuestionSummary,
      hashtags,
      formats: [FORMAT_TEXT],
      methods: [METHOD_LIGHTNING],
    });

    if (!bids || bids.length === 0) {
      throw new Error("No experts found for the question");
    }

    // Evaluate bids and select good ones
    const selectedBids = await this.selectBids(bids, question, requirements);

    const results: ReplyMCP[] = [];

    // Process each bid in parallel
    const promiseResults = await Promise.allSettled(
      selectedBids.map(async (bid) => {
        // Ask the expert
        return this.askExpertInternal(question, bid, max_amount_sats);
      })
    );

    // Process the results, including errors
    promiseResults.forEach((result, index) => {
      if (result.status === "fulfilled") {
        // Add successful result to the array
        results.push(result.value);
      } else {
        // Create an error reply
        const errorMessage =
          result.reason instanceof Error
            ? result.reason.message
            : String(result.reason);

        const bid = selectedBids[index];
        debugError(`Failed to ask expert ${bid.pubkey}:`, result.reason);

        // Add error reply to results
        results.push({
          expert_pubkey: bid.pubkey,
          expert_offer: bid.offer,
          error: `Failed to ask expert: ${errorMessage}`,
        });
      }
    });

    return results;
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

      // Set the max amount for this specific request
      this.client.setMaxAmountSats(max_amount_sats);

      // Ask the expert using the client
      const replies: Replies = await this.client.askExpert({
        bid,
        content: question,
        format: FORMAT_TEXT,
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
        expert_offer: bid.offer,
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
    // Dispose of the paying client
    this.client[Symbol.dispose]();
  }
}
