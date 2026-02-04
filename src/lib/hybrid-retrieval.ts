/**
 * Hybrid retrieval combining embedding search with BM25 lexical search.
 * Also implements adaptive K based on query type.
 */

import { generateEmbedding } from './embeddings';
import { loadVectorStore, searchSimilar, StoredChunk } from './vectorstore';
import { searchBM25, BM25Index } from './bm25';
import { bm25Index } from './bm25-data';
import { ClassificationResult } from '@/types/episode-metadata';

export interface RetrievalResult {
  chunk: StoredChunk;
  score: number;
  source: 'embedding' | 'bm25' | 'both';
}

/**
 * Determine K (number of chunks to retrieve) based on query type and confidence.
 */
export function getAdaptiveK(classification: ClassificationResult): {
  embeddingK: number;
  bm25K: number;
  finalK: number;
} {
  const { type, confidence } = classification;

  switch (type) {
    case 'factual':
      // Factual queries need fewer, more precise results
      return {
        embeddingK: 8,
        bm25K: 8,
        finalK: confidence > 0.8 ? 6 : 8,
      };

    case 'interpretive':
      // Interpretive queries benefit from more context
      return {
        embeddingK: 15,
        bm25K: 10,
        finalK: confidence > 0.8 ? 12 : 15,
      };

    case 'hybrid':
      // Hybrid queries need balanced retrieval
      return {
        embeddingK: 12,
        bm25K: 10,
        finalK: 10,
      };

    default:
      return {
        embeddingK: 10,
        bm25K: 8,
        finalK: 10,
      };
  }
}

/**
 * Reciprocal Rank Fusion (RRF) to merge results from multiple sources.
 * RRF score = sum(1 / (k + rank)) for each source
 */
function reciprocalRankFusion(
  embeddingResults: { chunk: StoredChunk; score: number }[],
  bm25Results: { docId: string; score: number; docIndex: number }[],
  chunks: StoredChunk[],
  k: number = 60 // RRF constant
): RetrievalResult[] {
  const scores: Map<string, { score: number; chunk: StoredChunk; sources: Set<string> }> = new Map();

  // Add embedding results
  embeddingResults.forEach((result, rank) => {
    const id = result.chunk.id;
    const existing = scores.get(id);
    const rrfScore = 1 / (k + rank + 1);

    if (existing) {
      existing.score += rrfScore;
      existing.sources.add('embedding');
    } else {
      scores.set(id, {
        score: rrfScore,
        chunk: result.chunk,
        sources: new Set(['embedding']),
      });
    }
  });

  // Add BM25 results
  bm25Results.forEach((result, rank) => {
    const id = result.docId;
    const existing = scores.get(id);
    const rrfScore = 1 / (k + rank + 1);

    if (existing) {
      existing.score += rrfScore;
      existing.sources.add('bm25');
    } else {
      // Find the chunk by ID
      const chunk = chunks.find((c) => c.id === id);
      if (chunk) {
        scores.set(id, {
          score: rrfScore,
          chunk,
          sources: new Set(['bm25']),
        });
      }
    }
  });

  // Convert to array and sort by RRF score
  const results: RetrievalResult[] = Array.from(scores.values())
    .map(({ score, chunk, sources }) => ({
      chunk,
      score,
      source: sources.size > 1 ? 'both' : (sources.has('embedding') ? 'embedding' : 'bm25'),
    }))
    .sort((a, b) => b.score - a.score) as RetrievalResult[];

  return results;
}

/**
 * Perform hybrid retrieval combining embedding and BM25 search.
 */
export async function hybridRetrieval(
  query: string,
  classification: ClassificationResult
): Promise<RetrievalResult[]> {
  const chunks = loadVectorStore();

  if (chunks.length === 0) {
    return [];
  }

  const { embeddingK, bm25K, finalK } = getAdaptiveK(classification);

  // Run embedding search
  const queryEmbedding = await generateEmbedding(query);
  const embeddingResults = searchSimilar(queryEmbedding, chunks, embeddingK);

  // Run BM25 search (if index is available)
  let bm25Results: { docId: string; score: number; docIndex: number }[] = [];
  if (bm25Index && bm25Index.numDocs > 0) {
    bm25Results = searchBM25(query, bm25Index, bm25K);
  }

  // Merge results using Reciprocal Rank Fusion
  const fusedResults = reciprocalRankFusion(embeddingResults, bm25Results, chunks);

  // Return top K results
  return fusedResults.slice(0, finalK);
}

/**
 * Simple embedding-only search (fallback when BM25 not available).
 */
export async function embeddingOnlyRetrieval(
  query: string,
  classification: ClassificationResult
): Promise<RetrievalResult[]> {
  const chunks = loadVectorStore();

  if (chunks.length === 0) {
    return [];
  }

  const { embeddingK, finalK } = getAdaptiveK(classification);

  const queryEmbedding = await generateEmbedding(query);
  const results = searchSimilar(queryEmbedding, chunks, Math.max(embeddingK, finalK));

  return results.slice(0, finalK).map((r) => ({
    chunk: r.chunk,
    score: r.score,
    source: 'embedding' as const,
  }));
}

/**
 * Check if BM25 index is available.
 */
export function isBM25Available(): boolean {
  return bm25Index && bm25Index.numDocs > 0;
}
