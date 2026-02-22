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
    // Truncate long chunks to stay within token budget
    const text = r.chunk.text.length > 600
      ? r.chunk.text.slice(0, 600) + '...'
      : r.chunk.text;
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

  // Append any results the LLM didn't mention (preserve rather than drop)
  for (let i = 0; i < results.length; i++) {
    if (!used.has(i)) {
      reordered.push(results[i]);
    }
  }

  // Assign descending scores so downstream ordering is preserved
  return reordered.map((r, i) => ({
    ...r,
    score: reordered.length - i,
  }));
}

function rejectAfterTimeout(ms: number): Promise<never> {
  return new Promise((_, reject) =>
    setTimeout(() => reject(new Error(`Reranker timed out after ${ms}ms`)), ms)
  );
}
