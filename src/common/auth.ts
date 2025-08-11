/**
 * Authentication utilities for NIP-98 token-based authentication
 */
import { createHash } from 'crypto';
import { getPublicKey, finalizeEvent } from 'nostr-tools';

/**
 * Interface for HTTP requests with authorization headers
 */
export interface AuthRequest {
  headers: {
    authorization?: string;
    [key: string]: any;
  };
  method: string;
  originalUrl: string;
  rawBody?: Buffer;
}

/**
 * Helper function to create a digest hash
 * @param algorithm - Hash algorithm to use
 * @param data - Data to hash
 * @returns Hex-encoded hash
 */
function digest(algorithm: string, data: string): string {
  return createHash(algorithm).update(data).digest('hex');
}

/**
 * Parse and validate a NIP-98 authentication token
 * @param origin - Origin URL for validation
 * @param req - Request object with headers and other properties
 * @returns Public key if token is valid, empty string otherwise
 */
export async function parseAuthToken(origin: string, req: AuthRequest): Promise<string> {
  try {
    const { authorization } = req.headers;
    if (!authorization || typeof authorization !== 'string') return "";
    if (!authorization.startsWith('Nostr ')) return "";
    
    const data = authorization.split(' ')[1].trim();
    if (!data) return "";

    const json = Buffer.from(data, 'base64').toString('utf-8');
    const event = JSON.parse(json);

    const now = Math.floor(Date.now() / 1000);
    if (event.kind !== 27235) return "";
    if (event.created_at < now - 60 || event.created_at > now + 60) return "";

    const u = event.tags.find((t: string[]) => t.length === 2 && t[0] === 'u')?.[1];
    const method = event.tags.find((t: string[]) => t.length === 2 && t[0] === 'method')?.[1];
    const payload = event.tags.find((t: string[]) => t.length === 2 && t[0] === 'payload')?.[1];
    
    if (method !== req.method) return "";

    const url = new URL(u);
    
    if (
      url.origin !== origin ||
      url.pathname + url.search !== req.originalUrl
    ) return "";

    if (req.rawBody && req.rawBody.length > 0) {
      const hash = digest('sha256', req.rawBody.toString());
      if (hash !== payload) return "";
    } else if (payload) {
      return "";
    }

    // Finally after all cheap checks are done, verify the signature
    if (!verifyEvent(event)) return "";

    // all ok
    return event.pubkey;
  } catch (e) {
    console.log('Auth error:', e);
    return "";
  }
}

/**
 * Verify a Nostr event signature
 * @param event - Nostr event to verify
 * @returns True if signature is valid, false otherwise
 */
function verifyEvent(event: any): boolean {
  try {
    // Import from nostr-tools dynamically to avoid circular dependencies
    const { verifyEvent } = require('nostr-tools');
    return verifyEvent(event);
  } catch (error) {
    console.error('Error verifying event:', error);
    return false;
  }
}

/**
 * Create a NIP-98 auth token for WebSocket connection
 * @param privateKey - The private key to sign the event with (as Uint8Array)
 * @param url - The URL to connect to
 * @param method - The HTTP method (usually 'GET' for WebSocket)
 * @returns The authorization header value
 */
export function createAuthToken(privateKey: Uint8Array, url: string, method: string): string {
  // Create a NIP-98 event
  const event = {
    kind: 27235,
    created_at: Math.floor(Date.now() / 1000),
    tags: [
      ['u', url],
      ['method', method]
      // No payload tag for WebSocket connections
    ],
    content: '',
    pubkey: getPublicKey(privateKey)
  };
  
  // Sign the event
  const signedEvent = finalizeEvent(event, privateKey);
  
  // Convert to base64
  const base64Event = Buffer.from(JSON.stringify(signedEvent)).toString('base64');
  
  // Return the authorization header value
  return `Nostr ${base64Event}`;
}