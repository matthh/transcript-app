/**
 * Hybrid retrieval combining embedding search with BM25 lexical search.
 * Also implements adaptive K based on query type.
 *
 * Data is loaded from Vercel Blob storage at runtime to stay under
 * the 250MB serverless function size limit.
 */

import { generateEmbedding } from './embeddings';
import { loadVectorStoreAsync, searchSimilar, StoredChunk } from './vectorstore';
import { searchBM25 } from './bm25';
import { loadBM25IndexAsync, isBM25Loaded } from './bm25-loader';
import { BM25Index } from './bm25';
import { ClassificationResult } from '@/types/episode-metadata';

const LOAD_TIMEOUT = Symbol('LOAD_TIMEOUT');

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

function applyKOverrides(
  base: { embeddingK: number; bm25K: number; finalK: number },
  overrides?: Partial<{ embeddingK: number; bm25K: number; finalK: number }>
): { embeddingK: number; bm25K: number; finalK: number } {
  if (!overrides) {
    return base;
  }
  return {
    embeddingK: overrides.embeddingK ?? base.embeddingK,
    bm25K: overrides.bm25K ?? base.bm25K,
    finalK: overrides.finalK ?? base.finalK,
  };
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

const STOPWORDS = new Set([
  'the', 'a', 'an', 'and', 'or', 'but', 'in', 'on', 'at', 'to', 'for',
  'of', 'with', 'by', 'from', 'is', 'it', 'not', 'are', 'was', 'were',
  'be', 'been', 'has', 'have', 'had', 'do', 'does', 'did', 'will', 'would',
  'could', 'should', 'may', 'might', 'can', 'this', 'that', 'these', 'those',
  'what', 'which', 'who', 'whom', 'when', 'where', 'why', 'how', 'about',
  'their', 'they', 'them', 'said', 'says', 'say', 'hosts', 'host', 'podcast',
  'episode', 'episodes', 'ever', 'every', 'all', 'any', 'some',
]);

/**
 * Extract meaningful query terms for keyword boosting.
 * Filters stopwords and short tokens.
 */
export function extractQueryTerms(query: string): string[] {
  return query
    .toLowerCase()
    .replace(/[^a-z0-9\s'-]/g, '')
    .split(/\s+/)
    .filter((t) => t.length >= 3 && !STOPWORDS.has(t));
}

/**
 * Boost RRF scores for chunks that contain exact query keywords.
 * Helps surface chunks with direct keyword matches above semantically
 * similar but irrelevant chunks from the same episode.
 */
function boostKeywordMatches(
  results: RetrievalResult[],
  query: string
): RetrievalResult[] {
  const terms = extractQueryTerms(query);
  if (terms.length === 0) return results;

  return results
    .map((r) => {
      const text = r.chunk.text.toLowerCase();
      const matches = terms.filter((t) => text.includes(t)).length;
      return {
        ...r,
        score: matches > 0 ? r.score * (1 + 0.15 * matches) : r.score,
      };
    })
    .sort((a, b) => b.score - a.score);
}

/**
 * Diversify results by capping chunks per episode.
 * Ensures results span multiple episodes rather than clustering on one.
 *
 * When queryTerms are provided, keyword-matching chunks get priority within
 * each episode's allocation so they aren't crowded out by semantically similar
 * but non-matching chunks from the same episode.
 */
export function diversifyByEpisode(
  results: RetrievalResult[],
  finalK: number,
  maxPerEpisode: number,
  queryTerms: string[] = []
): RetrievalResult[] {
  // Compute per-episode cap overrides based on keyword-match concentration.
  // When keyword matches cluster heavily in one episode, raise its cap so
  // more of its chunks survive diversification.
  const episodeCapOverrides = new Map<string, number>();

  if (queryTerms.length >= 2) {
    const multiMatchCounts = new Map<string, number>();
    let totalMultiMatch = 0;

    for (const result of results) {
      const text = result.chunk.text.toLowerCase();
      const matchCount = queryTerms.filter((t) => text.includes(t)).length;
      if (matchCount >= 2) {
        const episode = result.chunk.metadata.episodeTitle;
        multiMatchCounts.set(episode, (multiMatchCounts.get(episode) || 0) + 1);
        totalMultiMatch++;
      }
    }

    if (totalMultiMatch > 0) {
      for (const [episode, count] of multiMatchCounts) {
        if (count >= 3 && count / totalMultiMatch >= 0.3) {
          episodeCapOverrides.set(episode, maxPerEpisode * 2);
        }
      }
    }
  }

  const getEpisodeCap = (episode: string) =>
    episodeCapOverrides.get(episode) ?? maxPerEpisode;

  const episodeCounts = new Map<string, number>();
  const diversified: RetrievalResult[] = [];

  // Pass 1: prioritize chunks that contain query keywords
  if (queryTerms.length > 0) {
    for (const result of results) {
      if (diversified.length >= finalK) break;
      const episode = result.chunk.metadata.episodeTitle;
      const count = episodeCounts.get(episode) || 0;
      if (count >= getEpisodeCap(episode)) continue;

      const text = result.chunk.text.toLowerCase();
      if (queryTerms.some((t) => text.includes(t))) {
        diversified.push(result);
        episodeCounts.set(episode, count + 1);
      }
    }
  }

  // Pass 2: fill remaining slots with any results
  const included = new Set(diversified.map((r) => r.chunk.id));
  for (const result of results) {
    if (diversified.length >= finalK) break;
    if (included.has(result.chunk.id)) continue;
    const episode = result.chunk.metadata.episodeTitle;
    const count = episodeCounts.get(episode) || 0;
    if (count >= getEpisodeCap(episode)) continue;

    diversified.push(result);
    episodeCounts.set(episode, count + 1);
  }

  return diversified;
}

/**
 * Perform hybrid retrieval combining embedding and BM25 search.
 * Loads data from Blob storage on first request.
 */
export async function hybridRetrieval(
  query: string,
  classification: ClassificationResult,
  overrides?: Partial<{ embeddingK: number; bm25K: number; finalK: number }>,
  options?: { timeoutMs?: number }
): Promise<RetrievalResult[]> {
  // Load vector store and BM25 index in parallel, with optional timeout
  let chunks: StoredChunk[];
  let bm25Index: BM25Index;

  const loadData = Promise.all([
    loadVectorStoreAsync(),
    loadBM25IndexAsync(),
  ]);

  if (options?.timeoutMs) {
    const timeout = new Promise<typeof LOAD_TIMEOUT>((resolve) =>
      setTimeout(() => resolve(LOAD_TIMEOUT), options.timeoutMs)
    );
    const result = await Promise.race([loadData, timeout]);
    if (result === LOAD_TIMEOUT) {
      console.warn(`Search data loading timed out after ${options.timeoutMs}ms — returning empty results`);
      return [];
    }
    [chunks, bm25Index] = result;
  } else {
    [chunks, bm25Index] = await loadData;
  }

  if (chunks.length === 0) {
    console.warn('No chunks loaded from vector store');
    return [];
  }

  const { embeddingK, bm25K, finalK } = applyKOverrides(getAdaptiveK(classification), overrides);

  // Widen initial retrieval to have enough candidates after episode deduplication
  const retrievalMultiplier = 4;
  const wideEmbeddingK = embeddingK * retrievalMultiplier;
  const wideBm25K = bm25K * retrievalMultiplier;

  // Run embedding search
  const queryEmbedding = await generateEmbedding(query);
  const embeddingResults = searchSimilar(queryEmbedding, chunks, wideEmbeddingK);

  // Run BM25 search (if index is available)
  let bm25Results: { docId: string; score: number; docIndex: number }[] = [];
  if (bm25Index && bm25Index.numDocs > 0) {
    bm25Results = searchBM25(query, bm25Index, wideBm25K);
  }

  // Merge results using Reciprocal Rank Fusion
  const fusedResults = reciprocalRankFusion(embeddingResults, bm25Results, chunks);

  // Boost chunks containing exact query keywords so they survive deduplication
  const boostedResults = boostKeywordMatches(fusedResults, query);

  // Diversify: cap chunks per episode so results span more episodes
  const maxPerEpisode = 2;
  const queryTerms = extractQueryTerms(query);
  return diversifyByEpisode(boostedResults, finalK, maxPerEpisode, queryTerms);
}

/**
 * Simple embedding-only search (fallback when BM25 not available).
 */
export async function embeddingOnlyRetrieval(
  query: string,
  classification: ClassificationResult,
  overrides?: Partial<{ embeddingK: number; bm25K: number; finalK: number }>
): Promise<RetrievalResult[]> {
  const chunks = await loadVectorStoreAsync();

  if (chunks.length === 0) {
    return [];
  }

  const { embeddingK, finalK } = applyKOverrides(getAdaptiveK(classification), overrides);

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
  return isBM25Loaded();
}

/**
 * Pre-load search data (call on app startup or first request).
 */
export async function preloadSearchData(): Promise<void> {
  await Promise.all([
    loadVectorStoreAsync(),
    loadBM25IndexAsync(),
  ]);
}
