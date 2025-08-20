import { XenovaEmbeddings } from './XenovaEmbeddings.js';

export function createRagEmbeddings(model?: string) {
  return new XenovaEmbeddings(model);
}