/**
 * Cross-platform UUID generation
 * Works in both Node.js and browser environments
 */

/**
 * Generate a UUID v4
 * @returns A random UUID string
 */
export function generateUUID(): string {
  // Check if we're in a browser environment with crypto.randomUUID
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  
  // Fallback implementation for older browsers
  // This generates a UUID v4 format string
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
    const r = Math.random() * 16 | 0;
    const v = c === 'x' ? r : (r & 0x3 | 0x8);
    return v.toString(16);
  });
}