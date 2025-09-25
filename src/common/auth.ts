/**
 * Authentication utilities for NIP-98 token-based authentication
 */
import { NostrEvent, verifyEvent } from "nostr-tools";
import type { Signer } from "nostr-tools/signer";
import { bytesToHex } from "nostr-tools/utils";
import { sha256 } from "@noble/hashes/sha2";

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
  cookies: any;
  rawBody?: Buffer;
  req?: any;
}

const KIND_NIP98 = 27235;
const KIND_NIP981 = 27236;
const DEFAULT_NIP981_EXPIRATION = 24 * 3600;

export interface AuthTokenInfo {
  pubkey?: string;
  expiration?: number;
}

export async function parseAuthToken(
  origin: string,
  req: AuthRequest
): Promise<AuthTokenInfo> {
  const { authorization } = req.headers;
  if (!authorization || typeof authorization !== "string") return {};
  if (!authorization.startsWith("Nostr ")) return {};

  const data = authorization.split(" ")[1].trim();
  if (!data) return {};

  const json = Buffer.from(data, "base64").toString("utf-8");
  const event = JSON.parse(json);
  if (event.kind === KIND_NIP98) {
    return parseAuthTokenNip98(origin, req, event);
  } else if (event.kind === KIND_NIP981) {
    return parseAuthTokenNip981(origin, req, event);
  }
  return {};
}

/**
 * Parse and validate a NIP-98 authentication token
 * @param origin - Origin URL for validation
 * @param req - Request object with headers and other properties
 * @returns Public key if token is valid, empty string otherwise
 */
export async function parseAuthTokenNip98(
  origin: string,
  req: AuthRequest,
  event: NostrEvent
): Promise<AuthTokenInfo> {
  try {
    if (event.kind !== KIND_NIP98) return {};

    const now = Math.floor(Date.now() / 1000);
    if (event.created_at < now - 60 || event.created_at > now + 60) return {};

    const u = event.tags.find(
      (t: string[]) => t.length === 2 && t[0] === "u"
    )?.[1];
    const method = event.tags.find(
      (t: string[]) => t.length === 2 && t[0] === "method"
    )?.[1];
    const payload = event.tags.find(
      (t: string[]) => t.length === 2 && t[0] === "payload"
    )?.[1];

    if (method !== req.method) return {};
    if (!u) return {};

    const url = new URL(u);
    if (url.origin !== origin || url.pathname + url.search !== req.originalUrl)
      return {};

    if (req.rawBody && req.rawBody.length > 0) {
      const hash = bytesToHex(sha256(req.rawBody));
      if (hash !== payload) return {};
    } else if (payload) {
      return {};
    }

    // Finally after all cheap checks are done, verify the signature
    if (!verifyNostrEvent(event)) return {};

    // all ok
    return { pubkey: event.pubkey };
  } catch (e) {
    console.error("Auth error:", e);
    return {};
  }
}

export async function parseAuthTokenNip981(
  origin: string,
  req: AuthRequest,
  event: NostrEvent
): Promise<AuthTokenInfo> {
  try {
    if (event.kind !== KIND_NIP981) return {};

    const now = Math.floor(Date.now() / 1000);
    // created in the future?
    if (event.created_at > now + 60) return {};

    const domain = event.tags.find(
      (t: string[]) => t.length === 2 && t[0] === "domain"
    )?.[1];
    const expiration = event.tags.find(
      (t: string[]) => t.length === 2 && t[0] === "expiration"
    )?.[1];

    if (!domain || !expiration) return {};
    const exp = parseInt(expiration);
    if (exp < now) return {};

    // must be same domain or sub-domain of token's domain
    const originDomain = new URL(origin).hostname;
    if (originDomain !== domain && !originDomain.endsWith("." + domain))
      return {};

    // Finally after all cheap checks are done, verify the signature
    if (!verifyNostrEvent(event)) return {};

    // all ok
    return { pubkey: event.pubkey, expiration: exp };
  } catch (e) {
    console.error("Auth error:", e);
    return {};
  }
}

/**
 * Verify a Nostr event signature
 * @param event - Nostr event to verify
 * @returns True if signature is valid, false otherwise
 */
function verifyNostrEvent(event: any): boolean {
  try {
    return verifyEvent(event);
  } catch (error) {
    console.error("Error verifying event:", error);
    return false;
  }
}

/**
 * Create a NIP-98 auth token for http connection using a Signer
 * @param signer - The Signer instance to sign the event with
 * @param url - The URL to connect to
 * @param method - The HTTP method (usually 'GET' for WebSocket)
 * @param body - Optional request body
 * @returns The authorization header value
 */
export async function createAuthTokenNip98({
  signer,
  url,
  method,
  body,
}: {
  signer: Signer;
  url: string;
  method: string;
  body?: string;
}): Promise<string> {
  // Create a NIP-98 event
  const event = {
    kind: KIND_NIP98,
    created_at: Math.floor(Date.now() / 1000),
    tags: [
      ["u", url],
      ["method", method],
    ],
    content: "",
    pubkey: await signer.getPublicKey(),
  };
  if (body) event.tags.push(["payload", bytesToHex(sha256(body))]);

  // Sign the event using the signer
  const signedEvent = await signer.signEvent(event);

  // Convert to base64
  const base64Event = Buffer.from(JSON.stringify(signedEvent)).toString(
    "base64"
  );

  // Return the authorization header value
  return `Nostr ${base64Event}`;
}

/**
 * Create a NIP-981 auth token for http connection using a Signer
 * @param signer - The Signer instance to sign the event with
 * @param domain - The domain for which it's valid (and it's sub-domains)
 * @param expiration - Expiration in seconds
 * @returns The authorization header value
 */
export async function createAuthToken({
  signer,
  domain,
  expiration = DEFAULT_NIP981_EXPIRATION,
}: {
  signer: Signer;
  domain: string;
  expiration?: number;
}): Promise<string> {
  // Create a NIP-981 event
  const created_at = Math.floor(Date.now() / 1000);
  const event = {
    kind: KIND_NIP981,
    created_at,
    tags: [
      // everything under this domain
      ["domain", domain],
      ["expiration", (created_at + expiration).toString()],
    ],
    content: "",
    pubkey: await signer.getPublicKey(),
  };

  // Sign the event using the signer
  const signedEvent = await signer.signEvent(event);

  // Convert to base64
  const base64Event = Buffer.from(JSON.stringify(signedEvent)).toString(
    "base64"
  );

  // Return the authorization header value
  return `Nostr ${base64Event}`;
}
