import { DB } from "./index.js";
import { APP_DB_PATH } from "../common/constants.js";

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
