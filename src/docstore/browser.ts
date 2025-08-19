/**
 * Browser-specific exports for the docstore module
 * This file only exports client-side code that can be used in browser environments
 */

export * from './interfaces.js';
export { DocStoreWebSocketClient } from './DocStoreWebSocketClient.js';
export { generateUUID } from '../common/uuid.js';