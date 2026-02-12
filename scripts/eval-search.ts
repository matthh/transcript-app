/**
 * End-to-end search eval harness.
 *
 * Runs queries through the full search pipeline via HTTP (SSE stream endpoint)
 * and scores results against assertions defined in the eval dataset.
 *
 * Usage:
 *   npx tsx scripts/eval-search.ts                           # default: localhost:3000
 *   npx tsx scripts/eval-search.ts --url http://localhost:3000
 *   npx tsx scripts/eval-search.ts --url https://search.escapehatchpod.com
 *   npx tsx scripts/eval-search.ts --tag voicemail            # run only cases with this tag
 *   npx tsx scripts/eval-search.ts --name "dingus"            # run only cases matching name
 *   npx tsx scripts/eval-search.ts --verbose                  # show full answer + sources on failure
 *   npx tsx scripts/eval-search.ts --baseline http://a --candidate http://b  # A/B compare
 *   npx tsx scripts/eval-search.ts --compare before.json after.json          # offline compare
 */

import * as fs from 'fs';
import * as path from 'path';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface EvalCase {
  name: string;
  query: string;
  tags?: string[];
  // Assertions (all optional — use what applies)
  expectEpisodeInAnswer?: string;
  expectTextInAnswer?: string[];
  rejectTextInAnswer?: string[];
  expectSourceEpisode?: string;
  expectClassificationType?: string[];
  expectMinSources?: number;
  expectMinTranscriptSources?: number;
  expectMinMetadataSources?: number;
  expectConfidenceAbove?: number;
}

interface EvalDataset {
  cases: EvalCase[];
}

interface SSEResult {
  answer: string;
  queryType: string;
  classificationConfidence?: number;
  sources: {
    transcripts?: Array<{ episodeTitle: string; text: string; score: number }>;
    metadata?: Array<{ film: string; episode: number; season: number }>;
  };
  perf: { totalMs: number; path: string };
  error?: string;
}

interface CaseResult {
  name: string;
  query: string;
  pass: boolean;
  failures: string[];
  latencyMs: number;
  answer?: string;
  queryType?: string;
  sourceCount?: number;
}

// ---------------------------------------------------------------------------
// SSE client — calls /api/search/stream and parses events
// ---------------------------------------------------------------------------

async function runQuery(baseUrl: string, query: string): Promise<SSEResult> {
  const url = `${baseUrl.replace(/\/$/, '')}/api/search/stream`;

  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ query }),
  });

  if (!response.ok) {
    const text = await response.text();
    return {
      answer: '',
      queryType: 'error',
      sources: {},
      perf: { totalMs: 0, path: 'error' },
      error: `HTTP ${response.status}: ${text.slice(0, 200)}`,
    };
  }

  // Parse SSE events from the response body
  const body = await response.text();
  const lines = body.split('\n');

  let answer = '';
  let queryType = '';
  let classificationConfidence: number | undefined;
  let sources: SSEResult['sources'] = {};
  let perf: SSEResult['perf'] = { totalMs: 0, path: '' };
  let errorMsg: string | undefined;

  let currentEvent = '';
  for (const line of lines) {
    if (line.startsWith('event: ')) {
      currentEvent = line.slice(7).trim();
    } else if (line.startsWith('data: ')) {
      const dataStr = line.slice(6);
      try {
        const data = JSON.parse(dataStr);
        if (currentEvent === 'complete') {
          answer = data.answer || '';
          queryType = data.queryType || '';
          classificationConfidence = data.classificationConfidence;
          sources = data.sources || {};
          perf = data.perf || perf;
        } else if (currentEvent === 'chunk') {
          // Accumulate streaming chunks (backup if complete doesn't include full answer)
          if (!answer) answer += data.text || '';
        } else if (currentEvent === 'error') {
          errorMsg = data.message || 'Unknown error';
        }
      } catch {
        // Ignore malformed JSON lines
      }
    }
  }

  return { answer, queryType, classificationConfidence, sources, perf, error: errorMsg };
}

// ---------------------------------------------------------------------------
// Assertion checker
// ---------------------------------------------------------------------------

function checkCase(testCase: EvalCase, result: SSEResult): string[] {
  const failures: string[] = [];

  if (result.error) {
    failures.push(`API error: ${result.error}`);
    return failures;
  }

  const answerLower = result.answer.toLowerCase();

  // expectEpisodeInAnswer — answer text mentions this episode
  if (testCase.expectEpisodeInAnswer) {
    if (!answerLower.includes(testCase.expectEpisodeInAnswer.toLowerCase())) {
      failures.push(
        `Expected answer to mention episode "${testCase.expectEpisodeInAnswer}"`
      );
    }
  }

  // expectTextInAnswer — answer contains these strings
  if (testCase.expectTextInAnswer) {
    for (const text of testCase.expectTextInAnswer) {
      if (!answerLower.includes(text.toLowerCase())) {
        failures.push(`Expected answer to contain "${text}"`);
      }
    }
  }

  // rejectTextInAnswer — answer must NOT contain these
  if (testCase.rejectTextInAnswer) {
    for (const text of testCase.rejectTextInAnswer) {
      if (answerLower.includes(text.toLowerCase())) {
        failures.push(`Answer must NOT contain "${text}"`);
      }
    }
  }

  // expectSourceEpisode — retrieval returned chunks from this episode
  if (testCase.expectSourceEpisode) {
    const expected = testCase.expectSourceEpisode.toLowerCase();
    const transcriptEpisodes = (result.sources.transcripts || []).map((s) =>
      s.episodeTitle.toLowerCase()
    );
    const metadataEpisodes = (result.sources.metadata || []).map((s) =>
      s.film.toLowerCase()
    );
    const allEpisodes = [...transcriptEpisodes, ...metadataEpisodes];
    const found = allEpisodes.some((ep) => ep.includes(expected));
    if (!found) {
      failures.push(
        `Expected source from episode "${testCase.expectSourceEpisode}", got: [${[...new Set(allEpisodes)].join(', ')}]`
      );
    }
  }

  // expectClassificationType — not misclassified
  if (testCase.expectClassificationType) {
    if (!testCase.expectClassificationType.includes(result.queryType)) {
      failures.push(
        `Expected classification in [${testCase.expectClassificationType.join(', ')}], got "${result.queryType}"`
      );
    }
  }

  // expectMinSources — enough context retrieved (transcripts + metadata combined)
  if (testCase.expectMinSources !== undefined) {
    const totalSources =
      (result.sources.transcripts?.length || 0) +
      (result.sources.metadata?.length || 0);
    if (totalSources < testCase.expectMinSources) {
      failures.push(
        `Expected at least ${testCase.expectMinSources} sources, got ${totalSources}`
      );
    }
  }

  // expectMinTranscriptSources
  if (testCase.expectMinTranscriptSources !== undefined) {
    const count = result.sources.transcripts?.length || 0;
    if (count < testCase.expectMinTranscriptSources) {
      failures.push(
        `Expected at least ${testCase.expectMinTranscriptSources} transcript sources, got ${count}`
      );
    }
  }

  // expectMinMetadataSources
  if (testCase.expectMinMetadataSources !== undefined) {
    const count = result.sources.metadata?.length || 0;
    if (count < testCase.expectMinMetadataSources) {
      failures.push(
        `Expected at least ${testCase.expectMinMetadataSources} metadata sources, got ${count}`
      );
    }
  }

  // expectConfidenceAbove — classification confidence exceeds threshold
  if (testCase.expectConfidenceAbove !== undefined && result.classificationConfidence !== undefined) {
    if (result.classificationConfidence < testCase.expectConfidenceAbove) {
      failures.push(
        `Expected confidence above ${testCase.expectConfidenceAbove}, got ${result.classificationConfidence}`
      );
    }
  }

  return failures;
}

// ---------------------------------------------------------------------------
// Runner
// ---------------------------------------------------------------------------

async function runEval(
  baseUrl: string,
  dataset: EvalDataset,
  opts: { verbose: boolean; tag?: string; nameFilter?: string }
): Promise<CaseResult[]> {
  let cases = dataset.cases;

  // Filter by tag
  if (opts.tag) {
    cases = cases.filter((c) => c.tags?.includes(opts.tag!));
  }

  // Filter by name substring
  if (opts.nameFilter) {
    const filter = opts.nameFilter.toLowerCase();
    cases = cases.filter((c) => c.name.toLowerCase().includes(filter));
  }

  console.log(`\nRunning ${cases.length} eval cases against ${baseUrl}\n`);

  const results: CaseResult[] = [];

  for (const testCase of cases) {
    const start = Date.now();
    try {
      const result = await runQuery(baseUrl, testCase.query);
      const latencyMs = Date.now() - start;
      const failures = checkCase(testCase, result);
      const pass = failures.length === 0;

      const totalSources =
        (result.sources.transcripts?.length || 0) +
        (result.sources.metadata?.length || 0);

      const caseResult: CaseResult = {
        name: testCase.name,
        query: testCase.query,
        pass,
        failures,
        latencyMs,
        answer: result.answer,
        queryType: result.queryType,
        sourceCount: totalSources,
      };

      results.push(caseResult);

      const icon = pass ? 'PASS' : 'FAIL';
      const latencyStr = `${latencyMs}ms`.padStart(7);
      console.log(
        `  ${icon}  ${latencyStr}  ${testCase.name}` +
          (pass ? '' : ` (${result.queryType}, ${totalSources} sources)`)
      );

      if (!pass) {
        for (const f of failures) {
          console.log(`             ${f}`);
        }
        if (opts.verbose) {
          console.log(`             Answer: ${result.answer.slice(0, 300)}...`);
        }
      }
    } catch (err) {
      const latencyMs = Date.now() - start;
      const errMsg = err instanceof Error ? err.message : String(err);
      results.push({
        name: testCase.name,
        query: testCase.query,
        pass: false,
        failures: [`Exception: ${errMsg}`],
        latencyMs,
      });
      console.log(`  ERROR ${testCase.name}: ${errMsg}`);
    }
  }

  return results;
}

// ---------------------------------------------------------------------------
// Reporting
// ---------------------------------------------------------------------------

function printSummary(results: CaseResult[], label?: string) {
  const passed = results.filter((r) => r.pass).length;
  const failed = results.length - passed;
  const avgLatency = Math.round(
    results.reduce((sum, r) => sum + r.latencyMs, 0) / results.length
  );

  console.log(`\n--- ${label || 'Results'}: ${passed}/${results.length} passed ---`);
  console.log(`    Avg latency: ${avgLatency}ms`);

  if (failed > 0) {
    console.log(`\n${failed} failure(s):`);
    for (const r of results.filter((r) => !r.pass)) {
      console.log(`\n  ${r.name} (${r.query})`);
      for (const f of r.failures) {
        console.log(`    - ${f}`);
      }
    }
  }

  return { passed, failed, total: results.length, avgLatency };
}

// ---------------------------------------------------------------------------
// A/B comparison
// ---------------------------------------------------------------------------

async function runComparison(
  baselineUrl: string,
  candidateUrl: string,
  dataset: EvalDataset,
  opts: { verbose: boolean; tag?: string; nameFilter?: string }
) {
  console.log('=== A/B Comparison ===');
  console.log(`Baseline:  ${baselineUrl}`);
  console.log(`Candidate: ${candidateUrl}`);

  const baselineResults = await runEval(baselineUrl, dataset, opts);
  const candidateResults = await runEval(candidateUrl, dataset, opts);

  const baselineSummary = printSummary(baselineResults, 'Baseline');
  const candidateSummary = printSummary(candidateResults, 'Candidate');

  // Compare case-by-case
  console.log('\n--- Comparison ---');
  let improved = 0;
  let regressed = 0;
  let unchanged = 0;

  for (let i = 0; i < baselineResults.length; i++) {
    const b = baselineResults[i];
    const c = candidateResults[i];
    if (!b || !c) continue;

    if (b.pass && !c.pass) {
      regressed++;
      console.log(`  REGRESSED  ${b.name}`);
      for (const f of c.failures) {
        console.log(`             ${f}`);
      }
    } else if (!b.pass && c.pass) {
      improved++;
      console.log(`  IMPROVED   ${b.name}`);
    } else {
      unchanged++;
    }
  }

  console.log(
    `\nSummary: ${improved} improved, ${regressed} regressed, ${unchanged} unchanged`
  );
  console.log(
    `Baseline:  ${baselineSummary.passed}/${baselineSummary.total} (avg ${baselineSummary.avgLatency}ms)`
  );
  console.log(
    `Candidate: ${candidateSummary.passed}/${candidateSummary.total} (avg ${candidateSummary.avgLatency}ms)`
  );

  if (regressed > 0) process.exit(1);
}

// ---------------------------------------------------------------------------
// Offline comparison (from saved JSON result files)
// ---------------------------------------------------------------------------

function runOfflineComparison(beforeFile: string, afterFile: string) {
  console.log('=== Offline A/B Comparison ===');
  console.log(`Before: ${beforeFile}`);
  console.log(`After:  ${afterFile}`);

  const before: CaseResult[] = JSON.parse(fs.readFileSync(beforeFile, 'utf-8'));
  const after: CaseResult[] = JSON.parse(fs.readFileSync(afterFile, 'utf-8'));

  printSummary(before, 'Before');
  printSummary(after, 'After');

  // Build lookup by name
  const afterMap = new Map(after.map((r) => [r.name, r]));

  let improved = 0;
  let regressed = 0;
  let unchanged = 0;

  console.log('\n--- Comparison ---');
  for (const b of before) {
    const a = afterMap.get(b.name);
    if (!a) continue;

    if (b.pass && !a.pass) {
      regressed++;
      console.log(`  REGRESSED  ${b.name}`);
      for (const f of a.failures) console.log(`             ${f}`);
    } else if (!b.pass && a.pass) {
      improved++;
      console.log(`  IMPROVED   ${b.name}`);
    } else {
      unchanged++;
    }
  }

  console.log(
    `\nSummary: ${improved} improved, ${regressed} regressed, ${unchanged} unchanged`
  );
  if (regressed > 0) process.exit(1);
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

function parseArgs() {
  const args = process.argv.slice(2);
  const opts: Record<string, string | boolean> = {};

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--verbose' || arg === '-v') {
      opts.verbose = true;
    } else if (arg === '--url' && args[i + 1]) {
      opts.url = args[++i];
    } else if (arg === '--tag' && args[i + 1]) {
      opts.tag = args[++i];
    } else if (arg === '--name' && args[i + 1]) {
      opts.name = args[++i];
    } else if (arg === '--baseline' && args[i + 1]) {
      opts.baseline = args[++i];
    } else if (arg === '--candidate' && args[i + 1]) {
      opts.candidate = args[++i];
    } else if (arg === '--compare' && args[i + 1] && args[i + 2]) {
      opts.compareBefore = args[++i];
      opts.compareAfter = args[++i];
    } else if (arg === '--dataset' && args[i + 1]) {
      opts.dataset = args[++i];
    } else if (arg === '--save' && args[i + 1]) {
      opts.save = args[++i];
    }
  }

  return opts;
}

async function main() {
  const opts = parseArgs();
  const datasetPath =
    (opts.dataset as string) ||
    path.join(__dirname, '..', 'data', 'eval-dataset.json');
  const dataset: EvalDataset = JSON.parse(fs.readFileSync(datasetPath, 'utf-8'));

  console.log(`=== Search Eval Harness ===`);
  console.log(`Dataset: ${datasetPath} (${dataset.cases.length} cases)`);

  // Offline comparison mode
  if (opts.compareBefore && opts.compareAfter) {
    runOfflineComparison(opts.compareBefore as string, opts.compareAfter as string);
    return;
  }

  // A/B comparison mode
  if (opts.baseline && opts.candidate) {
    await runComparison(
      opts.baseline as string,
      opts.candidate as string,
      dataset,
      {
        verbose: !!opts.verbose,
        tag: opts.tag as string | undefined,
        nameFilter: opts.name as string | undefined,
      }
    );
    return;
  }

  // Single-endpoint eval
  const baseUrl = (opts.url as string) || 'http://localhost:3000';
  const results = await runEval(baseUrl, dataset, {
    verbose: !!opts.verbose,
    tag: opts.tag as string | undefined,
    nameFilter: opts.name as string | undefined,
  });

  const summary = printSummary(results);

  // Optionally save results for later comparison
  if (opts.save) {
    fs.writeFileSync(opts.save as string, JSON.stringify(results, null, 2));
    console.log(`\nResults saved to ${opts.save}`);
  }

  if (summary.failed > 0) process.exit(1);
  console.log('\nAll eval cases passed.');
}

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
