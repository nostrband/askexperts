import {
  sendQuestionsToExperts,
  QuestionSentResult,
  fetchAnswersFromExperts,
  AnswerResult
} from "../nostr/index.js";
import { payExperts } from "../utils/nwc.js";

/**
 * Interface for a bid structure
 */
export interface BidStructure {
  id: string;
  pubkey: string;
  preimage?: string;
  relays: string[];
  invoice?: string;
}

/**
 * Interface for the ask_experts parameters
 */
export interface AskExpertsParams {
  question: string;
  bids: BidStructure[];
  timeout?: number;
}

/**
 * Ask experts a question by sending encrypted questions to each expert
 * @param params The parameters for asking experts
 * @returns A formatted response with the results of sending questions
 */
export async function askExperts(
  params: AskExpertsParams
): Promise<{ content: Array<{ type: "text"; text: string }>, structuredContent: any }> {
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
  }
  
  // Check for bids without preimages that need payment
  const bidsWithoutPreimage = params.bids.filter(bid => !bid.preimage && bid.invoice);
  
  // Track failed bids
  const failedBids: string[] = [];
  
  // If there are bids without preimages, try to pay them
  if (bidsWithoutPreimage.length > 0) {
    const nwcConnectionString = process.env.NWC_CONNECTION_STRING;
    
    if (!nwcConnectionString) {
      throw new Error('NWC_CONNECTION_STRING environment variable is required to pay for bids without preimages');
    }
    
    // Pay for the bids and get preimages
    const paymentResults = await payExperts(
      bidsWithoutPreimage as { id: string; pubkey: string; relays: string[]; invoice: string }[],
      nwcConnectionString
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
        failedBids.push(result.bid.id);
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
      question: params.question,
      bids: validBids as { id: string; pubkey: string; preimage: string; relays: string[] }[],
      timeout: params.timeout
    });
  }
  
  // Filter out failed questions
  const sentQuestions = questionResults.filter(q => q.status === 'sent');
  
  // Prepare for fetching answers
  const fetchParams = {
    questions: sentQuestions.map(q => ({
      question_id: q.question_id,
      bid_id: q.bid_id,
      expert_pubkey: q.expert_pubkey,
      question_privkey: q.question_privkey,
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
    
    return {
      bid_id: qResult.bid_id,
      expert_pubkey: qResult.expert_pubkey,
      question_id: qResult.question_id,
      answer_id: answerResult.answer_id,
      status: answerResult.status,
      content: answerResult.content,
      error: answerResult.error
    };
  });
  
  // Create a summary of the results
  const summary = {
    total: params.bids.length,
    sent: questionResults.filter(r => r.status === 'sent').length,
    failed: questionResults.filter(r => r.status === 'failed').length + failedBids.length,
    received: answerResults.filter(r => r.status === 'received').length,
    timeout: answerResults.filter(r => r.status === 'timeout').length,
    results: combinedResults
  };
  
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