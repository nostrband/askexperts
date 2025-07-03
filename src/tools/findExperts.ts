import {
  createAndPublishAskEvent,
  fetchBidsFromExperts,
} from "../nostr/index.js";
import { addAsk } from "./askExperts.js";

// Define the Bid interface
export interface Bid {
  id: string; // bid payload event id
  pubkey: string;
  relays: string[]; // array of relay URLs
  bid_sats: number;
  offer: string;
  invoice: string; // Lightning Network invoice
}

// Define the input parameters interface
export interface FindExpertsParams {
  public_question_summary: string;
  tags: string[];
  max_bid_sats?: number;
}

/**
 * Find experts on a subject by posting a public summary of the question
 * @param params The parameters for finding experts
 * @returns A formatted response with a list of bids from experts
 */
export async function findExperts(
  params: FindExpertsParams
): Promise<{
  content: Array<{ type: "text"; text: string }>;
  structuredContent: any;
}> {
  // NOTE: do not print to console, MCP uses stdio transport and these messages interfere with the protocol
  // console.log(`Finding experts for question: ${params.public_question_summary}`);
  // console.log(`Tags: ${params.tags?.join(', ') || 'None'}`);
  // console.log(`Max bid: ${params.max_bid_sats || 'Not specified'} sats`);

  // Create and publish the Ask event using the nostr module
  const {
    event: askEvent,
    publishedRelays,
    sessionkey,
  } = await createAndPublishAskEvent({
    content: params.public_question_summary,
    tags: params.tags,
    max_bid_sats: params.max_bid_sats,
  });

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
  if (bids.length > 0) addAsk(askEvent.id, { sessionkey, timestamp: Date.now() });

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
