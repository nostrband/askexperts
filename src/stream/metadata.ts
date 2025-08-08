/**
 * Functions for creating and parsing stream metadata events for NIP-173
 */

import { Event } from 'nostr-tools';
import { createEvent, validateNostrEvent } from '../common/crypto.js';
import { StreamMetadata, STREAM_METADATA_KIND } from './types.js';

/**
 * Creates a stream metadata event (kind:173) from a StreamMetadata object
 * 
 * @param metadata - Stream metadata
 * @param senderPrivkey - Private key to sign the event
 * @returns Signed stream metadata event
 */
export function createStreamMetadataEvent(
  metadata: StreamMetadata,
  senderPrivkey: Uint8Array
): Event {
  // Create tags for the stream metadata event
  const tags: string[][] = [
    ["version", metadata.version || "1"],
    ["encryption", metadata.encryption],
    ["compression", metadata.compression],
    ["binary", (!!metadata.binary).toString()]
  ];
  
  // Add relay tags
  for (const relay of metadata.relays) {
    tags.push(["relay", relay]);
  }
  
  // If encryption is enabled, add the receiver_pubkey tag
  if (metadata.encryption !== "none" && metadata.receiver_pubkey) {
    tags.push(["receiver_pubkey", metadata.receiver_pubkey]);
  }
  
  // Create and sign the stream metadata event
  return createEvent(STREAM_METADATA_KIND, "", tags, senderPrivkey);
}

/**
 * Parses a stream metadata event (kind:173) into a StreamMetadata object
 * 
 * @param event - Stream metadata event
 * @returns StreamMetadata object
 * @throws Error if the event is invalid
 */
export function parseStreamMetadataEvent(event: Event): StreamMetadata {
  // Validate that it's a proper Nostr event
  if (!validateNostrEvent(event)) {
    throw new Error("Invalid Nostr event: signature verification failed");
  }
  
  // Validate that it's a stream metadata event
  if (event.kind !== STREAM_METADATA_KIND) {
    throw new Error(`Invalid event kind: ${event.kind}. Expected kind:${STREAM_METADATA_KIND} for stream metadata.`);
  }
  
  // Extract metadata from the event
  const streamId = event.pubkey;
  
  // Extract tags
  const versionTag = event.tags.find((tag: string[]) => tag[0] === "version");
  const encryptionTag = event.tags.find((tag: string[]) => tag[0] === "encryption");
  const compressionTag = event.tags.find((tag: string[]) => tag[0] === "compression");
  const binaryTag = event.tags.find((tag: string[]) => tag[0] === "binary");
  const receiverPubkeyTag = event.tags.find((tag: string[]) => tag[0] === "receiver_pubkey");
  const relayTags = event.tags.filter((tag: string[]) => tag[0] === "relay");
  
  // Validate required tags
  if (!versionTag) {
    throw new Error("Missing 'version' tag in metadata event");
  }
  
  if (!encryptionTag) {
    throw new Error("Missing 'encryption' tag in metadata event");
  }
  
  if (!compressionTag) {
    throw new Error("Missing 'compression' tag in metadata event");
  }
  
  if (!binaryTag) {
    throw new Error("Missing 'binary' tag in metadata event");
  }
  
  if (relayTags.length === 0) {
    throw new Error("Missing 'relay' tags in metadata event");
  }
  
  // Create metadata object
  const metadata: StreamMetadata = {
    streamId,
    version: versionTag[1],
    encryption: encryptionTag[1] as any,
    compression: compressionTag[1] as any,
    binary: binaryTag[1] === "true",
    relays: relayTags.map((tag: string[]) => tag[1]),
    event: event
  };
  
  // Add receiver_pubkey if encryption is used
  if (encryptionTag[1] !== "none" && receiverPubkeyTag) {
    metadata.receiver_pubkey = receiverPubkeyTag[1];
  }
  
  return metadata;
}