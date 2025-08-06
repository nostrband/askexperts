/**
 * Cryptographic utilities for NIP-174
 */

import {
  Event,
  UnsignedEvent,
  finalizeEvent,
  generateSecretKey,
  getPublicKey,
  nip44,
  verifyEvent,
  validateEvent,
} from 'nostr-tools';

/**
 * Generates a random key pair
 * 
 * @returns Object containing private key and public key
 */
export function generateRandomKeyPair() {
  const privateKey = generateSecretKey();
  const publicKey = getPublicKey(privateKey);
  return { privateKey, publicKey };
}

/**
 * Encrypts data using NIP-44
 * 
 * @param data - The data to encrypt
 * @param recipientPubkey - Recipient's public key
 * @param senderPrivkey - Sender's private key
 * @returns Encrypted data as string
 */
export function encrypt(
  data: string,
  recipientPubkey: string,
  senderPrivkey: Uint8Array
): string {
  const conversationKey = nip44.getConversationKey(senderPrivkey, recipientPubkey);
  return nip44.encrypt(data, conversationKey);
}

/**
 * Decrypts data using NIP-44
 * 
 * @param encryptedData - The encrypted data
 * @param senderPubkey - Sender's public key
 * @param recipientPrivkey - Recipient's private key
 * @returns Decrypted data as string
 */
export function decrypt(
  encryptedData: string,
  senderPubkey: string,
  recipientPrivkey: Uint8Array
): string {
  const conversationKey = nip44.getConversationKey(recipientPrivkey, senderPubkey);
  return nip44.decrypt(encryptedData, conversationKey);
}

/**
 * Creates and signs a Nostr event
 * 
 * @param kind - Event kind
 * @param content - Event content
 * @param tags - Event tags
 * @param privkey - Private key to sign the event
 * @returns Signed event
 */
export function createEvent(
  kind: number,
  content: string,
  tags: string[][],
  privkey: Uint8Array
): Event {
  const unsignedEvent: UnsignedEvent = {
    kind,
    created_at: Math.floor(Date.now() / 1000),
    tags,
    content,
    pubkey: getPublicKey(privkey),
  };

  return finalizeEvent(unsignedEvent, privkey);
}

/**
 * Validates a Nostr event
 * 
 * @param event - The event to validate
 * @returns True if the event is valid, false otherwise
 */
export function validateNostrEvent(event: Event): boolean {
  try {
    // Check event structure
    const isValidStructure = validateEvent(event);
    if (!isValidStructure) {
      return false;
    }

    // Verify signature
    const isValidSignature = verifyEvent(event);
    if (!isValidSignature) {
      return false;
    }

    return true;
  } catch (error) {
    return false;
  }
}
