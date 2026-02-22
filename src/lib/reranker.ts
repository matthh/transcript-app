/**
 * LLM-based reranking of retrieval results.
 *
 * After hybrid retrieval (RRF + keyword boost + dedup + expansion), this pass
 * asks Haiku to reorder chunks by actual semantic relevance to the query.
 * Especially impactful for queries where surface features (keyword overlap,
 * embedding distance) don't capture the real intent.
 */

import { getAnthropic } from './claude';
import { RetrievalResult } from './hybrid-retrieval';
import { QUICK_SYNTHESIS } from './routing-policy';

const RERANK_TIMEOUT_MS = 5000;
const RERANK_MIN_RESULTS = 6;
const EXCERPT_MAX_LEN = 600;

const STOP_WORDS = new Set([
  'the', 'a', 'an', 'and', 'or', 'but', 'in', 'on', 'at', 'to', 'for',
  'of', 'with', 'by', 'from', 'as', 'is', 'was', 'are', 'were', 'been',
  'be', 'have', 'has', 'had', 'do', 'does', 'did', 'will', 'would',
  'could', 'should', 'may', 'might', 'can', 'shall', 'not', 'what',
  'which', 'who', 'whom', 'this', 'that', 'these', 'those', 'how',
  'when', 'where', 'why', 'say', 'said', 'episode', 'about', 'like',
  'into', 'than', 'then', 'its', 'his', 'her', 'your', 'our', 'their',
  'they', 'them', 'you', 'him', 'she', 'he', 'it', 'we', 'me',
]);

/**
 * Rerank retrieval results using Haiku for semantic relevance scoring.
 *
 * - Skips if ≤ RERANK_MIN_RESULTS-1 results (not worth the API call)
 * - On error or timeout, returns original results unchanged
 */
export async function rerankChunks(
  query: string,
  results: RetrievalResult[],
  options?: { maxResults?: number; timeoutMs?: number }
): Promise<RetrievalResult[]> {
  if (results.length < RERANK_MIN_RESULTS) {
    return results;
  }

  const timeoutMs = options?.timeoutMs ?? RERANK_TIMEOUT_MS;

  try {
    const reranked = await Promise.race([
      callReranker(query, results),
      rejectAfterTimeout(timeoutMs),
    ]);
    return reranked;
  } catch (err) {
    console.warn('Reranker failed, returning original results:', err instanceof Error ? err.message : err);
    return results;
  }
}

async function callReranker(
  query: string,
  results: RetrievalResult[]
): Promise<RetrievalResult[]> {
  // Build numbered excerpt list (1-indexed for LLM clarity)
  const excerpts = results.map((r, i) => {
    const title = r.chunk.metadata.episodeTitle;
    const text = extractRelevantExcerpt(r.chunk.text, query, EXCERPT_MAX_LEN);
    return `[${i + 1}] Episode: ${title} | ${text}`;
  });

  const prompt = `Given this search query, rank the transcript excerpts by relevance.
Return a JSON array of excerpt numbers, most relevant first.
Omit any excerpts clearly irrelevant to the query.

Query: "${query}"

Excerpts:
${excerpts.join('\n')}

Respond with ONLY a JSON array of numbers, e.g. [3, 1, 5, 2]`;

  const message = await getAnthropic().messages.create({
    model: QUICK_SYNTHESIS.model,
    max_tokens: 512,
    messages: [{ role: 'user', content: prompt }],
  });

  const textBlock = message.content.find((block) => block.type === 'text');
  if (!textBlock || textBlock.type !== 'text') {
    throw new Error('No text response from reranker');
  }

  // Parse JSON array from response (handle markdown code blocks)
  const arrayMatch = textBlock.text.match(/\[[\s\S]*?\]/);
  if (!arrayMatch) {
    throw new Error('No JSON array in reranker response: ' + textBlock.text.slice(0, 200));
  }

  const ranked: unknown = JSON.parse(arrayMatch[0]);
  if (!Array.isArray(ranked) || !ranked.every((n) => typeof n === 'number')) {
    throw new Error('Reranker returned invalid format: ' + arrayMatch[0].slice(0, 200));
  }

  // Map 1-indexed numbers back to results
  const reordered: RetrievalResult[] = [];
  const used = new Set<number>();

  for (const num of ranked) {
    const idx = num - 1; // Convert 1-indexed to 0-indexed
    if (idx >= 0 && idx < results.length && !used.has(idx)) {
      reordered.push(results[idx]);
      used.add(idx);
    }
  }

  // If LLM returned nothing useful, fall back to original results
  if (reordered.length === 0) {
    return results;
  }

  // Assign descending scores so downstream ordering is preserved
  return reordered.map((r, i) => ({
    ...r,
    score: reordered.length - i,
  }));
}

/**
 * Extract the most query-relevant window from a long chunk.
 * Finds where query keywords cluster and centers the excerpt there,
 * instead of blindly taking the first N chars.
 */
function extractRelevantExcerpt(text: string, query: string, maxLen: number): string {
  if (text.length <= maxLen) return text;

  const lowerText = text.toLowerCase();
  const keywords = query.toLowerCase()
    .split(/\W+/)
    .filter(w => w.length > 2 && !STOP_WORDS.has(w));

  if (keywords.length === 0) {
    return text.slice(0, maxLen) + '...';
  }

  // Find all keyword occurrence positions
  const positions: number[] = [];
  for (const kw of keywords) {
    let idx = 0;
    while ((idx = lowerText.indexOf(kw, idx)) !== -1) {
      positions.push(idx);
      idx += kw.length;
    }
  }

  if (positions.length === 0) {
    return text.slice(0, maxLen) + '...';
  }

  // Find the window that contains the most keyword matches
  positions.sort((a, b) => a - b);

  let bestStart = 0;
  let bestCount = 0;

  for (const pos of positions) {
    const start = Math.max(0, pos - Math.floor(maxLen / 3));
    const end = start + maxLen;
    const count = positions.filter(p => p >= start && p < end).length;
    if (count > bestCount) {
      bestCount = count;
      bestStart = start;
    }
  }

  const end = Math.min(text.length, bestStart + maxLen);
  const start = Math.max(0, end - maxLen);

  let excerpt = text.slice(start, end);
  if (start > 0) excerpt = '...' + excerpt;
  if (end < text.length) excerpt += '...';

  return excerpt;
}

function rejectAfterTimeout(ms: number): Promise<never> {
  return new Promise((_, reject) =>
    setTimeout(() => reject(new Error(`Reranker timed out after ${ms}ms`)), ms)
  );
}
