/**
 * Encryption utilities for NIP-173
 * Supports both "none" and "nip44" encryption types
 */

import { nip44 } from 'nostr-tools';
import { debugError } from "../common/debug.js";
import { EncryptionMethod } from './types.js';

// Encryption types
export const ENCRYPTION_NONE = "none";
export const ENCRYPTION_NIP44 = "nip44";

// 64Kb - 1 byte 
export const MAX_PAYLOAD_SIZE_NIP44_BIN = 64 * 1024 - 1;
// Payload is base64 encoded first
export const MAX_PAYLOAD_SIZE_NIP44 = Math.floor(MAX_PAYLOAD_SIZE_NIP44_BIN / 4 * 3); 


/**
 * Error thrown when encryption or decryption fails
 */
export class EncryptionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "EncryptionError";
  }
}

/**
 * Encryption interface for NIP-173
 * Defines methods for encrypting and decrypting data
 * Can be implemented to support custom encryption methods
 */
export interface Encryption {

  /**
   * Returns the limit of chunks size allowed to
   * be passed as input
   */
  maxChunkSize(type: EncryptionMethod): Promise<number | undefined>;

  /**
   * Encrypts data using the specified encryption method
   *
   * @param data - The data to encrypt as string or Uint8Array
   * @param type - The encryption method
   * @param senderPrivkey - Sender's private key (for nip44)
   * @param recipientPubkey - Recipient's public key (for nip44)
   * @returns Encrypted data as string
   */
  encrypt(
    data: string | Uint8Array,
    type: EncryptionMethod,
    senderPrivkey?: Uint8Array,
    recipientPubkey?: string
  ): Promise<string>;

  /**
   * Decrypts data using the specified encryption method
   *
   * @param data - The encrypted data as string
   * @param type - The encryption method
   * @param binary - Whether to return binary data instead of string
   * @param recipientPrivkey - Recipient's private key (for nip44)
   * @param senderPubkey - Sender's public key (for nip44)
   * @returns Decrypted data as string or Uint8Array (if binary)
   */
  decrypt(
    data: string,
    type: EncryptionMethod,
    binary: boolean,
    recipientPrivkey?: Uint8Array,
    senderPubkey?: string
  ): Promise<string | Uint8Array>;

  /**
   * Returns a list of supported encryption methods
   *
   * @returns Array of supported encryption method names
   */
  list(): string[];
}

/**
 * Default implementation of the Encryption interface
 * Provides built-in support for 'none' and 'nip44' encryption methods
 */
export class DefaultEncryption implements Encryption {

  async maxChunkSize(type: EncryptionMethod) {
    if (type === ENCRYPTION_NIP44) {
      // NIP-44 max payload size limit
      return Promise.resolve(MAX_PAYLOAD_SIZE_NIP44);
    }
  }

  /**
   * Encrypts data using the specified encryption method
   *
   * @param data - The data to encrypt as string or Uint8Array
   * @param type - The encryption method
   * @param senderPrivkey - Sender's private key (for nip44)
   * @param recipientPubkey - Recipient's public key (for nip44)
   * @returns Encrypted data as string
   */
  async encrypt(
    data: string | Uint8Array,
    type: EncryptionMethod,
    senderPrivkey?: Uint8Array,
    recipientPubkey?: string
  ): Promise<string> {
    // Convert Uint8Array to string if needed
    const stringData = typeof data === "string"
      ? data
      : Buffer.from(data).toString("base64");

    if (type === ENCRYPTION_NONE) {
      // No encryption, just return the data as string
      return stringData;
    } else if (type === ENCRYPTION_NIP44) {
      // Validate required parameters for NIP-44
      if (!senderPrivkey || !recipientPubkey) {
        throw new EncryptionError("NIP-44 encryption requires sender private key and recipient public key");
      }

      try {
        // Get conversation key and encrypt
        const conversationKey = nip44.getConversationKey(senderPrivkey, recipientPubkey);
        return nip44.encrypt(stringData, conversationKey);
      } catch (error) {
        debugError("NIP-44 encryption failed:", error);
        throw new EncryptionError(`NIP-44 encryption failed: ${error instanceof Error ? error.message : String(error)}`);
      }
    } else {
      throw new EncryptionError(`Unsupported encryption method: ${type}`);
    }
  }

  /**
   * Decrypts data using the specified encryption method
   *
   * @param data - The encrypted data as string
   * @param type - The encryption method
   * @param binary - Whether to return binary data instead of string
   * @param recipientPrivkey - Recipient's private key (for nip44)
   * @param senderPubkey - Sender's public key (for nip44)
   * @returns Decrypted data as string or Uint8Array (if binary)
   */
  async decrypt(
    data: string,
    type: EncryptionMethod,
    binary: boolean,
    recipientPrivkey?: Uint8Array,
    senderPubkey?: string
  ): Promise<string | Uint8Array> {
    let decryptedString: string;

    if (type === ENCRYPTION_NONE) {
      // No encryption, just use the data as is
      decryptedString = data;
    } else if (type === ENCRYPTION_NIP44) {
      // Validate required parameters for NIP-44
      if (!recipientPrivkey || !senderPubkey) {
        throw new EncryptionError("NIP-44 decryption requires recipient private key and sender public key");
      }

      try {
        // Get conversation key and decrypt
        const conversationKey = nip44.getConversationKey(recipientPrivkey, senderPubkey);
        decryptedString = nip44.decrypt(data, conversationKey);
      } catch (error) {
        debugError("NIP-44 decryption failed:", error);
        throw new EncryptionError(`NIP-44 decryption failed: ${error instanceof Error ? error.message : String(error)}`);
      }
    } else {
      throw new EncryptionError(`Unsupported encryption method: ${type}`);
    }

    // Return binary data or string based on the binary flag
    if (binary) {
      return new Uint8Array(Buffer.from(decryptedString, "base64"));
    } else {
      return decryptedString;
    }
  }

  /**
   * Returns a list of supported encryption methods
   *
   * @returns Array of supported encryption method names
   */
  list(): string[] {
    return [ENCRYPTION_NONE, ENCRYPTION_NIP44];
  }
}

// Singleton instance
let encryption: DefaultEncryption;

/**
 * Returns the default encryption instance
 * Creates a new instance if one doesn't exist
 */
export function getEncryption(): DefaultEncryption {
  if (!encryption) encryption = new DefaultEncryption();
  return encryption;
}