import fs from "fs";
import path from "path";
import { APP_DIR } from "./constants.js";

/**
 * Path to the file storing the current user ID
 */
export const CURRENT_USER_ID_FILE = path.join(APP_DIR, "current_user.id");

/**
 * Get the current user ID from the file
 * @returns The current user ID
 * @throws Error if the current user ID file doesn't exist
 */
export function getCurrentUserId(): string {
  if (!fs.existsSync(CURRENT_USER_ID_FILE)) {
    throw new Error(`No current user set. Current user ID file not found: ${CURRENT_USER_ID_FILE}`);
  }

  return fs.readFileSync(CURRENT_USER_ID_FILE, 'utf-8').trim();
}

/**
 * Set the current user ID by writing to the file
 * @param userId The user ID to set as current
 */
export function setCurrentUserId(userId: string): void {
  // Ensure the APP_DIR exists
  if (!fs.existsSync(APP_DIR)) {
    fs.mkdirSync(APP_DIR, { recursive: true });
  }
  
  fs.writeFileSync(CURRENT_USER_ID_FILE, userId);
}