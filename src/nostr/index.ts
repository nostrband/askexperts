import {
  SimplePool,
  Event,
  UnsignedEvent,
  finalizeEvent,
  generateSecretKey,
  getPublicKey,
  nip44,
  verifyEvent,
  validateEvent
} from 'nostr-tools';
import {
  NOSTR_EVENT_KIND_ASK,
  NOSTR_EVENT_KIND_BID,
  NOSTR_EVENT_KIND_BID_PAYLOAD,
  NOSTR_EVENT_KIND_QUESTION,
  NOSTR_EVENT_KIND_ANSWER,
  DEFAULT_RELAYS
} from './constants.js';
import * as bolt11 from 'bolt11';
import { Bid, ExpertSessionStructure } from '../AskExpertsMCP.js';

/**
 * Publishes a Nostr event to multiple relays in parallel
 *
 * @param event - The Nostr event to publish
 * @param relays - Array of relay URLs to publish to
 * @param timeout - Timeout in milliseconds (default: 3000ms)
 * @returns Array of relay URLs where the event was successfully published
 */
export async function publishEvent(
  event: Event,
  relays: string[],
  timeout: number = 3000
): Promise<string[]> {
  // Create a pool for managing relay connections
  const pool = new SimplePool();
  
  // Create an array to track successful publications
  const successfulRelays: string[] = [];
  
  // Create an array of promises for publishing to each relay
  const publishPromises = relays.map(async (relayUrl) => {
    try {
      // Set up a promise that will be resolved on successful publish or rejected on timeout
      const publishPromise = new Promise<void>(async (resolve, reject) => {
        try {
          // Connect to the relay
          const relay = await pool.ensureRelay(relayUrl, { connectionTimeout: timeout });
          
          // Publish the event
          await relay.publish(event);
          
          // If successful, add to the list
          successfulRelays.push(relayUrl);
          resolve();
        } catch (err) {
          reject(err);
        }
      });
      
      // Set up a timeout promise
      const timeoutPromise = new Promise<void>((_, reject) => {
        setTimeout(() => reject(new Error(`Publish to ${relayUrl} timed out after ${timeout}ms`)), timeout);
      });
      
      // Race the publish against the timeout
      await Promise.race([publishPromise, timeoutPromise]);
    } catch (error) {
      // Log the error but don't fail the entire operation
      console.error(`Failed to publish to ${relayUrl}:`, error);
    }
  });
  
  // Wait for all publish attempts to complete
  await Promise.all(publishPromises);
  
  // Clean up the pool
  pool.close(relays);
  
  // Return the list of relays where publication was successful
  return successfulRelays;
}

/**
 * Interface for Ask event parameters
 */
export interface CreateAskEventParams {
  content: string;
  tags: string[];
  expert_pubkeys?: string[];
  max_bid_sats?: number;
}

/**
 * Creates and publishes an Ask event to the Nostr network
 *
 * @param params - Parameters for creating the Ask event
 * @param relays - Array of relay URLs to publish to (defaults to DEFAULT_RELAYS)
 * @param timeout - Timeout in milliseconds (default: 3000ms)
 * @returns Object containing the event and array of relay URLs where the event was successfully published
 */
export async function createAndPublishAskEvent(
  params: CreateAskEventParams,
  relays: string[] = DEFAULT_RELAYS,
  timeout: number = 3000
): Promise<{ event: Event, publishedRelays: string[], sessionkey: Uint8Array }> {
  const created_at = Math.floor(Date.now() / 1000);
  const sessionkey = generateSecretKey();

  // Create a Nostr event for the `ask`
  const unsignedAskEvent: UnsignedEvent = {
    kind: NOSTR_EVENT_KIND_ASK,
    created_at,
    tags: [...params.tags.map((tag) => ["t", tag])],
    content: params.content,
    pubkey: getPublicKey(sessionkey),
  };
  
  // Add expert pubkeys as p tags if provided
  if (params.expert_pubkeys && params.expert_pubkeys.length > 0) {
    for (const pubkey of params.expert_pubkeys) {
      unsignedAskEvent.tags.push(["p", pubkey]);
    }
  }
  
  if (params.max_bid_sats) {
    unsignedAskEvent.tags.push([
      "max_bid_sats",
      params.max_bid_sats.toString(),
    ]);
  }

  const askEvent = finalizeEvent(unsignedAskEvent, sessionkey);

  // Publish the event to relays
  let publishedRelays: string[] = [];
  try {
    publishedRelays = await publishEvent(askEvent, relays, timeout);
    // MCP uses stdio transport, avoid console logging
  } catch (error) {
    // MCP uses stdio transport, avoid console logging
  }

  return { event: askEvent, publishedRelays, sessionkey };
}

/**
 * Interface for a bid payload event
 */
interface BidPayloadEvent extends Event {
  content: string;
  tags: string[][];
}

/**
 * Fetches bids from experts for a given ask event
 *
 * @param ask_event_id - The ID of the ask event
 * @param sessionkey - The private key used to post the ask event
 * @param relays - Array of relay URLs to fetch from (defaults to DEFAULT_RELAYS)
 * @param timeout - Timeout in milliseconds (default: 5000ms)
 * @returns Array of Bid objects
 */
export async function fetchBidsFromExperts(
  ask_event_id: string,
  sessionkey: Uint8Array,
  relays: string[] = DEFAULT_RELAYS,
  timeout: number = 5000
): Promise<Bid[]> {
  // Create a pool for managing relay connections
  const pool = new SimplePool();
  
  // Create a filter for bid events (kind 20175) with e-tag of ask_event_id
  const filter = {
    kinds: [NOSTR_EVENT_KIND_BID],
    '#e': [ask_event_id],
    since: Math.floor(Date.now() / 1000) - 60 // Get events from the last minute
  };
  
  // Array to store the collected bids
  const bids: Bid[] = [];
  
  // Subscribe to events and collect them
  const sub = pool.subscribeMany(
    relays,
    [filter],
    {
      onevent(event: Event) {
        try {
          // Ensure it's tagging our ask
          const eTag = event.tags.find(tag => tag[0] === 'e');
          if (!eTag || eTag[1] !== ask_event_id) {
            console.error('Bid event has wrong e-tag:', eTag);
            return;
          }

          // Generate the conversation key for decryption
          const conversationKey = nip44.getConversationKey(sessionkey, event.pubkey);
          
          // Decrypt the bid payload using nip44
          const decrypted = nip44.decrypt(event.content, conversationKey);
          
          // Parse the decrypted content as a bid payload event
          const bidPayloadEvent: BidPayloadEvent = JSON.parse(decrypted);
          
          // First check the kind as required
          if (bidPayloadEvent.kind !== NOSTR_EVENT_KIND_BID_PAYLOAD) {
            console.error('Invalid bid payload event kind:', bidPayloadEvent.kind);
            return;
          }
          
          // Validate the event structure using nostr-tools validateEvent
          const isValidStructure = validateEvent(bidPayloadEvent);
          if (!isValidStructure) {
            console.error('Invalid bid payload event structure:', bidPayloadEvent);
            return;
          }
          
          // Verify the event signature using nostr-tools verifyEvent
          const isValidSignature = verifyEvent(bidPayloadEvent);
          if (!isValidSignature) {
            console.error('Invalid bid payload event signature:', bidPayloadEvent);
            return;
          }

          // Extract the invoice from the tags
          const invoiceTag = bidPayloadEvent.tags.find(tag => tag[0] === 'invoice');
          if (!invoiceTag || !invoiceTag[1]) {
            console.error('Bid payload event missing invoice tag:', bidPayloadEvent);
            return;
          }
          const invoice = invoiceTag[1];
          
          // Extract relay URLs from the tags
          const relayTags = bidPayloadEvent.tags.filter(tag => tag[0] === 'relay');
          const bidRelays = relayTags.map(tag => tag[1]);
          
          if (bidRelays.length === 0) {
            console.error('Bid payload event missing relay tags:', bidPayloadEvent);
            return;
          }
          
          // Parse the invoice using bolt11
          let bidAmount = 0;
          try {
            const decodedInvoice = bolt11.decode(invoice);
            bidAmount = decodedInvoice.satoshis || 0;
          } catch (error) {
            console.error('Failed to parse invoice:', error);
            return;
          }
          
          // Create a Bid object
          const bid: Bid = {
            id: bidPayloadEvent.id,
            pubkey: bidPayloadEvent.pubkey,
            relays: bidRelays,
            bid_sats: bidAmount,
            offer: bidPayloadEvent.content,
            invoice: invoice
          };
          
          // Add the bid to the array
          bids.push(bid);
        } catch (error) {
          console.error('Error processing bid event:', error);
        }
      }
    }
  );
  
  // Wait for the specified timeout
  await new Promise(resolve => setTimeout(resolve, timeout));
  
  // Unsubscribe and close the pool
  sub.close();
  pool.close(relays);
  
  return bids;
}

/**
 * Interface for an answer result
 */
export interface AnswerResult {
  bid_id: string;
  expert_pubkey: string;
  question_id: string;
  answer_id: string;
  status: 'received' | 'timeout';
  content?: string;
  followup_invoice?: string;
  error?: string;
}

/**
 * Interface for fetching answers from experts
 */
export interface FetchAnswersParams {
  sessionkey: Uint8Array;
  questions: {
    question_id: string;
    bid_id: string;
    expert_pubkey: string;
    relays: string[];
  }[];
  timeout: number;
}

/**
 * Fetches answers from experts for sent questions
 *
 * @param params - Parameters for fetching answers
 * @returns Array of answer results
 */
export async function fetchAnswersFromExperts(
  params: FetchAnswersParams
): Promise<AnswerResult[]> {
  const results: AnswerResult[] = [];
  if (params.questions.length === 0) {
    return results;
  }

  const pool = new SimplePool();
  
  // Create a map of question_id to question info for quick lookup
  const questionMap = new Map(
    params.questions.map(q => [
      q.question_id,
      {
        bid_id: q.bid_id,
        expert_pubkey: q.expert_pubkey,
      }
    ])
  );
  
  // Get all unique relays from all questions
  const allRelays = [...new Set(params.questions.flatMap(q => q.relays))];
  
  // Get all question IDs
  const questionIds = params.questions.map(q => q.question_id);
  
  // Create a filter for answer events (kind 20178) with e-tag of any question_id
  const filter = {
    kinds: [NOSTR_EVENT_KIND_ANSWER],
    '#e': questionIds,
    since: Math.floor(Date.now() / 1000) - 60 // Get events from the last minute
  };
  
  // Initialize results with timeout status for all questions
  for (const question of params.questions) {
    results.push({
      bid_id: question.bid_id,
      expert_pubkey: question.expert_pubkey,
      question_id: question.question_id,
      answer_id: '',
      status: 'timeout'
    });
  }
  
  // Set up a promise that will resolve when all questions are answered
  let resolveAllAnswered: () => void;
  const allAnsweredPromise = new Promise<void>(resolve => {
    resolveAllAnswered = resolve;
  });
  
  // Track which questions have been answered
  const answeredQuestions = new Set<string>();
  
  // Function to check if all questions have been answered
  const checkAllAnswered = () => {
    if (answeredQuestions.size === questionIds.length) {
      console.log("All questions answered, resolving early");
      resolveAllAnswered();
    }
  };
  
  // Subscribe to events and collect them
  const sub = pool.subscribeMany(
    allRelays,
    [filter],
    {
      onevent(event: Event) {
        try {
          // Validate the event structure using nostr-tools validateEvent
          const isValidStructure = validateEvent(event);
          if (!isValidStructure) {
            console.error('Invalid answer event structure:', event);
            return;
          }
          
          // Verify the event signature using nostr-tools verifyEvent
          const isValidSignature = verifyEvent(event);
          if (!isValidSignature) {
            console.error('Invalid answer event signature:', event);
            return;
          }
          
          // Check that the event kind is correct
          if (event.kind !== NOSTR_EVENT_KIND_ANSWER) {
            console.error('Invalid answer event kind:', event.kind);
            return;
          }
          
          // Find the question ID from the e-tag
          const questionTag = event.tags.find(tag => tag[0] === 'e');
          if (!questionTag || !questionTag[1]) {
            console.error('Answer event missing e-tag:', event);
            return;
          }
          
          const questionId = questionTag[1];
          const questionInfo = questionMap.get(questionId);
          
          if (!questionInfo) {
            console.error('Received answer for unknown question:', questionId);
            return;
          }
          
          // Generate the conversation key for decryption
          const conversationKey = nip44.getConversationKey(
            params.sessionkey,
            questionInfo.expert_pubkey
          );
          
          // Decrypt the answer payload
          const decrypted = nip44.decrypt(event.content, conversationKey);
          
          // Parse the decrypted content as an answer payload
          const answerPayload = JSON.parse(decrypted);
          
          // Validate the answer payload has content
          if (!answerPayload.content) {
            console.error('Answer payload missing content:', answerPayload);
            return;
          }
          
          // Find the existing result for this question and update it
          const resultIndex = results.findIndex(r => r.question_id === questionId);
          if (resultIndex !== -1) {
            results[resultIndex] = {
              bid_id: questionInfo.bid_id,
              expert_pubkey: questionInfo.expert_pubkey,
              question_id: questionId,
              answer_id: event.id,
              status: 'received',
              content: answerPayload.content
            };
            
            // Mark this question as answered
            answeredQuestions.add(questionId);
            
            // Check if all questions have been answered
            checkAllAnswered();
          }
        } catch (error) {
          console.error('Error processing answer event:', error);
        }
      }
    }
  );
  
  // Race between timeout and all questions being answered
  const timeoutPromise = new Promise<void>(resolve =>
    setTimeout(resolve, params.timeout)
  );
  
  // Wait for either all questions to be answered or the timeout to expire
  await Promise.race([allAnsweredPromise, timeoutPromise]);
  
  // Unsubscribe and close the pool
  sub.close();
  pool.close(allRelays);
  
  return results;
}

/**
 * Interface for a question payload
 */
interface QuestionPayload {
  content: string;
  tags: string[][];
}

/**
 * Interface for sending questions to experts
 */
export interface SendQuestionsParams {
  sessionkey: Uint8Array;
  question: string;
  experts: ExpertSessionStructure[];
  timeout?: number;
}

/**
 * Result of sending a question to an expert
 */
export interface QuestionSentResult {
  context_id: string;
  expert_pubkey: string;
  question_id: string;
  relays: string[];
  status: 'sent' | 'failed';
  error?: string;
}

/**
 * Sends questions to multiple experts based on their bids
 *
 * @param params - Parameters for sending questions
 * @returns Array of results for each question sent
 */
export async function sendQuestionsToExperts(
  params: SendQuestionsParams
): Promise<QuestionSentResult[]> {
  const results: QuestionSentResult[] = [];
  const timeout = params.timeout || 5000;
  
  // Process each bid in parallel
  const sendPromises = params.experts.map(async (expert) => {
    try {
      // Generate a random keypair for the question
      const questionPrivkey = generateSecretKey();
      const questionPubkey = getPublicKey(questionPrivkey);
      
      // Create the question payload with the preimage if available
      const questionPayload: QuestionPayload = {
        content: params.question,
        tags: []
      };
      
      // Add preimage tag if available
      if (expert.preimage) {
        questionPayload.tags.push(["preimage", expert.preimage]);
      }
      
      // Convert the payload to a string
      const questionPayloadStr = JSON.stringify(questionPayload);
      
      // Generate the conversation key for encryption
      const conversationKey = nip44.getConversationKey(params.sessionkey, expert.pubkey);
      
      // Encrypt the question payload
      const encryptedContent = nip44.encrypt(questionPayloadStr, conversationKey);
      
      // Create the question event
      const unsignedQuestionEvent: UnsignedEvent = {
        kind: NOSTR_EVENT_KIND_QUESTION,
        created_at: Math.floor(Date.now() / 1000),
        tags: [
          ["e", expert.context_id] // e-tag the bid payload event id or last answer id
        ],
        content: encryptedContent,
        pubkey: questionPubkey
      };
      
      // Sign the event
      const questionEvent = finalizeEvent(unsignedQuestionEvent, questionPrivkey);
      
      // Publish the event to the expert's relays
      const publishedRelays = await publishEvent(questionEvent, expert.relays, timeout);
      
      // Create the result object
      const result: QuestionSentResult = {
        context_id: expert.context_id,
        expert_pubkey: expert.pubkey,
        question_id: questionEvent.id,
        relays: publishedRelays,
        status: publishedRelays.length > 0 ? 'sent' : 'failed'
      };
      
      if (publishedRelays.length === 0) {
        result.error = 'Failed to publish to any relays';
      }
      
      results.push(result);
    } catch (error) {
      const result: QuestionSentResult = {
        context_id: expert.context_id,
        expert_pubkey: expert.pubkey,
        question_id: '',
        relays: [],
        status: 'failed',
        error: error instanceof Error ? error.message : String(error)
      };
      
      results.push(result);
    }
  });
  
  // Wait for all send attempts to complete
  await Promise.all(sendPromises);
  
  return results;
}