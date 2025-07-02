import { SimplePool, Event, nip44, getEventHash, finalizeEvent, generateSecretKey, getPublicKey, UnsignedEvent } from 'nostr-tools';
import { bytesToHex, hexToBytes } from '@noble/hashes/utils';
import { NOSTR_EVENT_KIND_ASK, NOSTR_EVENT_KIND_BID, NOSTR_EVENT_KIND_BID_PAYLOAD, NOSTR_EVENT_KIND_QUESTION, NOSTR_EVENT_KIND_ANSWER } from '../nostr/constants.js';
import { createWallet } from 'nwc-enclaved-utils';
import { nwc } from '@getalby/sdk';

// Default relays to connect to (same as in findExperts.ts)
const DEFAULT_RELAYS = [
  "wss://relay.nostr.band",
  "wss://relay.damus.io",
  "wss://nos.lol",
];

// Bid relay as specified in the requirements
const BID_RELAY = "wss://relay.damus.io";

// Amount in sats to charge for each bid
const BID_AMOUNT = 10;

/**
 * A fake expert that watches for questions (kind 20174 events) on relays
 * and sends bids with fake offers and real invoices.
 */
export async function runFakeExpert() {
  console.log("Starting fake expert...");
  
  // Create a wallet for generating invoices
  console.log("Creating wallet...");
  const { nwcString, lnAddress } = await createWallet();
  console.log("Wallet created with lnAddress:", lnAddress);
  
  // Create NWC client
  const nwcClient = new nwc.NWCClient({
    nostrWalletConnectUrl: nwcString,
  });
  
  // Generate expert keypair
  const expertPrivateKey = generateSecretKey();
  const expertPublicKey = getPublicKey(expertPrivateKey);
  console.log(`Expert pubkey: ${expertPublicKey}`);
  console.log(`Expert pubkey: ${expertPublicKey}`);
  
  // Create a pool for managing relay connections
  const pool = new SimplePool();
  
  // Create a filter for question events (kind 20174)
  const filter = {
    kinds: [NOSTR_EVENT_KIND_ASK],
    since: Math.floor(Date.now() / 1000) // Only get new events from now
  };
  
  console.log("Listening for ask events...");
  
  // Subscribe to events and handle them as they come in
  pool.subscribeMany(
    DEFAULT_RELAYS,
    [filter],
    {
      onevent(event: Event) {
        handleAskEvent(event, pool, nwcClient, expertPrivateKey, expertPublicKey);
      },
      oneose() {
        // End of stored events, now listening for new events in real-time
        console.log("End of stored events, now listening for new events in real-time");
      }
    }
  );
  
  // Keep the process running
  process.on('SIGINT', () => {
    pool.close(DEFAULT_RELAYS);
    process.exit(0);
  });
}

/**
 * Handle an ask event by creating and sending a bid
 */
async function handleAskEvent(
  askEvent: Event,
  pool: SimplePool,
  nwcClient: nwc.NWCClient,
  expertPrivateKey: Uint8Array,
  expertPublicKey: string
) {
  try {
    console.log(`Received ask event: ${JSON.stringify(askEvent)}`);
    
    // Generate a random keypair for the bid
    const bidPrivateKey = generateSecretKey();
    const bidPublicKey = getPublicKey(bidPrivateKey);
    
    // Generate an invoice for 10 sats (convert to millisats for the API)
    const { invoice } = await nwcClient.makeInvoice({
      amount: BID_AMOUNT * 1000, // Convert sats to millisats
      description: `Bid for ask ${askEvent.id}`
    });
    
    console.log(`Generated invoice: ${invoice}`);
    
    // Create the bid payload event
    const bidPayload: UnsignedEvent = {
      kind: NOSTR_EVENT_KIND_BID_PAYLOAD,
      created_at: Math.floor(Date.now() / 1000),
      pubkey: expertPublicKey,
      content: "I'm a fake expert but I can provide a real answer to your question!",
      tags: [
        ["invoice", invoice],
        ["relay", BID_RELAY]
      ]
    };
    
    // Sign the bid payload
    const signedBidPayload = finalizeEvent(bidPayload, expertPrivateKey);
    console.log(`Created bid payload: ${JSON.stringify(signedBidPayload)}`);
    
    // Encrypt the bid payload for the ask pubkey
    let encryptedContent;
    try {
      // Generate the conversation key for encryption
      const conversationKey = nip44.getConversationKey(bidPrivateKey, askEvent.pubkey);
      
      // Convert payload to string
      const payloadString = JSON.stringify(signedBidPayload);
      
      // Encrypt using the conversation key
      encryptedContent = nip44.encrypt(payloadString, conversationKey);
    } catch (error) {
      console.error('Error encrypting bid payload:', error);
      throw error;
    }
    
    // Create the bid event
    const bidEvent: UnsignedEvent = {
      kind: NOSTR_EVENT_KIND_BID,
      created_at: Math.floor(Date.now() / 1000),
      pubkey: bidPublicKey,
      content: encryptedContent,
      tags: [
        ["e", askEvent.id]
      ]
    };
    
    // Sign the bid event
    const signedBidEvent = finalizeEvent(bidEvent, bidPrivateKey);
    console.log(`Created bid event: ${JSON.stringify(signedBidEvent)}`);
    
    // Publish the bid event to the bid relay
    try {
      // pool.publish returns an array of promises - one for each relay
      const publishPromises = pool.publish(DEFAULT_RELAYS, signedBidEvent);
      
      // Wait for all promises to resolve
      const results = await Promise.allSettled(publishPromises);
      
      // Check results
      const successful = results.filter(result => result.status === 'fulfilled').length;
      const failed = results.filter(result => result.status === 'rejected').length;
      
      console.log(`Bid published to ${successful} relays, failed on ${failed} relays`);
      
      if (successful > 0) {
        console.log(`Bid published successfully to ${BID_RELAY}`);
        
        // Spawn a new async task to handle the question for this bid
        // We don't await this as it runs independently
        handleQuestionForBid(
          signedBidPayload.id,
          bidPrivateKey,
          bidPublicKey,
          expertPrivateKey,
          expertPublicKey,
          pool
        ).catch(error => {
          console.error(`Error in question handler for bid ${signedBidPayload.id}:`, error);
        });
        
        console.log(`Started question handler for bid payload ${signedBidPayload.id}`);
      } else {
        console.error(`Failed to publish bid to any relay`);
      }
    } catch (error) {
      console.error(`Failed to publish bid: ${error}`);
    }
  } catch (error) {
    console.error('Error handling ask event:', error);
  }
}

/**
 * Handle waiting for a question event for a specific bid payload ID
 * This function runs as an independent async task for each bid sent
 */
async function handleQuestionForBid(
  bidPayloadId: string,
  bidPrivateKey: Uint8Array,
  bidPublicKey: string,
  expertPrivateKey: Uint8Array,
  expertPublicKey: string,
  pool: SimplePool
) {
  console.log(`Starting question handler for bid payload ${bidPayloadId}`);
  
  // Create a promise that will resolve when a question is received or timeout
  return new Promise<void>((resolve, reject) => {
    let subscription: any = null;
    let timeoutId: NodeJS.Timeout | null = null;
    
    // Set a 60-second timeout
    timeoutId = setTimeout(() => {
      console.log(`Timeout reached for bid payload ${bidPayloadId}, closing subscription`);
      if (subscription) {
        subscription.close();
      }
      resolve(); // Resolve the promise to end the task
    }, 600000); // 600 seconds
    
    // Create a filter for question events that tag our bid payload ID
    const filter = {
      kinds: [NOSTR_EVENT_KIND_QUESTION],
      '#e': [bidPayloadId],
    };
    
    // Subscribe to question events
    subscription = pool.subscribeMany(
      DEFAULT_RELAYS,
      [filter],
      {
        onevent: async (questionEvent: Event) => {
          try {
            console.log(`Received question event for bid payload ${bidPayloadId}: ${JSON.stringify(questionEvent)}`);
            
            // Decrypt the question content
            // The question is encrypted for the expert pubkey using the question pubkey's private key
            // We need to use the expert private key and question pubkey to decrypt
            const conversationKey = nip44.getConversationKey(expertPrivateKey, questionEvent.pubkey);
            
            let questionPayload;
            try {
              const decryptedContent = nip44.decrypt(questionEvent.content, conversationKey);
              questionPayload = JSON.parse(decryptedContent);
              console.log(`Decrypted question: ${JSON.stringify(questionPayload)}`);
            } catch (error) {
              console.error(`Failed to decrypt question: ${error}`);
              throw error;
            }
            
            // In a real implementation, we would verify the payment preimage here
            // For our fake expert, we'll just generate a fake answer
            
            // Generate a random keypair for the answer
            const answerPrivateKey = generateSecretKey();
            const answerPublicKey = getPublicKey(answerPrivateKey);
            
            // Create the answer payload
            const answerPayload = {
              content: "This is a fake answer to your question. In a real implementation, this would be a thoughtful response based on the expert's knowledge.",
              tags: []
            };
            
            // Encrypt the answer payload for the question pubkey
            const answerConversationKey = nip44.getConversationKey(answerPrivateKey, questionEvent.pubkey);
            const encryptedAnswerContent = nip44.encrypt(JSON.stringify(answerPayload), answerConversationKey);
            
            // Create the answer event
            const answerEvent: UnsignedEvent = {
              kind: NOSTR_EVENT_KIND_ANSWER,
              created_at: Math.floor(Date.now() / 1000),
              pubkey: answerPublicKey,
              content: encryptedAnswerContent,
              tags: [
                ["e", questionEvent.id]
              ]
            };
            
            // Sign the answer event
            const signedAnswerEvent = finalizeEvent(answerEvent, answerPrivateKey);
            console.log(`Created answer event: ${JSON.stringify(signedAnswerEvent)}`);
            
            // Publish the answer event
            const publishPromises = pool.publish(DEFAULT_RELAYS, signedAnswerEvent);
            const results = await Promise.allSettled(publishPromises);
            
            const successful = results.filter(result => result.status === 'fulfilled').length;
            const failed = results.filter(result => result.status === 'rejected').length;
            
            console.log(`Answer published to ${successful} relays, failed on ${failed} relays`);
            
            // Clean up
            if (timeoutId) {
              clearTimeout(timeoutId);
            }
            if (subscription) {
              subscription.close();
            }
            
            // Resolve the promise to end the task
            resolve();
          } catch (error) {
            console.error(`Error handling question event: ${error}`);
            
            // Clean up
            if (timeoutId) {
              clearTimeout(timeoutId);
            }
            if (subscription) {
              subscription.close();
            }
            
            reject(error);
          }
        },
        oneose: () => {
          console.log(`End of stored events for bid payload ${bidPayloadId}, now listening for new events`);
        }
      }
    );
  });
}

// If this file is run directly, start the fake expert
if (process.argv[1].endsWith('fakeExpert.ts') ||
    process.argv[1].endsWith('fakeExpert.js')) {
  runFakeExpert().catch(error => {
    console.error('Error running fake expert:', error);
    process.exit(1);
  });
}