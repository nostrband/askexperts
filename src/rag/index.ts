import { XenovaEmbeddings } from './XenovaEmbeddings.js';

// Export interfaces
export * from './interfaces.js';

// Export implementations
export * from './ChromaRagDB.js';
export * from './DocstoreToRag.js';

export function createRagEmbeddings(model?: string) {
  return new XenovaEmbeddings(model);
}