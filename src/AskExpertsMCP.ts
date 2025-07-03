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
  tags: string[];
  max_bid_sats?: number;
}

/**
 * Interface for a bid structure
 */
export interface BidStructure {
  id: string;
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
  bids: BidStructure[];
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
    // Create and publish the Ask event using the nostr module
    const {
      event: askEvent,
      publishedRelays,
      sessionkey,
    } = await createAndPublishAskEvent({
      content: params.public_question_summary,
      tags: params.tags,
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
    
    if (!params.bids || !Array.isArray(params.bids) || params.bids.length === 0) {
      throw new Error('At least one bid is required');
    }
    
    // Validate each bid
    for (const bid of params.bids) {
      if (!bid.id) throw new Error('Bid id is required');
      if (!bid.pubkey) throw new Error('Bid pubkey is required');
      if (!bid.relays || !Array.isArray(bid.relays) || bid.relays.length === 0) {
        throw new Error('At least one relay is required for each bid');
      }
      // Either preimage or invoice must be present
      if (!bid.preimage && !bid.invoice) {
        throw new Error('Either preimage or invoice is required for each bid');
      }
      
      // If invoice is provided, bid_sats must also be provided
      if (bid.invoice && bid.bid_sats === undefined) {
        throw new Error('bid_sats must be provided when invoice is provided');
      }
      
      // If both invoice and bid_sats are provided, validate the amount
      if (bid.invoice && bid.bid_sats !== undefined) {
        try {
          // Decode the invoice
          const decodedInvoice = bolt11.decode(bid.invoice);
          
          // Get millisats from the invoice
          const invoiceMilliSats = decodedInvoice.millisatoshis;
          
          // If invoice doesn't have an amount, throw an error
          if (!invoiceMilliSats) {
            throw new Error(`Invoice for bid ${bid.id} doesn't specify an amount`);
          }
          
          // Convert bid_sats to millisats for comparison
          const bidMilliSats = bid.bid_sats * 1000;
          
          // Compare the amounts (allow a small tolerance for rounding)
          if (Math.abs(Number(invoiceMilliSats) - bidMilliSats) > 1) {
            throw new Error(`Invoice amount (${Number(invoiceMilliSats) / 1000} sats) doesn't match bid_sats (${bid.bid_sats} sats) for bid ${bid.id}`);
          }
        } catch (error) {
          if (error instanceof Error) {
            throw new Error(`Failed to validate invoice for bid ${bid.id}: ${error.message}`);
          } else {
            throw new Error(`Failed to validate invoice for bid ${bid.id}`);
          }
        }
      }
    }
    
    // Check for bids without preimages that need payment
    const bidsWithoutPreimage = params.bids.filter(bid => !bid.preimage && bid.invoice);
    
    // Track failed payments
    const failedPaymentBids: string[] = [];
    let insufficientBalance = false;
    
    // If there are bids without preimages, try to pay them
    if (bidsWithoutPreimage.length > 0) {
      if (!this.nwcString) {
        throw new Error('NWC connection string is required to pay for bids without preimages');
      }
      
      // Pay for the bids and get preimages
      const paymentResults = await payExperts(
        bidsWithoutPreimage as { id: string; pubkey: string; relays: string[]; invoice: string }[],
        this.nwcString
      );
      
      // Update bids with preimages from successful payments
      for (const result of paymentResults) {
        if (result.success) {
          // Find the corresponding bid and update it with the preimage
          const bid = params.bids.find(b => b.id === result.bid.id);
          if (bid) {
            bid.preimage = result.preimage;
          }
        } else {
          console.error(`Failed to pay for bid ${result.bid.id}: ${result.error}`);
          if (result.error === "INSUFFICIENT_BALANCE")
            insufficientBalance = true;
          failedPaymentBids.push(result.bid.id);
        }
      }
    }
    
    // Filter out bids without preimages (failed payments or not paid)
    const validBids = params.bids.filter(bid => bid.preimage);
    
    // Create empty results array for the case when no valid bids
    let questionResults: QuestionSentResult[] = [];
    
    // Only send questions if we have valid bids
    if (validBids.length > 0) {
      // Send questions to experts (only those with valid preimages)
      questionResults = await sendQuestionsToExperts({
        sessionkey: ask.sessionkey,
        question: params.question,
        bids: validBids as { id: string; pubkey: string; preimage: string; relays: string[] }[],
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
        bid_id: q.bid_id,
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
          bid_id: qResult.bid_id,
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
          bid_id: qResult.bid_id,
          expert_pubkey: qResult.expert_pubkey,
          question_id: qResult.question_id,
          status: 'timeout'
        };
      }
      
      // Find the corresponding bid to get the preimage
      const bid = params.bids.find(b => b.id === qResult.bid_id);
      
      return {
        bid_id: qResult.bid_id,
        expert_pubkey: qResult.expert_pubkey,
        question_id: qResult.question_id,
        answer_id: answerResult.answer_id,
        preimage: bid?.preimage,
        status: answerResult.status,
        content: answerResult.content,
        error: answerResult.error
      };
    });
    
    // Create a summary of the results
    const summary: any = {
      total: params.bids.length,
      sent: questionResults.filter(r => r.status === 'sent').length,
      failed: questionResults.filter(r => r.status === 'failed').length,
      failed_payments: failedPaymentBids.length,
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