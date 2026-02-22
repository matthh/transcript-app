/**
 * Retrieval regression tests.
 *
 * Tests the hybrid retrieval layer (embedding + BM25 + RRF fusion) to ensure
 * search results include expected episodes/content. Each case provides a query,
 * a fixed classification (to avoid LLM calls), and assertions on the results.
 *
 * Usage:
 *   npx tsx scripts/regression-retrieval.ts
 */

import * as dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

import {
  hybridRetrieval,
  RetrievalResult,
  parseChunkId,
  suppressBoilerplate,
  suppressBestOfRebroadcasts,
  deduplicateChunks,
  expandAdjacentChunks,
} from '../src/lib/hybrid-retrieval';
import { rerankChunks } from '../src/lib/reranker';
import { StoredChunk } from '../src/lib/vectorstore';
import { ClassificationResult } from '../src/types/episode-metadata';

interface RetrievalCase {
  name: string;
  query: string;
  classification: ClassificationResult;
  /** At least one result must come from an episode whose title matches this substring */
  expectEpisodeInResults?: string[];
  /** Results should span at least this many distinct episodes */
  expectMinDistinctEpisodes?: number;
  /** A result's text must contain this substring (case-insensitive) */
  expectTextIncludes?: string[];
  /** Minimum number of results expected */
  expectMinResults?: number;
  /** Override K values */
  kOverrides?: Partial<{ embeddingK: number; bm25K: number; finalK: number }>;
}

const INTERPRETIVE: ClassificationResult = {
  type: 'interpretive',
  confidence: 0.9,
  filters: {},
};

const FACTUAL: ClassificationResult = {
  type: 'factual',
  confidence: 0.9,
  filters: {},
};

const HYBRID: ClassificationResult = {
  type: 'hybrid',
  confidence: 0.9,
  filters: {},
};

const cases: RetrievalCase[] = [
  // --- Cross-episode recall: mentions spread across many episodes ---
  {
    name: 'Jodorowsky mentions span multiple episodes',
    query: 'earliest mentions of director Jodorowsky on the podcast',
    classification: INTERPRETIVE,
    expectMinDistinctEpisodes: 4,
    expectTextIncludes: ['Jodorowsky'],
    expectEpisodeInResults: ['Dune'],
  },
  {
    name: 'Bill Murray across episodes',
    query: 'every time Bill Murray is mentioned or discussed',
    classification: INTERPRETIVE,
    expectMinDistinctEpisodes: 2,
    expectTextIncludes: ['Murray'],
  },
  {
    name: 'Spielberg references across episodes',
    query: 'what have the hosts said about Steven Spielberg across different episodes',
    classification: INTERPRETIVE,
    expectMinDistinctEpisodes: 2,
  },

  // --- Single-episode deep dive ---
  {
    name: 'Jaws episode has substantive results',
    query: 'what did the hosts think about Jaws',
    classification: INTERPRETIVE,
    expectEpisodeInResults: ['Jaws'],
    expectMinResults: 3,
  },
  {
    name: 'Godfather opinion retrieval',
    query: 'discussion about The Godfather and its legacy',
    classification: INTERPRETIVE,
    expectEpisodeInResults: ['Godfather'],
    expectMinResults: 3,
  },

  // --- Specific person/topic retrieval ---
  {
    name: 'Rosie Knight guest appearances',
    query: 'Rosie Knight talking about comics or superheroes',
    classification: INTERPRETIVE,
    expectTextIncludes: ['Rosie'],
    expectMinResults: 2,
  },
  {
    name: 'Kev voicemail retrieval',
    query: "Kev's voicemail questions to the hosts",
    classification: INTERPRETIVE,
    expectTextIncludes: ['Kev'],
    expectMinDistinctEpisodes: 2,
  },
  {
    name: 'birria contributions',
    query: 'birria discussing a movie on the podcast',
    classification: INTERPRETIVE,
    expectTextIncludes: ['birria'],
    expectMinResults: 2,
  },

  // --- Thematic / cross-cutting queries ---
  {
    name: 'Practical effects discussion',
    query: 'discussions about practical effects versus CGI',
    classification: INTERPRETIVE,
    expectMinResults: 3,
    expectMinDistinctEpisodes: 2,
  },
  {
    name: 'Soundtrack or score mentions',
    query: 'when do the hosts talk about the soundtrack or musical score of a film',
    classification: INTERPRETIVE,
    expectMinResults: 3,
    expectMinDistinctEpisodes: 2,
  },
  {
    name: 'Director filmography ranking',
    query: 'hosts ranking or comparing movies by the same director',
    classification: INTERPRETIVE,
    expectMinResults: 2,
  },

  // --- Factual retrieval that falls back to transcripts ---
  {
    name: 'Factual fallback: who directed Rushmore',
    query: 'who directed Rushmore according to the hosts',
    classification: FACTUAL,
    expectEpisodeInResults: ['Rushmore'],
  },

  // --- Keyword precision: niche topic retrieval ---
  {
    name: 'Challenger disaster retrieval',
    query: 'what have hosts said about the Challenger disaster?',
    classification: INTERPRETIVE,
    expectTextIncludes: ['Challenger'],
    expectMinDistinctEpisodes: 2,
    expectMinResults: 3,
  },

  // --- Keyword-concentrated single-episode queries ---
  {
    name: 'Villeneuve Marin interview retrieves ep 64 content',
    query: 'what did Jason ask Villeneuve at the marin film festival',
    classification: FACTUAL,
    expectEpisodeInResults: ['Villeneuve interview'],
    expectTextIncludes: ['Villeneuve'],
    expectMinResults: 3,
  },

  // --- Transcript-content queries (must search transcripts, not just metadata) ---
  {
    name: 'Voicemail content findable via transcript search',
    query: 'Kev voicemail asking about cinematography',
    classification: HYBRID,
    expectTextIncludes: ['Kev'],
    expectMinResults: 2,
    expectMinDistinctEpisodes: 2,
  },

  // --- Edge cases ---
  {
    name: 'Exact quote retrieval',
    query: 'lead paint chips were delicious',
    classification: INTERPRETIVE,
    expectMinResults: 1,
  },
  {
    name: 'Deakins Award mentions',
    query: 'Deakins Award',
    classification: INTERPRETIVE,
    expectMinResults: 1,
    expectTextIncludes: ['Deakins'],
  },
  {
    name: 'Misspelled name still finds results',
    query: 'what did Hatch say about the cinematography',
    classification: INTERPRETIVE,
    expectMinResults: 1,
  },
  {
    name: 'Broad query returns diverse episodes',
    query: 'funniest moments on the podcast',
    classification: INTERPRETIVE,
    expectMinDistinctEpisodes: 3,
  },
];

// --- Unit tests for new retrieval functions ---

function makeChunk(id: string, text: string, episode: string = 'Test Episode'): StoredChunk {
  return {
    id,
    text,
    embedding: [],
    metadata: {
      episodeTitle: episode,
      speakers: 'Speaker A',
      startTimestamp: '00:00:00',
      endTimestamp: '00:01:00',
    },
  };
}

function makeResult(id: string, text: string, score: number, episode: string = 'Test Episode'): RetrievalResult {
  return {
    chunk: makeChunk(id, text, episode),
    score,
    source: 'both',
  };
}

async function runUnitTests(): Promise<{ passed: number; failed: number; errors: string[] }> {
  let passed = 0;
  let failed = 0;
  const errors: string[] = [];

  function assert(condition: boolean, msg: string) {
    if (condition) {
      passed++;
    } else {
      failed++;
      errors.push(msg);
    }
  }

  // --- parseChunkId tests ---
  const p1 = parseChunkId('Ep_64_Villeneuve_5');
  assert(p1 !== null && p1.prefix === 'Ep_64_Villeneuve' && p1.index === 5,
    'parseChunkId: normal ID with underscores');

  const p2 = parseChunkId('Best_of__Season_2_12');
  assert(p2 !== null && p2.prefix === 'Best_of__Season_2' && p2.index === 12,
    'parseChunkId: double underscores');

  const p3 = parseChunkId('Simple_0');
  assert(p3 !== null && p3.prefix === 'Simple' && p3.index === 0,
    'parseChunkId: index zero');

  const p4 = parseChunkId('nounderscore');
  assert(p4 === null, 'parseChunkId: no underscore returns null');

  const p5 = parseChunkId('prefix_abc');
  assert(p5 === null, 'parseChunkId: non-numeric index returns null');

  const p6 = parseChunkId('a_b_c_99');
  assert(p6 !== null && p6.prefix === 'a_b_c' && p6.index === 99,
    'parseChunkId: multiple underscores, last segment is index');

  // --- suppressBoilerplate tests ---
  const boilerplateChunk = makeResult('bp_1',
    "That's it for this episode. We want to thank our guest for an amazing conversation. Leave us a five star rating.",
    1.0);
  const cleanChunk = makeResult('clean_1',
    "The cinematography in Blade Runner is absolutely stunning. Roger Deakins really outdid himself.",
    1.0);
  const singleMatch = makeResult('sm_1',
    "If you're enjoying the show, check out our other episodes about sci-fi classics.",
    1.0);

  const suppressed = suppressBoilerplate([boilerplateChunk, cleanChunk, singleMatch]);
  const bpResult = suppressed.find(r => r.chunk.id === 'bp_1')!;
  const clResult = suppressed.find(r => r.chunk.id === 'clean_1')!;
  const smResult = suppressed.find(r => r.chunk.id === 'sm_1')!;

  assert(Math.abs(bpResult.score - 0.3) < 0.001,
    `suppressBoilerplate: 3-pattern match → 0.3x (got ${bpResult.score})`);
  assert(clResult.score === 1.0,
    'suppressBoilerplate: clean chunk unchanged');
  assert(Math.abs(smResult.score - 0.6) < 0.001,
    `suppressBoilerplate: 1-pattern match → 0.6x (got ${smResult.score})`);

  // --- deduplicateChunks tests ---
  const original = makeResult('orig_1',
    'the quick brown fox jumps over the lazy dog near the river bank',
    1.0, 'Episode A');
  const duplicate = makeResult('dup_1',
    'the quick brown fox jumps over the lazy dog near the river bank today',
    0.9, 'Episode B');
  const different = makeResult('diff_1',
    'cinematography and lighting techniques in modern horror films are fascinating',
    0.8, 'Episode C');

  const deduped = deduplicateChunks([original, duplicate, different]);
  assert(deduped.length === 2,
    `deduplicateChunks: removes near-duplicate (got ${deduped.length} results)`);
  assert(deduped[0].chunk.id === 'orig_1',
    'deduplicateChunks: keeps higher-scored original');
  assert(deduped[1].chunk.id === 'diff_1',
    'deduplicateChunks: keeps different chunk');

  // Verify distinct chunks are kept
  const allDistinct = [
    makeResult('d_1', 'alpha beta gamma delta epsilon', 1.0),
    makeResult('d_2', 'zeta eta theta iota kappa', 0.9),
    makeResult('d_3', 'lambda omicron sigma omega tau', 0.8),
  ];
  const dedupedDistinct = deduplicateChunks(allDistinct);
  assert(dedupedDistinct.length === 3,
    'deduplicateChunks: keeps all distinct chunks');

  // --- expandAdjacentChunks tests ---
  const chunkMap = new Map<string, StoredChunk>();
  chunkMap.set('ep_a_4', makeChunk('ep_a_4', 'Previous chunk about Eszterhas anecdote'));
  chunkMap.set('ep_a_5', makeChunk('ep_a_5', 'Main chunk mentioning Eszterhas'));
  chunkMap.set('ep_a_6', makeChunk('ep_a_6', 'Next chunk continues the Eszterhas story'));
  chunkMap.set('ep_b_2', makeChunk('ep_b_2', 'Unrelated chunk about something else'));

  const inputResults: RetrievalResult[] = [
    { chunk: chunkMap.get('ep_a_5')!, score: 1.0, source: 'both' },
    { chunk: chunkMap.get('ep_b_2')!, score: 0.8, source: 'bm25' },
  ];

  const expanded = expandAdjacentChunks(inputResults, ['eszterhas'], chunkMap);
  assert(expanded.length === 4,
    `expandAdjacentChunks: adds 2 neighbors for keyword match (got ${expanded.length})`);
  const neighborIds = expanded.map(r => r.chunk.id);
  assert(neighborIds.includes('ep_a_4'),
    'expandAdjacentChunks: includes previous chunk');
  assert(neighborIds.includes('ep_a_6'),
    'expandAdjacentChunks: includes next chunk');

  const neighbor4 = expanded.find(r => r.chunk.id === 'ep_a_4')!;
  assert(Math.abs(neighbor4.score - 0.5) < 0.001,
    `expandAdjacentChunks: neighbor score is 0.5x parent (got ${neighbor4.score})`);

  // Non-keyword chunk should not expand
  assert(!neighborIds.includes('ep_b_1') && !neighborIds.includes('ep_b_3'),
    'expandAdjacentChunks: non-keyword chunk does not expand');

  // Already-present neighbors should not be duplicated
  const withExisting: RetrievalResult[] = [
    { chunk: chunkMap.get('ep_a_5')!, score: 1.0, source: 'both' },
    { chunk: chunkMap.get('ep_a_6')!, score: 0.9, source: 'embedding' },
  ];
  const expandedExisting = expandAdjacentChunks(withExisting, ['eszterhas'], chunkMap);
  const ep_a_6_count = expandedExisting.filter(r => r.chunk.id === 'ep_a_6').length;
  assert(ep_a_6_count === 1,
    `expandAdjacentChunks: skips already-present neighbor (got ${ep_a_6_count} copies)`);

  // Empty query terms should return unchanged
  const noExpand = expandAdjacentChunks(inputResults, [], chunkMap);
  assert(noExpand.length === inputResults.length,
    'expandAdjacentChunks: empty queryTerms returns unchanged');

  // With 2+ query terms, chunk matching only 1 term should NOT expand
  chunkMap.set('ep_c_5', makeChunk('ep_c_5', 'This chunk mentions only digital effects'));
  chunkMap.set('ep_c_4', makeChunk('ep_c_4', 'Neighbor of digital chunk'));
  chunkMap.set('ep_c_6', makeChunk('ep_c_6', 'Other neighbor of digital chunk'));
  const multiTermInput: RetrievalResult[] = [
    { chunk: chunkMap.get('ep_a_5')!, score: 1.0, source: 'both' }, // has "eszterhas" only
    { chunk: chunkMap.get('ep_c_5')!, score: 0.8, source: 'bm25' }, // has "digital" only
  ];
  const multiTermExpanded = expandAdjacentChunks(multiTermInput, ['eszterhas', 'digital', 'court'], chunkMap);
  // ep_a_5 has only 1 of 3 terms → no expansion; ep_c_5 has only 1 of 3 terms → no expansion
  assert(multiTermExpanded.length === 2,
    `expandAdjacentChunks: single-term match with multi-term query does not expand (got ${multiTermExpanded.length})`);

  // With 2+ query terms, chunk matching 2+ terms SHOULD expand
  chunkMap.set('ep_d_5', makeChunk('ep_d_5', 'Digital court jew discussion here'));
  chunkMap.set('ep_d_4', makeChunk('ep_d_4', 'Previous context for court jew'));
  chunkMap.set('ep_d_6', makeChunk('ep_d_6', 'Next context for court jew'));
  const multiMatchInput: RetrievalResult[] = [
    { chunk: chunkMap.get('ep_d_5')!, score: 1.0, source: 'both' }, // has "digital" + "court" + "jew"
  ];
  const multiMatchExpanded = expandAdjacentChunks(multiMatchInput, ['digital', 'court', 'jew'], chunkMap);
  assert(multiMatchExpanded.length === 3,
    `expandAdjacentChunks: multi-term match expands neighbors (got ${multiMatchExpanded.length})`);

  // --- suppressBestOfRebroadcasts tests ---
  const originalEp = makeResult('orig_ep_1', 'Great discussion about the movie', 1.0, 'Tron: Legacy (2010)');
  const bestOfEp = makeResult('bestof_1', 'Great discussion about the movie', 0.9, 'Best of Escape Hatch: Tron: Legacy (2010)');
  const regularEp = makeResult('reg_1', 'Another movie discussion', 0.8, 'The Matrix');

  const bestOfSuppressed = suppressBestOfRebroadcasts([originalEp, bestOfEp, regularEp]);
  const bestOfResult = bestOfSuppressed.find(r => r.chunk.id === 'bestof_1')!;
  const origResult = bestOfSuppressed.find(r => r.chunk.id === 'orig_ep_1')!;
  const regResult = bestOfSuppressed.find(r => r.chunk.id === 'reg_1')!;

  assert(Math.abs(bestOfResult.score - 0.36) < 0.001,
    `suppressBestOfRebroadcasts: Best-of gets 0.4x penalty (got ${bestOfResult.score})`);
  assert(origResult.score === 1.0,
    'suppressBestOfRebroadcasts: original episode unchanged');
  assert(regResult.score === 0.8,
    'suppressBestOfRebroadcasts: regular episode unchanged');

  // --- rerankChunks tests (no real API calls) ---

  // Skip behavior: ≤5 results returns unchanged (no API call)
  const fewResults = [
    makeResult('r_1', 'chunk one', 1.0, 'Ep A'),
    makeResult('r_2', 'chunk two', 0.9, 'Ep B'),
    makeResult('r_3', 'chunk three', 0.8, 'Ep C'),
  ];
  const skipReranked = await rerankChunks('test query', fewResults);
  assert(skipReranked.length === 3, `rerankChunks skip: returns 3 results (got ${skipReranked.length})`);
  assert(skipReranked[0].chunk.id === 'r_1', 'rerankChunks skip: preserves order');
  assert(skipReranked[0].score === 1.0, 'rerankChunks skip: preserves scores');

  // Skip behavior: exactly 5 results also skips
  const fiveResults = [
    makeResult('r_1', 'chunk one', 1.0, 'Ep A'),
    makeResult('r_2', 'chunk two', 0.9, 'Ep B'),
    makeResult('r_3', 'chunk three', 0.8, 'Ep C'),
    makeResult('r_4', 'chunk four', 0.7, 'Ep D'),
    makeResult('r_5', 'chunk five', 0.6, 'Ep E'),
  ];
  const fiveReranked = await rerankChunks('test query', fiveResults);
  assert(fiveReranked.length === 5, `rerankChunks skip@5: returns 5 results (got ${fiveReranked.length})`);
  assert(fiveReranked[0].score === 1.0, 'rerankChunks skip@5: preserves scores');

  // Skip behavior: empty input returns empty
  const emptyReranked = await rerankChunks('test query', []);
  assert(emptyReranked.length === 0, `rerankChunks skip empty: returns 0 results (got ${emptyReranked.length})`);

  return { passed, failed, errors };
}

function getDistinctEpisodes(results: RetrievalResult[]): Set<string> {
  return new Set(results.map((r) => r.chunk.metadata.episodeTitle));
}

async function runCase(testCase: RetrievalCase): Promise<string[]> {
  const errors: string[] = [];

  const results = await hybridRetrieval(
    testCase.query,
    testCase.classification,
    testCase.kOverrides
  );

  if (testCase.expectMinResults !== undefined) {
    if (results.length < testCase.expectMinResults) {
      errors.push(
        `Expected at least ${testCase.expectMinResults} results, got ${results.length}`
      );
    }
  }

  if (testCase.expectEpisodeInResults) {
    const episodeTitles = results.map((r) => r.chunk.metadata.episodeTitle);
    for (const expected of testCase.expectEpisodeInResults) {
      const found = episodeTitles.some((t) =>
        t.toLowerCase().includes(expected.toLowerCase())
      );
      if (!found) {
        errors.push(
          `Expected episode matching "${expected}" in results, got: [${[...new Set(episodeTitles)].join(', ')}]`
        );
      }
    }
  }

  if (testCase.expectMinDistinctEpisodes !== undefined) {
    const distinct = getDistinctEpisodes(results);
    if (distinct.size < testCase.expectMinDistinctEpisodes) {
      errors.push(
        `Expected at least ${testCase.expectMinDistinctEpisodes} distinct episodes, got ${distinct.size}: [${[...distinct].join(', ')}]`
      );
    }
  }

  if (testCase.expectTextIncludes) {
    const allText = results.map((r) => r.chunk.text.toLowerCase()).join(' ');
    for (const fragment of testCase.expectTextIncludes) {
      if (!allText.includes(fragment.toLowerCase())) {
        errors.push(`Expected text containing "${fragment}" in results`);
      }
    }
  }

  return errors;
}

async function main() {
  // --- Unit tests (no data loading required) ---
  console.log('=== Retrieval Unit Tests ===\n');
  const unit = await runUnitTests();
  if (unit.failed > 0) {
    console.log(`  FAIL  ${unit.failed} unit test(s) failed:`);
    for (const err of unit.errors) {
      console.log(`        - ${err}`);
    }
    process.exit(1);
  }
  console.log(`  PASS  All ${unit.passed} unit tests passed.\n`);

  // --- Integration tests (require data loading) ---
  console.log('=== Retrieval Regression Tests ===\n');
  console.log(`Running ${cases.length} test cases...\n`);

  const failures: Array<{ name: string; errors: string[] }> = [];
  let passed = 0;

  for (const testCase of cases) {
    try {
      const errors = await runCase(testCase);
      if (errors.length > 0) {
        failures.push({ name: testCase.name, errors });
        console.log(`  FAIL  ${testCase.name}`);
        for (const err of errors) {
          console.log(`        ${err}`);
        }
      } else {
        passed++;
        console.log(`  PASS  ${testCase.name}`);
      }
    } catch (err) {
      failures.push({
        name: testCase.name,
        errors: [`Exception: ${err instanceof Error ? err.message : String(err)}`],
      });
      console.log(`  ERROR ${testCase.name}: ${err instanceof Error ? err.message : err}`);
    }
  }

  console.log(`\n--- Results: ${passed}/${cases.length} passed ---`);

  if (failures.length > 0) {
    console.log(`\n${failures.length} failure(s):`);
    for (const { name, errors } of failures) {
      console.log(`\n  ${name}:`);
      for (const err of errors) {
        console.log(`    - ${err}`);
      }
    }
    process.exit(1);
  }

  console.log('\nAll retrieval regression tests passed.');
}

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
