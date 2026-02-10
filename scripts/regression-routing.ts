import { shouldForceTranscriptSearch } from '../src/lib/search-routing';
import { ClassificationResult } from '../src/types/episode-metadata';

type RoutingCase = {
  name: string;
  query: string;
  classification: ClassificationResult;
  expectForce: boolean;
};

const FACTUAL: ClassificationResult = {
  type: 'factual',
  confidence: 0.9,
  filters: {},
};

const FACTUAL_WITH_FILTER: ClassificationResult = {
  type: 'factual',
  confidence: 0.9,
  filters: { film: 'Alien' },
};

const FACTUAL_WITH_CINEMATOGRAPHER: ClassificationResult = {
  type: 'factual',
  confidence: 0.9,
  filters: { cinematographer: 'Roger Deakins' },
};

const INTERPRETIVE: ClassificationResult = {
  type: 'interpretive',
  confidence: 0.9,
  filters: {},
};

const cases: RoutingCase[] = [
  {
    name: 'Force transcript for mentions',
    query: 'Deakins Award',
    classification: FACTUAL,
    expectForce: true,
  },
  {
    name: 'Force transcript even with filters if transcript cue present',
    query: 'Deakins Award',
    classification: FACTUAL_WITH_CINEMATOGRAPHER,
    expectForce: true,
  },
  {
    name: 'Metadata cue overrides transcript cue',
    query: 'Deakins Award episodes',
    classification: FACTUAL,
    expectForce: false,
  },
  {
    name: 'Do not force transcript for metadata question',
    query: 'latest episode',
    classification: FACTUAL,
    expectForce: false,
  },
  {
    name: 'Do not force transcript when filters present',
    query: 'Alien',
    classification: FACTUAL_WITH_FILTER,
    expectForce: false,
  },
  {
    name: 'Do not force transcript for interpretive',
    query: 'what did they think about Alien',
    classification: INTERPRETIVE,
    expectForce: false,
  },
];

const failures: string[] = [];

for (const testCase of cases) {
  const result = shouldForceTranscriptSearch(testCase.query, testCase.classification);
  if (result !== testCase.expectForce) {
    failures.push(`${testCase.name}: expected ${testCase.expectForce} but got ${result}`);
  } else {
    console.log(`✓ ${testCase.name}`);
  }
}

if (failures.length > 0) {
  console.error('\nRouting regression failures:');
  for (const failure of failures) {
    console.error(`- ${failure}`);
  }
  process.exit(1);
}

console.log('\nAll routing regression checks passed.');
