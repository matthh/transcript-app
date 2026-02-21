import {
  shouldSkipMetadataAggregate,
  shouldForceHybridClassification,
  shouldUseQuickSynthesis,
} from '../src/lib/routing-policy';
import { QueryIntent } from '../src/lib/query-intent';
import { ClassificationResult } from '../src/types/episode-metadata';

type TestCase = {
  name: string;
  fn: () => boolean;
};

function makeIntent(confidence: 'high' | 'medium' | 'low'): QueryIntent {
  return { type: 'metadata_latest', confidence };
}

function makeClassification(overrides: Partial<ClassificationResult> = {}): ClassificationResult {
  return {
    type: 'factual',
    confidence: 0.9,
    filters: {},
    requiresTranscriptDepth: false,
    ...overrides,
  };
}

const cases: TestCase[] = [
  // shouldSkipMetadataAggregate
  {
    name: 'shouldSkipMetadataAggregate: medium confidence → true',
    fn: () => shouldSkipMetadataAggregate(makeIntent('medium')) === true,
  },
  {
    name: 'shouldSkipMetadataAggregate: high confidence → false',
    fn: () => shouldSkipMetadataAggregate(makeIntent('high')) === false,
  },
  {
    name: 'shouldSkipMetadataAggregate: low confidence → false',
    fn: () => shouldSkipMetadataAggregate(makeIntent('low')) === false,
  },

  // shouldForceHybridClassification
  {
    name: 'shouldForceHybridClassification: low confidence + no filters → true',
    fn: () => shouldForceHybridClassification(makeClassification({ confidence: 0.4, filters: {} })) === true,
  },
  {
    name: 'shouldForceHybridClassification: low confidence + has filters → false',
    fn: () => shouldForceHybridClassification(makeClassification({ confidence: 0.4, filters: { film: 'Jaws' } })) === false,
  },
  {
    name: 'shouldForceHybridClassification: high confidence + no filters → false',
    fn: () => shouldForceHybridClassification(makeClassification({ confidence: 0.9, filters: {} })) === false,
  },

  // shouldUseQuickSynthesis
  {
    name: 'shouldUseQuickSynthesis: quick + factual + no transcript depth → true',
    fn: () => shouldUseQuickSynthesis('quick', makeClassification({
      type: 'factual',
      requiresTranscriptDepth: false,
    })) === true,
  },
  {
    name: 'shouldUseQuickSynthesis: quick + factual + requires transcript depth → false',
    fn: () => shouldUseQuickSynthesis('quick', makeClassification({
      type: 'factual',
      requiresTranscriptDepth: true,
    })) === false,
  },
  {
    name: 'shouldUseQuickSynthesis: quick + interpretive → false',
    fn: () => shouldUseQuickSynthesis('quick', makeClassification({
      type: 'interpretive',
      requiresTranscriptDepth: false,
    })) === false,
  },
  {
    name: 'shouldUseQuickSynthesis: deep + factual → false',
    fn: () => shouldUseQuickSynthesis('deep', makeClassification({
      type: 'factual',
      requiresTranscriptDepth: false,
    })) === false,
  },
];

const failures: string[] = [];

for (const testCase of cases) {
  try {
    const passed = testCase.fn();
    if (passed) {
      console.log(`✓ ${testCase.name}`);
    } else {
      failures.push(`${testCase.name}: returned unexpected value`);
    }
  } catch (err) {
    failures.push(`${testCase.name}: threw ${err}`);
  }
}

if (failures.length > 0) {
  console.error('\nRouting policy test failures:');
  for (const failure of failures) {
    console.error(`- ${failure}`);
  }
  process.exit(1);
}

console.log(`\nAll ${cases.length} routing policy tests passed.`);
