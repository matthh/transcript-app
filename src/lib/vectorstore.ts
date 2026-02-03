import { vectorStore } from './vector-data';

export interface StoredChunk {
  id: string;
  text: string;
  embedding: number[];
  metadata: {
    episodeTitle: string;
    speakers: string;
    startTimestamp: string;
    endTimestamp: string;
  };
}

export function saveVectorStore(): void {
  // No-op in production - data is bundled at build time
  console.warn('saveVectorStore is not available in production');
}

export function loadVectorStore(): StoredChunk[] {
  return vectorStore.chunks;
}

function cosineSimilarity(a: number[], b: number[]): number {
  let dotProduct = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < a.length; i++) {
    dotProduct += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  return dotProduct / (Math.sqrt(normA) * Math.sqrt(normB));
}

export function searchSimilar(
  queryEmbedding: number[],
  chunks: StoredChunk[],
  topK: number = 10
): { chunk: StoredChunk; score: number }[] {
  const scored = chunks.map((chunk) => ({
    chunk,
    score: cosineSimilarity(queryEmbedding, chunk.embedding),
  }));

  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, topK);
}
