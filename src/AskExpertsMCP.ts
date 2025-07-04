import {
  createAndPublishAskEvent,
  fetchBidsFromExperts,
  sendQuestionsToExperts,
  fetchAnswersFromExperts,
  QuestionSentResult,
  AnswerResult,
  FetchAnswersParams
} from "./nostr/index.js";
import { payExperts } from "./utils/nwc.js";
import * as bolt11 from 'bolt11';

// Define the Bid interface
export interface Bid {
  id: string; // bid payload event id
  pubkey: string;
  relays: string[]; // array of relay URLs
  bid_sats: number;
  offer: string;
  invoice: string; // Lightning Network invoice
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
  context_id: string; // Bid payload event ID for the first question, or last answer event ID for a followup
  pubkey: string;
  preimage?: string;
  relays: string[];
  invoice?: string;
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

export interface AskStructure {
  sessionkey: Uint8Array;
  timestamp: number;
}

/**
 * AskExpertsMCP class for handling expert discovery and communication
 */
export class AskExpertsMCP {
  private asks: Map<string, AskStructure>;
  private relays: string[];
  private nwcString?: string;

  /**
   * Create a new AskExpertsMCP instance
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
  async findExperts(
    params: FindExpertsParams
  ): Promise<{
    content: Array<{ type: "text"; text: string }>;
    structuredContent: any;
  }> {
    // Validate that at least one of tags or expert_pubkeys is provided
    if (!params.tags && !params.expert_pubkeys) {
      throw new Error('Either tags or expert_pubkeys must be provided');
    }

    // Create and publish the Ask event using the nostr module
    const {
      event: askEvent,
      publishedRelays,
      sessionkey,
    } = await createAndPublishAskEvent({
      content: params.public_question_summary,
      tags: params.tags || [],
      expert_pubkeys: params.expert_pubkeys,
      max_bid_sats: params.max_bid_sats,
    }, this.relays);

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
      bids,
      id: askEvent.id,
    };

    // Register the ask's session key
    if (bids.length > 0) this.addAsk(askEvent.id, { sessionkey, timestamp: Date.now() });

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
  async askExperts(
    params: AskExpertsParams
  ): Promise<{ content: Array<{ type: "text"; text: string }>, structuredContent: any }> {
    const ask = this.getAsk(params.ask_id);
    if (!ask) {
      throw new Error('Ask not found or expired');
    }

    // Validate the parameters
    if (!params.question || params.question.trim() === '') {
      throw new Error('Question is required');
    }
    
    if (!params.experts || !Array.isArray(params.experts) || params.experts.length === 0) {
      throw new Error('At least one expert is required');
    }
    
    // Validate each expert
    for (const expert of params.experts) {
      if (!expert.context_id) throw new Error('Expert context_id is required');
      if (!expert.pubkey) throw new Error('Expert pubkey is required');
      if (!expert.relays || !Array.isArray(expert.relays) || expert.relays.length === 0) {
        throw new Error('At least one relay is required for each bid');
      }
      // Either preimage or invoice must be present
      if (!expert.preimage && !expert.invoice) {
        throw new Error('Either preimage or invoice is required for each bid');
      }
      
      // If invoice is provided, bid_sats must also be provided
      if (expert.invoice && expert.bid_sats === undefined) {
        throw new Error('bid_sats must be provided when invoice is provided');
      }
      
      // If both invoice and bid_sats are provided, validate the amount
      if (expert.invoice && expert.bid_sats !== undefined) {
        try {
          // Decode the invoice
          const decodedInvoice = bolt11.decode(expert.invoice);
          
          // Get millisats from the invoice
          const invoiceMilliSats = decodedInvoice.millisatoshis;
          
          // If invoice doesn't have an amount, throw an error
          if (!invoiceMilliSats) {
            throw new Error(`Invoice for bid ${expert.context_id} doesn't specify an amount`);
          }
          
          // Convert bid_sats to millisats for comparison
          const bidMilliSats = expert.bid_sats * 1000;
          
          // Compare the amounts (allow a small tolerance for rounding)
          if (Math.abs(Number(invoiceMilliSats) - bidMilliSats) > 1) {
            throw new Error(`Invoice amount (${Number(invoiceMilliSats) / 1000} sats) doesn't match bid_sats (${expert.bid_sats} sats) for bid ${expert.context_id}`);
          }
        } catch (error) {
          if (error instanceof Error) {
            throw new Error(`Failed to validate invoice for bid ${expert.context_id}: ${error.message}`);
          } else {
            throw new Error(`Failed to validate invoice for bid ${expert.context_id}`);
          }
        }
      }
    }
    
    // Check for experts without preimages that need payment
    const bidsWithoutPreimage = params.experts.filter(bid => !bid.preimage && bid.invoice);
    
    // Track failed payments
    const failedPaymentContextIds: string[] = [];
    let insufficientBalance = false;
    
    // If there are bids without preimages, try to pay them
    if (bidsWithoutPreimage.length > 0) {
      if (!this.nwcString) {
        throw new Error('NWC connection string is required to pay for bids without preimages');
      }
      
      // Pay to experts and get preimages      
      const paymentResults = await payExperts(
        bidsWithoutPreimage,
        this.nwcString
      );
      
      // Update bids with preimages from successful payments
      for (const result of paymentResults) {
        if (result.success) {
          // Find the corresponding expert and update it with the preimage
          const e = params.experts.find(b => b.context_id === result.expert.context_id);
          if (e) {
            e.preimage = result.preimage;
          }
        } else {
          console.error(`Failed to pay for bid ${result.expert.context_id}: ${result.error}`);
          if (result.error === "INSUFFICIENT_BALANCE")
            insufficientBalance = true;
          failedPaymentContextIds.push(result.expert.context_id);
        }
      }
    }
    
    // Filter out experts without preimages (failed payments or not paid)
    const validExperts = params.experts.filter(bid => bid.preimage);
    
    // Create empty results array for the case when no valid bids
    let questionResults: QuestionSentResult[] = [];
    
    // Only send questions if we have valid bids
    if (validExperts.length > 0) {
      // Send questions to experts (only those with valid preimages)
      questionResults = await sendQuestionsToExperts({
        sessionkey: ask.sessionkey,
        question: params.question,
        experts: validExperts,
        timeout: params.timeout
      });
    }
    
    // Filter out failed questions
    const sentQuestions = questionResults.filter(q => q.status === 'sent');
    
    // Prepare for fetching answers
    const fetchParams: FetchAnswersParams = {
      sessionkey: ask.sessionkey,
      questions: sentQuestions.map(q => ({
        question_id: q.question_id,
        bid_id: q.context_id,
        expert_pubkey: q.expert_pubkey,
        relays: q.relays
      })),
      timeout: params.timeout || 5000
    };
    
    // Fetch answers from experts
    const answerResults: AnswerResult[] = await fetchAnswersFromExperts(fetchParams);
    
    // Combine question and answer results
    const combinedResults = questionResults.map(qResult => {
      // If the question failed, just return the question result
      if (qResult.status === 'failed') {
        return {
          bid_id: qResult.context_id,
          expert_pubkey: qResult.expert_pubkey,
          question_id: qResult.question_id,
          status: 'failed',
          error: qResult.error
        };
      }
      
      // Find the corresponding answer result
      const answerResult = answerResults.find(a => a.question_id === qResult.question_id);
      
      if (!answerResult) {
        return {
          bid_id: qResult.context_id,
          expert_pubkey: qResult.expert_pubkey,
          question_id: qResult.question_id,
          status: 'timeout'
        };
      }
      
      // Find the corresponding expert to get the preimage
      const expert = params.experts.find(b => b.context_id === qResult.context_id);
      
      return {
        context_id: qResult.context_id,
        expert_pubkey: qResult.expert_pubkey,
        question_id: qResult.question_id,
        answer_id: answerResult.answer_id,
        preimage: expert?.preimage,
        status: answerResult.status,
        content: answerResult.content,
        followup_invoice: answerResult.followup_invoice,
        error: answerResult.error
      };
    });
    
    // Create a summary of the results
    const summary: any = {
      total: params.experts.length,
      sent: questionResults.filter(r => r.status === 'sent').length,
      failed: questionResults.filter(r => r.status === 'failed').length,
      failed_payments: failedPaymentContextIds.length,
      received: answerResults.filter(r => r.status === 'received').length,
      timeout: answerResults.filter(r => r.status === 'timeout').length,
      results: combinedResults
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
      structuredContent: summary
    };
  }
}