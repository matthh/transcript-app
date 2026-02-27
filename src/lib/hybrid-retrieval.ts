/**
 * Hybrid retrieval combining embedding search with BM25 lexical search.
 * Also implements adaptive K based on query type.
 *
 * Data is loaded from Vercel Blob storage at runtime to stay under
 * the 250MB serverless function size limit.
 */

import { generateEmbedding, generateEmbedding512 } from './embeddings';
import { loadVectorStoreAsync, searchSimilar, searchSimilarFiltered, StoredChunk, getChunkMap, TopicChunk, loadTopicVectorsAsync, searchTopicVectors } from './vectorstore';
import { searchBM25, expandQueryTokens } from './bm25';
import { loadBM25IndexAsync, isBM25Loaded } from './bm25-loader';
import { BM25Index } from './bm25';
import { ClassificationResult } from '@/types/episode-metadata';

const LOAD_TIMEOUT = Symbol('LOAD_TIMEOUT');

export interface RetrievalResult {
  chunk: StoredChunk;
  score: number;
  source: 'embedding' | 'bm25' | 'both';
  matchedVia?: 'fulltext' | 'topic' | 'both';
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
  const baseTerms = query
    .toLowerCase()
    .replace(/[^a-z0-9\s'-]/g, '')
    .split(/\s+/)
    .filter((t) => t.length >= 3 && !STOPWORDS.has(t));
  return expandQueryTokens(baseTerms);
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
 * Boost RRF scores for chunks from targeted episodes (metadata-matched).
 * Ensures that when the classifier identifies specific episodes via filters,
 * those episodes' chunks rank higher without excluding cross-episode mentions.
 */
function boostTargetedEpisodes(
  results: RetrievalResult[],
  targetEpisodeTitles: string[]
): RetrievalResult[] {
  if (targetEpisodeTitles.length === 0) return results;
  const targetSet = new Set(targetEpisodeTitles.map(normalizeEpisodeTitle));
  const boosted = results.map(r => {
    const title = normalizeEpisodeTitle(r.chunk.metadata.episodeTitle);
    if (targetSet.has(title)) {
      return { ...r, score: r.score * 1.5 };
    }
    return r;
  });
  return boosted.sort((a, b) => b.score - a.score);
}

// --- Speaker-aware boost ---

/**
 * Known podcast speaker name map.
 * Keys are lowercase query tokens; values are speaker name variants
 * as they appear in chunk metadata.speakers.
 */
const SPEAKER_NAME_MAP: Record<string, string[]> = {
  'jason': ['Jason Goldman', 'Jason'],
  'haitch': ['Haitch', 'Matt Haitch'],
  'matt': ['Haitch', 'Matt Haitch'],
  'corey': ['Corey'],
  'proto': ['Proto'],
  'slim': ['Slim'],
  'kev': ['Kev'],
  'rosie': ['Rosie'],
  'birria': ['birria'],
  'jonesy': ['Jonesy'],
  'animal mother': ['Animal Mother'],
  'mr java': ['Mr Java', 'Mr. Java'],
  'lizzen': ['Lizzen', 'lizzen'],
  'ethan': ['Ethan', 'ethan', 'ETHAN'],
};

/**
 * Extract target speaker names from query using deterministic word-boundary matching.
 * Returns deduplicated list of speaker name variants found.
 */
export function extractTargetSpeakers(query: string): string[] {
  const lowerQuery = query.toLowerCase();
  const speakers = new Set<string>();

  for (const [keyword, variants] of Object.entries(SPEAKER_NAME_MAP)) {
    const regex = new RegExp(`\\b${keyword}\\b`);
    if (regex.test(lowerQuery)) {
      for (const v of variants) {
        speakers.add(v);
      }
    }
  }

  return Array.from(speakers);
}

/**
 * Boost RRF scores for chunks where a target speaker appears in metadata.speakers.
 * Applied after keyword boost, before episode boost.
 * 1.3x multiplier — lower than episode boost (1.5x) since speaker presence
 * alone isn't very discriminating, but compounds with keyword boost.
 */
export function boostSpeakerMatches(
  results: RetrievalResult[],
  query: string
): RetrievalResult[] {
  const targetSpeakers = extractTargetSpeakers(query);
  if (targetSpeakers.length === 0) return results;

  return results
    .map((r) => {
      const speakers = r.chunk.metadata.speakers.toLowerCase();
      const hasSpeaker = targetSpeakers.some((s) => speakers.includes(s.toLowerCase()));
      return {
        ...r,
        score: hasSpeaker ? r.score * 1.3 : r.score,
      };
    })
    .sort((a, b) => b.score - a.score);
}

// --- Boilerplate suppression ---

const BOILERPLATE_PATTERNS = [
  /that'?s it for this episode/i,
  /want to thank.*amazing conversation/i,
  /leave us a (?:five star )?rating/i,
  /if you'?re enjoying the (?:show|podcast)/i,
  /need your help.*take a minute/i,
  /patreon\.com\/escapehatch/i,
];

/**
 * Downweight chunks matching recurring outro/credits patterns.
 * 2+ matches → 0.3× score; 1 match → 0.6× score. Re-sort after penalties.
 */
export function suppressBoilerplate(results: RetrievalResult[]): RetrievalResult[] {
  return results
    .map((r) => {
      const text = r.chunk.text;
      const matchCount = BOILERPLATE_PATTERNS.filter((p) => p.test(text)).length;
      if (matchCount >= 2) return { ...r, score: r.score * 0.3 };
      if (matchCount === 1) return { ...r, score: r.score * 0.6 };
      return r;
    })
    .sort((a, b) => b.score - a.score);
}

// --- Near-duplicate removal ---

function tokenizeForDedup(text: string): Set<string> {
  return new Set(
    text.toLowerCase().split(/\s+/).filter((t) => t.length > 2)
  );
}

function jaccardSimilarity(a: Set<string>, b: Set<string>): number {
  let intersection = 0;
  for (const token of a) {
    if (b.has(token)) intersection++;
  }
  const union = a.size + b.size - intersection;
  return union === 0 ? 0 : intersection / union;
}

/**
 * Remove near-duplicate chunks using Jaccard similarity on lowercased token sets.
 * Processes results in score-descending order; discards any chunk with Jaccard ≥ 0.6
 * against an already-kept chunk.
 */
export function deduplicateChunks(results: RetrievalResult[]): RetrievalResult[] {
  const kept: { result: RetrievalResult; tokens: Set<string> }[] = [];

  for (const result of results) {
    const tokens = tokenizeForDedup(result.chunk.text);
    const isDuplicate = kept.some((k) => jaccardSimilarity(tokens, k.tokens) >= 0.6);
    if (!isDuplicate) {
      kept.push({ result, tokens });
    }
  }

  return kept.map((k) => k.result);
}

// --- Chunk ID parsing and adjacent expansion ---

/**
 * Parse a chunk ID into its episode prefix and numeric chunk index.
 * IDs follow the format: `sanitized_episode_name_<index>` where the index
 * is always the final numeric segment after the last underscore.
 */
export function parseChunkId(id: string): { prefix: string; index: number } | null {
  const lastUnderscore = id.lastIndexOf('_');
  if (lastUnderscore === -1) return null;
  const prefix = id.slice(0, lastUnderscore);
  const indexStr = id.slice(lastUnderscore + 1);
  const index = parseInt(indexStr, 10);
  if (isNaN(index)) return null;
  return { prefix, index };
}

/**
 * Expand results by appending adjacent chunks for keyword-matching results.
 * For each result containing at least 2 query keywords, look up neighbors
 * (index ± 1) in the chunk map. Neighbors get 0.5× the parent's score.
 * The 2-keyword minimum prevents expansion on generic single-term matches
 * (e.g., a common host name) while still triggering for substantive matches.
 */
export function expandAdjacentChunks(
  results: RetrievalResult[],
  queryTerms: string[],
  chunkMap: Map<string, StoredChunk>
): RetrievalResult[] {
  if (queryTerms.length === 0) return results;

  const minKeywords = Math.min(2, queryTerms.length);
  const resultIds = new Set(results.map((r) => r.chunk.id));
  const expanded: RetrievalResult[] = [...results];

  for (const result of results) {
    const text = result.chunk.text.toLowerCase();
    const matchCount = queryTerms.filter((t) => text.includes(t)).length;
    if (matchCount < minKeywords) continue;

    const parsed = parseChunkId(result.chunk.id);
    if (!parsed) continue;

    const neighborIds = [
      `${parsed.prefix}_${parsed.index - 1}`,
      `${parsed.prefix}_${parsed.index + 1}`,
    ];

    for (const neighborId of neighborIds) {
      if (resultIds.has(neighborId)) continue;
      const neighbor = chunkMap.get(neighborId);
      if (!neighbor) continue;

      expanded.push({
        chunk: neighbor,
        score: result.score * 0.5,
        source: result.source,
      });
      resultIds.add(neighborId);
    }
  }

  return expanded;
}

/**
 * Diversify results by capping chunks per episode.
 * Ensures results span multiple episodes rather than clustering on one.
 *
 * When queryTerms are provided, keyword-matching chunks get priority within
 * each episode's allocation so they aren't crowded out by semantically similar
 * but non-matching chunks from the same episode.
 *
 * When targetEpisodeTitles are provided (<=3), those episodes get a higher
 * per-episode cap so more of their chunks survive diversification.
 */
export function diversifyByEpisode(
  results: RetrievalResult[],
  finalK: number,
  maxPerEpisode: number,
  queryTerms: string[] = [],
  targetEpisodeTitles: string[] = []
): RetrievalResult[] {
  // Compute per-episode cap overrides.
  const episodeCapOverrides = new Map<string, number>();

  // Targeted-episode cap override: when few specific episodes are targeted,
  // raise their cap so more chunks survive diversification.
  if (targetEpisodeTitles.length > 0 && targetEpisodeTitles.length <= 3) {
    const targetCap = maxPerEpisode * 3;
    for (const title of targetEpisodeTitles) {
      episodeCapOverrides.set(normalizeEpisodeTitle(title), targetCap);
    }
  }

  // Keyword-concentration cap override: when keyword matches cluster heavily
  // in one episode, raise its cap. Takes max with any existing targeted cap.
  if (queryTerms.length >= 2) {
    const multiMatchCounts = new Map<string, number>();
    let totalMultiMatch = 0;

    for (const result of results) {
      const text = result.chunk.text.toLowerCase();
      const matchCount = queryTerms.filter((t) => text.includes(t)).length;
      if (matchCount >= 2) {
        const episode = normalizeEpisodeTitle(result.chunk.metadata.episodeTitle);
        multiMatchCounts.set(episode, (multiMatchCounts.get(episode) || 0) + 1);
        totalMultiMatch++;
      }
    }

    if (totalMultiMatch > 0) {
      for (const [episode, count] of multiMatchCounts) {
        if (count >= 3 && count / totalMultiMatch >= 0.3) {
          const keywordCap = maxPerEpisode * 2;
          episodeCapOverrides.set(
            episode,
            Math.max(episodeCapOverrides.get(episode) ?? maxPerEpisode, keywordCap)
          );
        }
      }
    }
  }

  const getEpisodeCap = (episode: string) =>
    episodeCapOverrides.get(normalizeEpisodeTitle(episode)) ?? maxPerEpisode;

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
 * Normalize episode title for comparison by stripping year suffixes.
 * Metadata film field has "(1988)" but chunk episodeTitle may or may not.
 */
function normalizeEpisodeTitle(t: string): string {
  return t.replace(/\s*\(\d{4}\)/g, '').trim().toLowerCase();
}

/**
 * Inject chunks from targeted episodes that are missing from fused results.
 * Runs a separate episode-scoped embedding search and merges results at
 * the median score so they can be evaluated by downstream boosts/reranker.
 */
function injectTargetedEpisodeChunks(
  fusedResults: RetrievalResult[],
  chunks: StoredChunk[],
  queryEmbedding: number[],
  targetEpisodeTitles: string[]
): RetrievalResult[] {
  // Guard: skip if no targets or too many (broad queries)
  if (targetEpisodeTitles.length === 0 || targetEpisodeTitles.length > 3) {
    return fusedResults;
  }

  const targetSet = new Set(targetEpisodeTitles.map(normalizeEpisodeTitle));
  const existingIds = new Set(fusedResults.map(r => r.chunk.id));

  // Count existing target-episode chunks per episode
  const existingCounts = new Map<string, number>();
  for (const r of fusedResults) {
    const title = normalizeEpisodeTitle(r.chunk.metadata.episodeTitle);
    if (targetSet.has(title)) {
      existingCounts.set(title, (existingCounts.get(title) || 0) + 1);
    }
  }

  // If every target episode already has >= 3 chunks, skip
  const allWellRepresented = targetEpisodeTitles.every(
    t => (existingCounts.get(normalizeEpisodeTitle(t)) || 0) >= 3
  );
  if (allWellRepresented) return fusedResults;

  // Run episode-scoped embedding search (top 6 per episode as candidate pool)
  const candidatePool = searchSimilarFiltered(
    queryEmbedding,
    chunks,
    targetEpisodeTitles,
    6 * targetEpisodeTitles.length
  );

  // Filter: must not already exist in results, and must meet minimum similarity
  const MIN_SIMILARITY = 0.15;
  const candidates = candidatePool.filter(
    c => !existingIds.has(c.chunk.id) && c.score >= MIN_SIMILARITY
  );

  if (candidates.length === 0) return fusedResults;

  // Compute median score of existing fused results for injection score
  const scores = fusedResults.map(r => r.score).sort((a, b) => a - b);
  const medianScore = scores.length > 0
    ? scores[Math.floor(scores.length / 2)]
    : 0;

  // Cap at 3 injected chunks per target episode
  const injectedCounts = new Map<string, number>();
  const injected: RetrievalResult[] = [];

  for (const candidate of candidates) {
    const title = normalizeEpisodeTitle(candidate.chunk.metadata.episodeTitle);
    const count = injectedCounts.get(title) || 0;
    if (count >= 3) continue;

    injected.push({
      chunk: candidate.chunk,
      score: medianScore,
      source: 'embedding',
    });
    injectedCounts.set(title, count + 1);
  }

  if (injected.length === 0) return fusedResults;

  // Merge and re-sort
  const merged = [...fusedResults, ...injected];
  merged.sort((a, b) => b.score - a.score);
  return merged;
}

// --- Topic vector resolution ---

const TOPIC_SCORE_DISCOUNT = 0.85;
const TOPIC_VECTORS_ENABLED = process.env.TOPIC_VECTORS_ENABLED === 'true';

function normalizeScores(results: { score: number }[]): void {
  if (results.length === 0) return;
  const min = Math.min(...results.map(r => r.score));
  const max = Math.max(...results.map(r => r.score));
  const range = max - min || 1;
  for (const r of results) {
    r.score = (r.score - min) / range;
  }
}

function resolveTopicChunks(
  embeddingResults: RetrievalResult[],
  topicResults: { topic: TopicChunk; score: number }[],
  chunkMap: Map<string, StoredChunk>,
): RetrievalResult[] {
  // Start with all embedding results, tagged as fulltext
  const parentScores = new Map<string, RetrievalResult>();
  for (const r of embeddingResults) {
    parentScores.set(r.chunk.id, { ...r, matchedVia: 'fulltext' });
  }

  // Merge topic results (resolved to parent chunks)
  for (const t of topicResults) {
    const parentChunk = chunkMap.get(t.topic.parentChunkId);
    if (!parentChunk) continue;

    const discountedScore = t.score * TOPIC_SCORE_DISCOUNT;
    const existing = parentScores.get(t.topic.parentChunkId);

    if (existing) {
      // Both paths matched — take max score, mark as 'both'
      existing.matchedVia = 'both';
      if (discountedScore > existing.score) {
        existing.score = discountedScore;
      }
    } else {
      // Topic-only match — add with discount
      parentScores.set(t.topic.parentChunkId, {
        chunk: parentChunk,
        score: discountedScore,
        source: 'embedding',
        matchedVia: 'topic',
      });
    }
  }

  return Array.from(parentScores.values()).sort((a, b) => b.score - a.score);
}

/**
 * Perform hybrid retrieval combining embedding and BM25 search.
 * Loads data from Blob storage on first request.
 */
export async function hybridRetrieval(
  query: string,
  classification: ClassificationResult,
  overrides?: Partial<{ embeddingK: number; bm25K: number; finalK: number }>,
  options?: { timeoutMs?: number; precomputedEmbedding?: number[]; targetEpisodeTitles?: string[]; supplementalQueries?: string[]; supplementalEmbeddings?: number[][] }
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
  const queryEmbedding = options?.precomputedEmbedding ?? await generateEmbedding(query);
  const embeddingResults = searchSimilar(queryEmbedding, chunks, wideEmbeddingK);

  // Topic vector search (if enabled)
  let resolvedEmbeddingResults: (typeof embeddingResults[number] & { matchedVia?: 'fulltext' | 'topic' | 'both' })[] =
    embeddingResults.map(r => ({ ...r, matchedVia: 'fulltext' as const }));

  if (TOPIC_VECTORS_ENABLED) {
    const [topicChunks, queryEmbedding512] = await Promise.all([
      loadTopicVectorsAsync(),
      generateEmbedding512(query),
    ]);

    if (topicChunks.length > 0) {
      const topicResults = searchTopicVectors(queryEmbedding512, topicChunks, wideEmbeddingK);
      const chunkMap = getChunkMap(chunks);

      // Normalize both result sets before merging
      const normalizedEmbedding = embeddingResults.map(r => ({ ...r, score: r.score }));
      const normalizedTopic = topicResults.map(r => ({ ...r, score: r.score }));
      normalizeScores(normalizedEmbedding);
      normalizeScores(normalizedTopic);

      resolvedEmbeddingResults = resolveTopicChunks(
        normalizedEmbedding.map(r => ({
          chunk: r.chunk,
          score: r.score,
          source: 'embedding' as const,
          matchedVia: 'fulltext' as const,
        })),
        normalizedTopic,
        chunkMap,
      );
    }
  }

  // Run BM25 search (if index is available)
  let bm25Results: { docId: string; score: number; docIndex: number }[] = [];
  if (bm25Index && bm25Index.numDocs > 0) {
    bm25Results = searchBM25(query, bm25Index, wideBm25K);
  }

  // Merge results using Reciprocal Rank Fusion
  const fusedResults = reciprocalRankFusion(resolvedEmbeddingResults, bm25Results, chunks);

  // Merge supplemental query results if present
  let mergedResults = fusedResults;
  if (options?.supplementalQueries?.length) {
    const suppQueries = options.supplementalQueries;
    const suppEmbeddings = options.supplementalEmbeddings ?? [];

    // Collect all supplemental results with discount
    const SUPP_DISCOUNT = 0.7;
    const supplementalScores: Map<string, { score: number; chunk: StoredChunk }> = new Map();

    for (let i = 0; i < suppQueries.length; i++) {
      // BM25 search (free — in-memory, no API call)
      const suppBm25 = bm25Index && bm25Index.numDocs > 0
        ? searchBM25(suppQueries[i], bm25Index, wideBm25K)
        : [];

      // Embedding search (use precomputed supplemental embedding if available)
      const suppEmbedding = suppEmbeddings[i];
      const suppEmbResults = suppEmbedding
        ? searchSimilar(suppEmbedding, chunks, wideEmbeddingK)
        : [];

      // RRF for this supplemental query
      const suppFused = reciprocalRankFusion(suppEmbResults, suppBm25, chunks);

      // Add discounted scores to accumulator
      for (const result of suppFused) {
        const existing = supplementalScores.get(result.chunk.id);
        const discountedScore = result.score * SUPP_DISCOUNT;
        if (existing) {
          existing.score = Math.max(existing.score, discountedScore);
        } else {
          supplementalScores.set(result.chunk.id, {
            score: discountedScore,
            chunk: result.chunk,
          });
        }
      }
    }

    // Merge: add supplemental scores to main results
    const mainScores = new Map(mergedResults.map(r => [r.chunk.id, r]));

    for (const [id, supp] of supplementalScores) {
      const main = mainScores.get(id);
      if (main) {
        // Chunk appeared in both main and supplemental — boost it
        main.score += supp.score;
      } else {
        // Chunk only in supplemental — add with discounted score
        mainScores.set(id, {
          chunk: supp.chunk,
          score: supp.score,
          source: 'bm25' as const,
        });
      }
    }

    mergedResults = Array.from(mainScores.values())
      .sort((a, b) => b.score - a.score);
  }

  // Inject chunks from targeted episodes that may be missing from fused results
  const targetEpisodeTitles = options?.targetEpisodeTitles ?? [];
  const injectedResults = injectTargetedEpisodeChunks(mergedResults, chunks, queryEmbedding, targetEpisodeTitles);

  // Boost chunks containing exact query keywords so they survive deduplication
  const boostedResults = boostKeywordMatches(injectedResults, query);

  // Boost chunks where a target speaker is active (person-scoped queries)
  const speakerBoosted = boostSpeakerMatches(boostedResults, query);

  // Boost chunks from metadata-targeted episodes
  const episodeBoosted = boostTargetedEpisodes(speakerBoosted, targetEpisodeTitles);

  // Suppress boilerplate outro/credits chunks
  const boilerplateSuppressed = suppressBoilerplate(episodeBoosted);

  // Remove near-duplicate chunks (e.g. Best-of re-broadcasts)
  const deduplicated = deduplicateChunks(boilerplateSuppressed);

  // Diversify: cap chunks per episode so results span more episodes
  const maxPerEpisode = 2;
  const queryTerms = extractQueryTerms(query);
  const diversified = diversifyByEpisode(deduplicated, finalK, maxPerEpisode, queryTerms, targetEpisodeTitles);

  // Expand with adjacent chunks for keyword-matching results
  const chunkMap = getChunkMap(chunks);
  return expandAdjacentChunks(diversified, queryTerms, chunkMap);
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
  const loads: Promise<unknown>[] = [
    loadVectorStoreAsync(),
    loadBM25IndexAsync(),
  ];
  if (TOPIC_VECTORS_ENABLED) {
    loads.push(loadTopicVectorsAsync());
  }
  await Promise.all(loads);
}
