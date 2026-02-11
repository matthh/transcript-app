import { detectQueryIntent, QueryIntentType } from '../src/lib/query-intent';
import { buildMetadataAggregateResponse, collectTildaContext } from '../src/lib/metadata-aggregates';

type RegressionCase = {
  name: string;
  query: string;
  expectIntent: QueryIntentType;
  expectAnswerIncludes?: string[];
  expectTildaContext?: boolean;
};

const cases: RegressionCase[] = [
  {
    name: 'Current season',
    query: 'what season is the pod on now with their episodes',
    expectIntent: 'metadata_current_season',
    expectAnswerIncludes: ['season'],
  },
  {
    name: 'Discord join (transcript)',
    query: 'when did zolidus join the discord',
    expectIntent: 'transcript_only',
  },
  {
    name: 'Latest episode',
    query: 'what was the last episode',
    expectIntent: 'metadata_latest',
    expectAnswerIncludes: ['latest episode'],
  },
  {
    name: 'MMM count latest',
    query: "how many mmm’s in the last episode",
    expectIntent: 'metadata_field_latest',
    expectAnswerIncludes: ['MMM count'],
  },
  {
    name: 'That’s great max',
    query: 'what is the episode in which there is the greatest number of instances of Jason saying "That’s Great"',
    expectIntent: 'metadata_field_max',
    expectAnswerIncludes: ["That\'s Great"],
  },
  {
    name: 'Total episodes',
    query: 'how many episodes are there in total of this podcast',
    expectIntent: 'metadata_total_episodes',
    expectAnswerIncludes: ['episodes'],
  },
  {
    name: 'Rosie job (transcript)',
    query: 'What does Rosie do for a living?',
    expectIntent: 'transcript_only',
  },
  {
    name: 'Year range count',
    query: 'how many films has the pod reviewed from the decade 1980-1990?',
    expectIntent: 'metadata_year_range_count',
    expectAnswerIncludes: ['1980', '1990'],
  },
  {
    name: 'Year range list one per year (no aggregate)',
    query: 'list one movie from each year 1980-1990 that the pod has covered and give year with each',
    expectIntent: 'metadata_year_range_sample',
    expectAnswerIncludes: ['movies covered by year', '1980', '1990'],
  },
  {
    name: 'Tilda metadata aggregate',
    query: 'who would tilda play',
    expectIntent: 'metadata_tilda',
    expectTildaContext: true,
  },
  {
    name: 'Tilda casting analysis',
    query: 'are the hosts of Escape Hatch more likely to cast Tilda as a woman, a man, or an unanimate object',
    expectIntent: 'metadata_tilda',
    expectTildaContext: true,
  },
];

function runCase(testCase: RegressionCase): string | null {
  const intent = detectQueryIntent(testCase.query);
  if (intent.type !== testCase.expectIntent) {
    return `Expected intent ${testCase.expectIntent} but got ${intent.type}`;
  }

  // Tilda intent is handled by LLM synthesis in routes, not buildMetadataAggregateResponse
  if (testCase.expectTildaContext) {
    const tildaCtx = collectTildaContext();
    if (!tildaCtx) {
      return 'Expected Tilda context but collectTildaContext returned null';
    }
    if (tildaCtx.totalPicks === 0) {
      return 'Expected Tilda picks but got 0';
    }
  } else if (intent.type.startsWith('metadata_')) {
    const aggregate = buildMetadataAggregateResponse(intent);
    if (!aggregate) {
      return 'Expected metadata aggregate response but got null';
    }
    if (testCase.expectAnswerIncludes) {
      const answerLower = aggregate.answer.toLowerCase();
      for (const fragment of testCase.expectAnswerIncludes) {
        if (!answerLower.includes(fragment.toLowerCase())) {
          return `Answer missing "${fragment}"`;
        }
      }
    }
  }

  return null;
}

const failures: string[] = [];

for (const testCase of cases) {
  const error = runCase(testCase);
  if (error) {
    failures.push(`${testCase.name}: ${error}`);
  } else {
    console.log(`✓ ${testCase.name}`);
  }
}

if (failures.length > 0) {
  console.error('\nRegression failures:');
  for (const failure of failures) {
    console.error(`- ${failure}`);
  }
  process.exit(1);
}

console.log('\nAll regression checks passed.');
