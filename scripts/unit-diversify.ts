/**
 * Unit tests for diversifyByEpisode keyword-aware cap overrides.
 *
 * Tests the pure function in isolation with synthetic data — no blob storage,
 * no embeddings, no network calls.
 *
 * Usage:
 *   npx tsx scripts/test-diversify.ts
 */

import { diversifyByEpisode, RetrievalResult } from '../src/lib/hybrid-retrieval';

let passed = 0;
let failed = 0;

function makeChunk(
  id: string,
  episode: string,
  text: string,
  score: number
): RetrievalResult {
  return {
    chunk: {
      id,
      text,
      embedding: [],
      metadata: {
        episodeTitle: episode,
        speakers: '',
        startTimestamp: '00:00',
        endTimestamp: '01:00',
      },
    },
    score,
    source: 'both',
  };
}

function assert(condition: boolean, label: string, detail?: string) {
  if (condition) {
    passed++;
    console.log(`  PASS  ${label}`);
  } else {
    failed++;
    console.log(`  FAIL  ${label}${detail ? `\n        ${detail}` : ''}`);
  }
}

// ─── Test 1: Concentrated multi-keyword matches raise one episode's cap ───
{
  const results: RetrievalResult[] = [
    // Ep A: 5 chunks all mentioning "villeneuve" + "marin" (multi-keyword)
    makeChunk('a1', 'Ep A', 'Jason asked villeneuve at the marin festival about dune', 10),
    makeChunk('a2', 'Ep A', 'villeneuve talked about filming in marin county', 9),
    makeChunk('a3', 'Ep A', 'the marin interview with villeneuve was great', 8),
    makeChunk('a4', 'Ep A', 'villeneuve mentioned marin as an inspiration', 7),
    makeChunk('a5', 'Ep A', 'at marin villeneuve discussed the cinematography', 6),
    // Ep B: 2 chunks, unrelated
    makeChunk('b1', 'Ep B', 'spielberg talked about filmmaking', 5),
    makeChunk('b2', 'Ep B', 'the director discussed practical effects', 4),
    // Ep C: 1 chunk with one keyword only
    makeChunk('c1', 'Ep C', 'someone mentioned villeneuve briefly', 3),
  ];

  const out = diversifyByEpisode(results, 10, 2, ['villeneuve', 'marin']);
  const epACounts = out.filter((r) => r.chunk.metadata.episodeTitle === 'Ep A').length;

  assert(
    epACounts > 2,
    'Concentrated keywords raise episode cap',
    `Ep A got ${epACounts} slots (expected >2)`
  );
  assert(
    epACounts <= 4,
    'Raised cap does not exceed 2x default',
    `Ep A got ${epACounts} slots (expected <=4)`
  );
}

// ─── Test 2: Even spread does NOT raise any cap ───
{
  const results: RetrievalResult[] = [
    // 4 episodes, each with 2 multi-keyword chunks → no episode hits 30%
    makeChunk('a1', 'Ep A', 'villeneuve at marin event', 10),
    makeChunk('a2', 'Ep A', 'marin villeneuve again', 9),
    makeChunk('b1', 'Ep B', 'villeneuve visited marin', 8),
    makeChunk('b2', 'Ep B', 'marin festival villeneuve', 7),
    makeChunk('c1', 'Ep C', 'villeneuve on marin location', 6),
    makeChunk('c2', 'Ep C', 'marin shoot villeneuve', 5),
    makeChunk('d1', 'Ep D', 'villeneuve marin interview', 4),
    makeChunk('d2', 'Ep D', 'marin villeneuve chat', 3),
  ];

  const out = diversifyByEpisode(results, 10, 2, ['villeneuve', 'marin']);

  for (const ep of ['Ep A', 'Ep B', 'Ep C', 'Ep D']) {
    const count = out.filter((r) => r.chunk.metadata.episodeTitle === ep).length;
    assert(
      count <= 2,
      `Even spread: ${ep} capped at default`,
      `${ep} got ${count} slots (expected <=2)`
    );
  }
}

// ─── Test 3: Single query term never triggers override (needs >=2 terms) ───
{
  const results: RetrievalResult[] = [
    makeChunk('a1', 'Ep A', 'villeneuve talks about dune', 10),
    makeChunk('a2', 'Ep A', 'villeneuve discussed his career', 9),
    makeChunk('a3', 'Ep A', 'villeneuve on practical effects', 8),
    makeChunk('a4', 'Ep A', 'villeneuve at the premiere', 7),
    makeChunk('b1', 'Ep B', 'spielberg mentioned in passing', 6),
  ];

  const out = diversifyByEpisode(results, 10, 2, ['villeneuve']);
  const epACounts = out.filter((r) => r.chunk.metadata.episodeTitle === 'Ep A').length;

  assert(
    epACounts === 2,
    'Single query term: no cap override',
    `Ep A got ${epACounts} slots (expected 2)`
  );
}

// ─── Test 4: Below 3-chunk threshold doesn't raise cap ───
{
  const results: RetrievalResult[] = [
    // Ep A: only 2 multi-keyword chunks (below threshold of 3)
    makeChunk('a1', 'Ep A', 'villeneuve at marin', 10),
    makeChunk('a2', 'Ep A', 'marin and villeneuve', 9),
    makeChunk('a3', 'Ep A', 'just villeneuve alone', 8),
    // Ep B: 1 multi-keyword chunk
    makeChunk('b1', 'Ep B', 'villeneuve marin passing mention', 7),
    makeChunk('b2', 'Ep B', 'unrelated content here', 6),
  ];

  // Ep A has 2 multi-keyword, Ep B has 1 → total 3, Ep A is 67% but only 2 chunks
  const out = diversifyByEpisode(results, 10, 2, ['villeneuve', 'marin']);
  const epACounts = out.filter((r) => r.chunk.metadata.episodeTitle === 'Ep A').length;

  assert(
    epACounts === 2,
    'Below 3-chunk threshold: no cap override',
    `Ep A got ${epACounts} slots (expected 2)`
  );
}

// ─── Test 5: No query terms → standard diversification ───
{
  const results: RetrievalResult[] = [
    makeChunk('a1', 'Ep A', 'villeneuve at marin', 10),
    makeChunk('a2', 'Ep A', 'marin and villeneuve', 9),
    makeChunk('a3', 'Ep A', 'more villeneuve marin', 8),
    makeChunk('a4', 'Ep A', 'villeneuve marin again', 7),
    makeChunk('b1', 'Ep B', 'something else', 6),
  ];

  const out = diversifyByEpisode(results, 10, 2, []);
  const epACounts = out.filter((r) => r.chunk.metadata.episodeTitle === 'Ep A').length;

  assert(
    epACounts === 2,
    'No query terms: standard cap applies',
    `Ep A got ${epACounts} slots (expected 2)`
  );
}

// ─── Test 6: Pass 1 keyword priority still works with raised cap ───
{
  const results: RetrievalResult[] = [
    // Ep A: mix of keyword and non-keyword chunks
    makeChunk('a1', 'Ep A', 'villeneuve at marin festival details', 10),
    makeChunk('a2', 'Ep A', 'unrelated content no keywords', 9),
    makeChunk('a3', 'Ep A', 'marin villeneuve second mention', 8),
    makeChunk('a4', 'Ep A', 'villeneuve discussed marin shoot', 7),
    makeChunk('a5', 'Ep A', 'also no keywords here', 6),
    makeChunk('a6', 'Ep A', 'villeneuve marin fourth time', 5),
    // Ep B: filler
    makeChunk('b1', 'Ep B', 'other episode content', 4),
    makeChunk('b2', 'Ep B', 'more other content', 3),
  ];

  const out = diversifyByEpisode(results, 10, 2, ['villeneuve', 'marin']);
  const epAResults = out.filter((r) => r.chunk.metadata.episodeTitle === 'Ep A');

  // All Ep A slots should go to keyword-matching chunks (pass 1),
  // not the non-keyword ones
  const allHaveKeywords = epAResults.every(
    (r) => r.chunk.text.includes('villeneuve') || r.chunk.text.includes('marin')
  );

  assert(
    allHaveKeywords,
    'Raised cap: keyword chunks get priority over non-keyword',
    `Ep A results: ${epAResults.map((r) => r.chunk.id).join(', ')}`
  );
}

// ─── Test 7: finalK limit still respected even with raised cap ───
{
  const results: RetrievalResult[] = [];
  for (let i = 0; i < 10; i++) {
    results.push(
      makeChunk(`a${i}`, 'Ep A', `villeneuve marin chunk ${i}`, 20 - i)
    );
  }
  results.push(makeChunk('b1', 'Ep B', 'other episode', 1));

  const finalK = 5;
  const out = diversifyByEpisode(results, finalK, 2, ['villeneuve', 'marin']);

  assert(
    out.length <= finalK,
    'finalK limit respected with raised cap',
    `Got ${out.length} results (expected <=${finalK})`
  );
}

// ─── Summary ───
console.log(`\n--- Results: ${passed}/${passed + failed} passed ---`);
if (failed > 0) {
  process.exit(1);
} else {
  console.log('\nAll diversifyByEpisode unit tests passed.');
}
