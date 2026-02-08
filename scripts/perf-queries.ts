type PerfCase = {
  name: string;
  query: string;
};

const cases: PerfCase[] = [
  { name: 'Latest episode', query: 'what was the last episode' },
  { name: 'Current season', query: 'what season is the pod on now with their episodes' },
  { name: 'Interpretive (Rosie)', query: 'What does Rosie do for a living?' },
  { name: 'Field max', query: 'what is the episode with the greatest number of instances of Jason saying "That’s Great"' },
  { name: 'Decade count', query: 'how many films has the pod reviewed from the decade 1980-1990?' },
];

const baseUrl = process.env.PERF_BASE_URL || 'http://localhost:3000';
const endpoint = `${baseUrl}/api/search`;

function nowMs(): number {
  return Date.now();
}

async function runCase(testCase: PerfCase) {
  const start = nowMs();
  const response = await fetch(endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ query: testCase.query }),
  });
  const elapsed = nowMs() - start;

  if (!response.ok) {
    const error = await response.text();
    return { ...testCase, elapsedMs: elapsed, ok: false, error };
  }

  return { ...testCase, elapsedMs: elapsed, ok: true };
}

async function main() {
  const results = [];
  for (const testCase of cases) {
    // eslint-disable-next-line no-await-in-loop
    const result = await runCase(testCase);
    results.push(result);
    const status = result.ok ? '✓' : '✗';
    console.log(`${status} ${testCase.name}: ${result.elapsedMs}ms`);
  }

  const okResults = results.filter((r) => r.ok);
  const avg = okResults.reduce((sum, r) => sum + r.elapsedMs, 0) / (okResults.length || 1);
  console.log(`\nAverage latency: ${Math.round(avg)}ms`);

  if (results.some((r) => !r.ok)) {
    process.exit(1);
  }
}

main().catch((error) => {
  console.error('Perf run failed:', error);
  process.exit(1);
});
