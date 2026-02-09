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
const warmupUrl = process.env.PERF_WARMUP_URL || `${baseUrl}/api/warmup`;
const warmupToken = process.env.PERF_WARMUP_TOKEN;
const discardCount = Math.max(0, Number.parseInt(process.env.PERF_DISCARD || '1', 10) || 1);
const rawRuns = Number.parseInt(process.env.PERF_RUNS || '4', 10) || 4;
const runCount = Math.max(discardCount + 1, rawRuns);

function nowMs(): number {
  return Date.now();
}

function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 0) {
    return Math.round((sorted[mid - 1] + sorted[mid]) / 2);
  }
  return sorted[mid];
}

function p95(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const idx = Math.min(sorted.length - 1, Math.ceil(0.95 * sorted.length) - 1);
  return sorted[idx];
}

async function runCase(testCase: PerfCase) {
  const body = Buffer.from(JSON.stringify({ query: testCase.query }), 'utf-8');
  const start = nowMs();
  const response = await fetch(endpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Content-Length': body.length.toString(),
      Accept: 'application/json',
    },
    body,
  });
  const elapsed = nowMs() - start;

  if (!response.ok) {
    const errorText = await response.text();
    return {
      ...testCase,
      elapsedMs: elapsed,
      ok: false,
      status: response.status,
      error: errorText.slice(0, 300),
    };
  }

  return { ...testCase, elapsedMs: elapsed, ok: true, status: response.status };
}

async function warmup(): Promise<void> {
  if (!warmupUrl) return;
  const url = warmupToken ? `${warmupUrl}?token=${encodeURIComponent(warmupToken)}` : warmupUrl;
  try {
    const response = await fetch(url, { method: 'GET' });
    if (!response.ok) {
      const errorText = await response.text();
      console.warn(`Warmup failed (${response.status}): ${errorText.slice(0, 120)}`);
    }
  } catch (error) {
    console.warn(`Warmup request failed: ${String(error)}`);
  }
}

async function main() {
  console.log(`Perf base URL: ${baseUrl}`);
  console.log(`Runs per case: ${runCount} (discarding first ${discardCount})`);
  await warmup();
  const results = [];
  for (const testCase of cases) {
    const runResults = [];
    for (let i = 0; i < runCount; i += 1) {
      // eslint-disable-next-line no-await-in-loop
      const result = await runCase(testCase);
      runResults.push(result);
    }

    const measuredRuns = runResults.slice(discardCount);
    results.push(...measuredRuns);
    const okRuns = measuredRuns.filter((r) => r.ok);
    const latencies = okRuns.map((r) => r.elapsedMs);
    const status = okRuns.length === measuredRuns.length ? '✓' : '✗';
    const statusSuffix = okRuns.length === measuredRuns.length
      ? ''
      : ` (${measuredRuns.length - okRuns.length} failed)`;
    console.log(
      `${status} ${testCase.name}: median ${median(latencies)}ms, p95 ${p95(latencies)}ms${statusSuffix}`
    );
    if (okRuns.length !== measuredRuns.length) {
      const errors = measuredRuns.filter((r) => !r.ok);
      for (const error of errors) {
        console.log(`  Error: status ${error.status} ${error.error}`);
      }
    }
  }

  const okResults = results.filter((r) => r.ok);
  const avg = okResults.reduce((sum, r) => sum + r.elapsedMs, 0) / (okResults.length || 1);
  console.log(`\nAverage latency (all runs): ${Math.round(avg)}ms`);

  if (results.some((r) => !r.ok)) {
    process.exit(1);
  }
}

main().catch((error) => {
  console.error('Perf run failed:', error);
  process.exit(1);
});
