/**
 * Debug utilities for the application
 * Uses the debug package to provide more control over logging
 */

import debug from 'debug';

// Base namespace for the application
const BASE_NAMESPACE = 'askexperts';

// Create debug instances for different parts of the application
export const debugRelay = debug(`${BASE_NAMESPACE}:relay`);
export const debugMCP = debug(`${BASE_NAMESPACE}:mcp`);
export const debugExpert = debug(`${BASE_NAMESPACE}:expert`);
export const debugClient = debug(`${BASE_NAMESPACE}:client`);
export const debugDocstore = debug(`${BASE_NAMESPACE}:docstore`);
export const debugDB = debug(`${BASE_NAMESPACE}:db`);
export const debugCompression = debug(`${BASE_NAMESPACE}:compression`);
export const debugStream = debug(`${BASE_NAMESPACE}:stream`);

// Create debug instances for different log levels
export const debugError = debug(`${BASE_NAMESPACE}:error`);

// Helper function to enable all debug namespaces
export function enableAllDebug(): void {
  debug.enable(`${BASE_NAMESPACE}:*`);
}

// Helper function to enable error debug namespaces
export function enableErrorDebug(): void {
  debug.enable(`${BASE_NAMESPACE}:error`);
}

// Helper function to disable all debug namespaces
export function disableAllDebug(): void {
  debug.disable();
}

// Export the debug function for creating custom namespaces
export { debug };