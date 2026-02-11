type Expectation = {
  mustInclude?: string[];
  requiresMetadata?: boolean;
  requiresTranscript?: boolean;
  expectedQueryType?: string;
  disallowMetadataPath?: boolean;
};

type ABCase = {
  name: string;
  query: string;
  expect: Expectation;
};

type RunResult = {
  ok: boolean;
  status?: number;
  error?: string;
  answer?: string;
  queryType?: string;
  metadataCount?: number;
  metadataTotal?: number;
  transcriptCount?: number;
  path?: string;
  latencyMs?: number;
};

const cases: ABCase[] = [
  {
    name: 'Guest by film',
    query: 'Who was the guest on No Country for Old Men?',
    expect: { mustInclude: ['Ian de Borja'], requiresMetadata: true },
  },
  {
    name: 'Reviewer by film',
    query: 'Who reviewed No Country for Old Men?',
    expect: { mustInclude: ['Nexus9'], requiresMetadata: true },
  },
  {
    name: 'Guest + reviewer by film',
    query: 'Who was the guest and reviewer for No Country for Old Men?',
    expect: { mustInclude: ['Ian de Borja', 'Nexus9'], requiresMetadata: true },
  },
  {
    name: 'Release date by film',
    query: 'When did the No Country for Old Men episode release?',
    expect: { mustInclude: ['7/6/2020'], requiresMetadata: true },
  },
  {
    name: 'Kev question by film',
    query: "What was Kev's question for Dune (1965) Part 1?",
    expect: { mustInclude: ['Kev recorded 2 questions'], requiresMetadata: true },
  },
  {
    name: 'Reviewer by episode',
    query: 'Who reviewed episode 6?',
    expect: { mustInclude: ['Nexus9'], requiresMetadata: true },
  },
  {
    name: 'Release date by episode',
    query: 'When did episode 6 release?',
    expect: { mustInclude: ['7/6/2020'], requiresMetadata: true },
  },
  {
    name: 'Kev question by episode',
    query: "What was Kev's question for episode 1?",
    expect: { mustInclude: ['Kev recorded 2 questions'], requiresMetadata: true },
  },
  {
    name: 'Interpretive opinion (should bypass metadata intent)',
    query: 'What did the hosts think about No Country for Old Men?',
    expect: { disallowMetadataPath: true, expectedQueryType: 'interpretive' },
  },
  {
    name: 'Interpretive quote lookup (should bypass metadata intent)',
    query: 'Which episode uses the word dingus?',
    expect: { disallowMetadataPath: true, expectedQueryType: 'interpretive', requiresTranscript: true },
  },
  {
    name: 'Interpretive discussion (should bypass metadata intent)',
    query: 'What did they say about Denis Villeneuve?',
    expect: { disallowMetadataPath: true, expectedQueryType: 'interpretive' },
  },
];

const baseA = process.env.AB_BASE_URL || 'http://localhost:3000';
const baseB = process.env.AB_COMPARE_URL;

if (!baseB) {
  console.error('AB_COMPARE_URL is required (e.g., http://localhost:3001).');
  process.exit(1);
}

const endpoint = '/api/search';

async function runCase(baseUrl: string, testCase: ABCase): Promise<RunResult> {
  const body = Buffer.from(JSON.stringify({ query: testCase.query }), 'utf-8');
  const start = Date.now();
  const response = await fetch(`${baseUrl}${endpoint}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Content-Length': body.length.toString(),
      Accept: 'application/json',
    },
    body,
  });
  const latencyMs = Date.now() - start;

  if (!response.ok) {
    const errorText = await response.text();
    return { ok: false, status: response.status, error: errorText.slice(0, 200), latencyMs };
  }

  const data = await response.json();
  const metadataCount = Array.isArray(data?.sources?.metadata) ? data.sources.metadata.length : 0;
  const metadataTotal = typeof data?.metadata?.totalCount === 'number' ? data.metadata.totalCount : metadataCount;
  const transcriptCount = Array.isArray(data?.sources?.transcripts) ? data.sources.transcripts.length : 0;
  return {
    ok: true,
    answer: data.answer as string,
    queryType: data.queryType as string,
    metadataCount,
    metadataTotal,
    transcriptCount,
    path: data?.perf?.path as string,
    latencyMs,
  };
}

function assess(result: RunResult, expect: Expectation): string[] {
  const failures: string[] = [];
  if (!result.ok) {
    failures.push(`HTTP ${result.status}`);
    return failures;
  }

  const answer = (result.answer || '').toLowerCase();
  if (expect.mustInclude) {
    for (const fragment of expect.mustInclude) {
      if (!answer.includes(fragment.toLowerCase())) {
        failures.push(`missing "${fragment}"`);
      }
    }
  }
  if (expect.requiresMetadata && (result.metadataCount || 0) === 0) {
    failures.push('no metadata sources');
  }
  if (expect.requiresTranscript && (result.transcriptCount || 0) === 0) {
    failures.push('no transcript sources');
  }
  if (expect.expectedQueryType && result.queryType !== expect.expectedQueryType) {
    failures.push(`queryType=${result.queryType ?? 'unknown'} (expected ${expect.expectedQueryType})`);
  }
  if (expect.disallowMetadataPath && result.path && result.path.startsWith('metadata')) {
    failures.push(`path=${result.path}`);
  }
  return failures;
}

function summarize(label: string, result: RunResult, failures: string[]) {
  if (!result.ok) {
    console.log(`- ${label}: ERROR ${result.status} (${result.latencyMs}ms) ${result.error}`);
    return;
  }
  const suffix = failures.length > 0 ? ` FAIL [${failures.join(', ')}]` : ' PASS';
  console.log(
    `- ${label}: ${result.latencyMs}ms | path=${result.path} | type=${result.queryType} | metadata=${result.metadataCount}/${result.metadataTotal} | transcripts=${result.transcriptCount ?? 0}${suffix}`
  );
}

async function main() {
  console.log(`A: ${baseA}`);
  console.log(`B: ${baseB}`);
  for (const testCase of cases) {
    console.log(`\n## ${testCase.name}`);
    console.log(`Query: ${testCase.query}`);
    const [resultA, resultB] = await Promise.all([
      runCase(baseA, testCase),
      runCase(baseB, testCase),
    ]);
    const failuresA = assess(resultA, testCase.expect);
    const failuresB = assess(resultB, testCase.expect);
    summarize('A', resultA, failuresA);
    summarize('B', resultB, failuresB);
    if (resultA.ok && resultB.ok) {
      console.log('---');
      console.log(`A answer: ${(resultA.answer || '').trim()}`);
      console.log('---');
      console.log(`B answer: ${(resultB.answer || '').trim()}`);
      console.log('---');
    }
  }
}

main().catch((error) => {
  console.error('AB run failed:', error);
  process.exit(1);
});
