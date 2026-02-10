/**
 * LLM classifier regression tests.
 *
 * Tests that classifyQuery() routes queries to the correct type.
 * Requires ANTHROPIC_API_KEY in .env.local (calls Haiku).
 *
 * Usage:
 *   npx tsx scripts/regression-classifier.ts
 */

import * as dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

import { classifyQuery } from '../src/lib/query-classifier';
import type { QueryType } from '../src/types/episode-metadata';

interface ClassifierCase {
  name: string;
  query: string;
  /** Query type(s) that are acceptable */
  expectTypeIn: QueryType[];
  /** Query type(s) that must NOT be returned */
  rejectType?: QueryType[];
}

const cases: ClassifierCase[] = [
  // --- Should be factual ---
  {
    name: 'Episode count is factual',
    query: 'how many episodes are there',
    expectTypeIn: ['factual'],
  },
  {
    name: 'Guest lookup is factual',
    query: 'which episodes had Proto as a guest',
    expectTypeIn: ['factual'],
  },
  {
    name: 'Director filter is factual',
    query: 'Tim Burton movies on the podcast',
    expectTypeIn: ['factual'],
  },

  // --- Should be interpretive ---
  {
    name: 'Opinion query is interpretive',
    query: 'what did the hosts think about the ending of Inception',
    expectTypeIn: ['interpretive'],
  },
  {
    name: 'Discussion query is interpretive',
    query: 'how did Jason react to the twist in The Prestige',
    expectTypeIn: ['interpretive'],
  },

  // --- Should NOT be factual (transcript content queries) ---
  {
    name: 'Specific word lookup needs transcripts',
    query: 'in which episode is the word dingus used in a voicemail',
    expectTypeIn: ['interpretive', 'hybrid'],
    rejectType: ['factual'],
  },
  {
    name: 'Quote search needs transcripts',
    query: 'which episode has someone saying lead paint chips were delicious',
    expectTypeIn: ['interpretive', 'hybrid'],
    rejectType: ['factual'],
  },
  {
    name: 'Voicemail content needs transcripts',
    query: 'what episode does Paul Atreides Nutz do his Desus and Mero bit',
    expectTypeIn: ['interpretive', 'hybrid'],
    rejectType: ['factual'],
  },
  {
    name: 'Specific phrase lookup needs transcripts',
    query: 'when did a caller say AKA a bunch of times',
    expectTypeIn: ['interpretive', 'hybrid'],
    rejectType: ['factual'],
  },

  // --- Hybrid ---
  {
    name: 'Decade + opinion is hybrid',
    query: 'which 80s movies did they enjoy the most',
    expectTypeIn: ['hybrid', 'interpretive'],
  },
];

async function main() {
  console.log('=== Classifier Regression Tests ===\n');
  console.log(`Running ${cases.length} test cases...\n`);

  let passed = 0;
  const failures: Array<{ name: string; error: string }> = [];

  for (const testCase of cases) {
    try {
      const result = await classifyQuery(testCase.query);
      const typeOk = testCase.expectTypeIn.includes(result.type);
      const rejectOk = !testCase.rejectType || !testCase.rejectType.includes(result.type);

      if (typeOk && rejectOk) {
        passed++;
        console.log(`  PASS  ${testCase.name} → ${result.type} (${result.confidence})`);
      } else {
        const reason = !typeOk
          ? `Expected ${testCase.expectTypeIn.join('|')}, got ${result.type}`
          : `Got rejected type ${result.type}`;
        failures.push({ name: testCase.name, error: reason });
        console.log(`  FAIL  ${testCase.name} → ${result.type} (${result.confidence})`);
        console.log(`        ${reason}`);
      }
    } catch (err) {
      failures.push({
        name: testCase.name,
        error: `Exception: ${err instanceof Error ? err.message : String(err)}`,
      });
      console.log(`  ERROR ${testCase.name}: ${err instanceof Error ? err.message : err}`);
    }
  }

  console.log(`\n--- Results: ${passed}/${cases.length} passed ---`);

  if (failures.length > 0) {
    console.log(`\n${failures.length} failure(s):`);
    for (const { name, error } of failures) {
      console.log(`\n  ${name}:`);
      console.log(`    - ${error}`);
    }
    process.exit(1);
  }

  console.log('\nAll classifier regression tests passed.');
}

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
