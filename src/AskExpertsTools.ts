import {
  createAndPublishAskEvent,
  fetchBidsFromExperts,
  sendQuestionsToExperts,
  fetchAnswersFromExperts,
  QuestionSentResult,
  AnswerResult,
  FetchAnswersParams,
} from "./nostr/index.js";
import { payExperts } from "./utils/nwc.js";
import * as bolt11 from "bolt11";

// Define the Bid interface
export interface Bid {
  id: string; // bid payload event id
  pubkey: string;
  bid_sats: number;
  offer: string;
}

// Define the input parameters interface for findExperts
export interface FindExpertsParams {
  public_question_summary: string;
  tags?: string[];
  expert_pubkeys?: string[];
  max_bid_sats?: number;
}

/**
 * Interface for an expert session structure
 */
export interface ExpertSessionStructure {
  message_id: string;
  pubkey: string;
  preimage?: string;
  bid_sats?: number;
}

/**
 * Interface for the ask_experts parameters
 */
export interface AskExpertsParams {
  ask_id: string;
  question: string;
  experts: ExpertSessionStructure[];
  timeout?: number;
}

export interface ExpertContext {
  bid_id: string;
  relays: string[];
  invoice: string;
  bid_sats: number;
  payment_hash: string;
}

export interface ExpertSessionWithContext extends ExpertSessionStructure {
  context: ExpertContext;
}

export interface AskStructure {
  sessionkey: Uint8Array;
  timestamp: number;
  contexts: Map<string, ExpertContext>;
}

/**
 * AskExpertsTools class for handling expert discovery and communication
 */
export class AskExpertsTools {
  private asks: Map<string, AskStructure>;
  private relays: string[];
  private nwcString?: string;

  /**
   * Create a new AskExpertsTools instance
   *
   * @param relays - Array of relay URLs to use (defaults to DEFAULT_RELAYS)
   * @param nwcString - Optional NWC connection string for payments
   */
  constructor(relays: string[], nwcString?: string) {
    this.asks = new Map<string, AskStructure>();
    this.relays = relays;
    this.nwcString = nwcString;
  }

  /**
   * Add an ask to the internal map
   *
   * @param id - The ID of the ask
   * @param ask - The ask structure to store
   */
  private addAsk(id: string, ask: AskStructure): void {
    this.asks.set(id, ask);
  }

  /**
   * Get an ask from the internal map
   *
   * @param id - The ID of the ask to retrieve
   * @returns The ask structure or undefined if not found
   */
  private getAsk(id: string): AskStructure | undefined {
    return this.asks.get(id);
  }

  /**
   * Find experts on a subject by posting a public summary of the question
   *
   * @param params - The parameters for finding experts
   * @returns A formatted response with a list of bids from experts
   */
  async findExperts(params: FindExpertsParams): Promise<{
    content: Array<{ type: "text"; text: string }>;
    structuredContent: any;
  }> {
    // Validate that at least one of tags or expert_pubkeys is provided
    if (!params.tags && !params.expert_pubkeys) {
      throw new Error("Either tags or expert_pubkeys must be provided");
    }

    // Create and publish the Ask event using the nostr module
    const {
      event: askEvent,
      publishedRelays,
      sessionkey,
    } = await createAndPublishAskEvent(
      {
        content: params.public_question_summary,
        tags: params.tags || [],
        expert_pubkeys: params.expert_pubkeys,
        max_bid_sats: params.max_bid_sats,
      },
      this.relays
    );

    // Wait for bids from experts
    const allBids = await fetchBidsFromExperts(
      askEvent.id,
      sessionkey,
      publishedRelays,
      5000 // Wait for 5 seconds to collect bids
    );

    // Filter by max bid
    const bids = allBids.filter(
      (b) => !params.max_bid_sats || b.bid_sats <= params.max_bid_sats
    );

    // Create the response object with bids and event ID
    const response = {
      bids: bids.map((b) => {
        const responseBid: any = {
          message_id: b.id,
          pubkey: b.pubkey,
          bid_sats: b.bid_sats,
          offer: b.offer,
        };
        if (!this.nwcString) responseBid.invoice = b.invoice;
        return responseBid;
      }),
      id: askEvent.id,
    };

    // Register the ask's session key and contexts
    if (bids.length > 0) {
      const contexts = new Map<string, ExpertContext>();

      // Store relays, invoices, payment_hash, and bid_sats for each bid in the contexts map
      bids.forEach((bid) => {
        contexts.set(bid.id, {
          bid_id: bid.id,
          relays: bid.relays,
          invoice: bid.invoice,
          payment_hash: bid.payment_hash,
          bid_sats: bid.bid_sats,
        });
      });

      this.addAsk(askEvent.id, {
        sessionkey,
        timestamp: Date.now(),
        contexts,
      });
    }

    // Format the response as JSON string
    const responseJson = JSON.stringify(response, null, 2);

    // Return in the format expected by MCP
    return {
      content: [
        {
          type: "text" as const,
          text: responseJson,
        },
      ],
      structuredContent: response,
    };
  }

  /**
   * Ask experts a question by sending encrypted questions to each expert
   *
   * @param params - The parameters for asking experts
   * @returns A formatted response with the results of sending questions
   */
  async askExperts(params: AskExpertsParams): Promise<{
    content: Array<{ type: "text"; text: string }>;
    structuredContent: any;
  }> {
    const ask = this.getAsk(params.ask_id);
    if (!ask) {
      throw new Error("Ask not found or expired");
    }

    // Validate the parameters
    if (!params.question || params.question.trim() === "") {
      throw new Error("Question is required");
    }

    if (
      !params.experts ||
      !Array.isArray(params.experts) ||
      params.experts.length === 0
    ) {
      throw new Error("At least one expert is required");
    }

    // Get context for each expert
    const experts: ExpertSessionWithContext[] = params.experts.map((expert) => {
      // Get context for this expert
      const context = ask.contexts.get(expert.message_id);

      if (!context) {
        throw new Error(
          `Context not found for expert with message_id ${expert.message_id}`
        );
      }

      return {
        ...expert,
        context,
      };
    });

    // Validate each expert
    for (const expert of experts) {
      if (!expert.message_id) throw new Error("Expert message_id is required");
      if (!expert.pubkey) throw new Error("Expert pubkey is required");

      // Bid_sats must be provided
      if (expert.bid_sats === undefined) {
        throw new Error("bid_sats must be provided");
      }

      // If preimage isn't set and we're expected to pay, validate the amount
      if (!expert.preimage) {
        if (expert.bid_sats !== expert.context.bid_sats)
          throw new Error(
            `Invoice amount (${expert.context.bid_sats} sats) doesn't match bid_sats (${expert.bid_sats} sats) for bid ${expert.message_id}`
          );
      }
    }

    // Check for experts without preimages that need payment
    const expertsWithoutPreimage = experts.filter((expert) => {
      if (expert.preimage) return false;
      return !!expert.context.invoice;
    });

    // Track failed payments
    const failedExpertContextIds: string[] = [];
    let insufficientBalance = false;

    // If there are bids without preimages, try to pay them
    if (expertsWithoutPreimage.length > 0) {
      if (!this.nwcString) {
        throw new Error(
          "NWC connection string is required to pay for bids without preimages"
        );
      }

      // Pay to experts and get preimages
      const paymentResults = await payExperts(
        expertsWithoutPreimage,
        this.nwcString
      );

      // Update bids with preimages from successful payments
      for (const result of paymentResults) {
        if (result.success) {
          // Find the corresponding expert and update it with the preimage
          const e = experts.find(
            (b) => b.message_id === result.expert.message_id
          );
          if (e) {
            e.preimage = result.preimage;
          }
        } else {
          console.error(
            `Failed to pay for bid ${result.expert.message_id}: ${result.error}`
          );
          if (result.error === "INSUFFICIENT_BALANCE")
            insufficientBalance = true;
          failedExpertContextIds.push(result.expert.message_id);
        }
      }
    }

    // Keep only experts with valid preimages (successful payments)
    const validExperts = experts.filter((bid) => bid.preimage);

    // Create empty results array for the case when no valid bids
    let questionResults: QuestionSentResult[] = [];

    // Only send questions if we have valid bids
    if (validExperts.length > 0) {
      // Send questions to experts (only those with valid preimages)
      questionResults = await sendQuestionsToExperts({
        sessionkey: ask.sessionkey,
        question: params.question,
        experts: validExperts,
      });
    }

    // Filter out failed questions
    const sentQuestions = questionResults.filter((q) => q.status === "sent");

    // Prepare for fetching answers
    const fetchParams: FetchAnswersParams = {
      sessionkey: ask.sessionkey,
      questions: sentQuestions.map((q) => ({
        message_id: q.message_id,
        expert_pubkey: q.expert_pubkey,
        relays: q.relays,
      })),
      timeout: params.timeout || 60000,
    };

    // Fetch answers from experts
    const answerResults: AnswerResult[] = await fetchAnswersFromExperts(
      fetchParams
    );

    // Combine question and answer results
    const combinedResults = questionResults.map((qResult) => {
      // If the question failed, just return the question result
      if (qResult.status === "failed") {
        return {
          message_id: qResult.message_id,
          expert_pubkey: qResult.expert_pubkey,
          status: "failed",
          error: qResult.error,
        };
      }

      // Find the corresponding answer result
      const answerResult = answerResults.find(
        (a) => a.message_id === qResult.message_id
      );

      if (!answerResult) {
        return {
          message_id: qResult.message_id,
          expert_pubkey: qResult.expert_pubkey,
          status: "timeout",
        };
      }

      // Find the corresponding expert to get the preimage
      const expert = experts.find((b) => b.context.bid_id === qResult.bid_id);
      if (!expert) throw new Error("Invalid answers, expert not found");

      const result: any = {
        message_id: expert.message_id,
        expert_pubkey: qResult.expert_pubkey,
        payment_hash: expert.context.payment_hash,
        status: answerResult.status,
        content: answerResult.content,
        error: answerResult.error,
      };

      if (answerResult.followup_invoice) {
        result.followup_sats = answerResult.followup_sats;
        result.followup_message_id = answerResult.followup_message_id;
        if (!this.nwcString)
          result.followup_invoice = answerResult.followup_invoice;
      }

      // If we have a followup invoice, create a new context for it
      if (
        answerResult.followup_invoice &&
        answerResult.followup_message_id &&
        ask.contexts
      ) {
        // Create new context with answer_id as the key
        ask.contexts.set(answerResult.followup_message_id, {
          bid_id: expert.context.bid_id,
          relays: expert.context.relays,
          invoice: answerResult.followup_invoice,
          bid_sats: answerResult.followup_sats!,
          payment_hash: answerResult.followup_payment_hash!,
        });
      }

      // Drop the old context
      ask.contexts.delete(qResult.bid_id);

      return result;
    });

    // Create a summary of the results
    const summary: any = {
      total: params.experts.length,
      sent: questionResults.filter((r) => r.status === "sent").length,
      failed: questionResults.filter((r) => r.status === "failed").length,
      failed_payments: failedExpertContextIds.length,
      received: answerResults.filter((r) => r.status === "received").length,
      timeout: answerResults.filter((r) => r.status === "timeout").length,
      results: combinedResults,
    };

    if (this.nwcString) {
      summary.insufficient_balance = insufficientBalance;
    }

    // Format the response as JSON string
    const responseJson = JSON.stringify(summary, null, 2);

    // Return in the format expected by MCP
    return {
      content: [
        {
          type: "text" as const,
          text: responseJson,
        },
      ],
      structuredContent: summary,
    };
  }
}