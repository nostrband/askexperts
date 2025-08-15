/**
 * Browser-specific exports for the database module
 * This file only exports client-side code that can be used in browser environments
 */

export type { DBExpert, DBWallet, DBInterface } from './interfaces.js';
export { DBRemoteClient } from './DBRemoteClient.js';