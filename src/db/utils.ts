import { DB } from "./index.js";
import { APP_DB_PATH } from "../common/constants.js";
import { DBClient } from "./DBClient.js";
import { DBRemoteClient } from "./DBRemoteClient.js";
import { DBInterface } from "./interfaces.js";
import { getCurrentUserId } from "../common/users.js";
import { hexToBytes } from "nostr-tools/utils";

// Singleton DB instance
let dbInstance: DB | null = null;

/**
 * Get the singleton DB instance
 * @returns The DB instance
 */
export function getDB(): DB {
  if (!dbInstance) {
    dbInstance = new DB(APP_DB_PATH);
  }
  return dbInstance;
}

/**
 * Create a DB remote client instance
 * @param url URL for remote DB client
 * @returns A DB remote client instance
 */
export async function createDBRemoteClient(
  url: string,
  user_id?: string
): Promise<DBRemoteClient> {
  // Get the user ID (either specified or current)
  const userId = user_id || getCurrentUserId();

  // Get the user's private key
  const user = await getDB().getUser(userId);
  if (!user) {
    throw new Error(`User with ID ${userId} not found`);
  }

  // Convert the private key string to Uint8Array
  const privkey = hexToBytes(user.privkey);

  // Return a new DBRemoteClient instance with the new object-based constructor
  return new DBRemoteClient({ url, privateKey: privkey, user_id });
}

/**
 * Create a DB client instance
 * @param url Optional URL for remote DB client
 * @returns A DB client instance (DBClient if url is undefined, DBRemoteClient otherwise)
 */
export async function createDBClient(url?: string, user_id?: string): Promise<DBInterface> {
  if (url) return createDBRemoteClient(url, user_id);

  // Return a new DBClient instance
  return new DBClient(false, user_id);
}
