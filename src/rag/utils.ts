import { RagEmbeddings } from './interfaces.js';
import { XenovaEmbeddings } from './XenovaEmbeddings.js';

export function createRagEmbeddings(model?: string): RagEmbeddings {
  return new XenovaEmbeddings(model);
}