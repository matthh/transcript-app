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

import { hybridRetrieval, RetrievalResult } from '../src/lib/hybrid-retrieval';
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

  // --- Edge cases ---
  {
    name: 'Exact quote retrieval',
    query: 'lead paint chips were delicious',
    classification: INTERPRETIVE,
    expectMinResults: 1,
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
