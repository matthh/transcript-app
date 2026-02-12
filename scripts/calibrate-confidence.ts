/**
 * Confidence calibration diagnostic.
 *
 * Calls classifyQuery() directly for each eval case that has
 * `expectClassificationType`, runs multiple iterations per case
 * (LLM is stochastic), and produces a calibration report.
 *
 * Output: per-bucket accuracy table + per-case detail.
 *
 * Usage:
 *   npx tsx scripts/calibrate-confidence.ts
 *   npx tsx scripts/calibrate-confidence.ts --iterations 5
 */

import * as dotenv from 'dotenv';
import * as fs from 'fs';
import * as path from 'path';
import { classifyQuery } from '../src/lib/query-classifier';

// Load .env.local (Next.js convention) for API keys
dotenv.config({ path: path.join(__dirname, '..', '.env.local') });

interface EvalCase {
  name: string;
  query: string;
  tags?: string[];
  expectClassificationType?: string[];
}

interface EvalDataset {
  cases: EvalCase[];
}

interface TrialResult {
  type: string;
  confidence: number;
  correct: boolean;
}

interface CaseReport {
  name: string;
  query: string;
  expectedTypes: string[];
  trials: TrialResult[];
  avgConfidence: number;
  accuracy: number;
}

function parseArgs() {
  const args = process.argv.slice(2);
  let iterations = 3;
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--iterations' && args[i + 1]) {
      iterations = parseInt(args[i + 1], 10);
    }
  }
  return { iterations };
}

async function main() {
  const { iterations } = parseArgs();
  const datasetPath = path.join(__dirname, '..', 'data', 'eval-dataset.json');
  const dataset: EvalDataset = JSON.parse(fs.readFileSync(datasetPath, 'utf-8'));

  // Filter to cases with expectClassificationType
  const cases = dataset.cases.filter((c) => c.expectClassificationType && c.expectClassificationType.length > 0);
  console.log(`=== Confidence Calibration ===`);
  console.log(`Dataset: ${cases.length} cases with expectClassificationType (${iterations} iterations each)\n`);

  const reports: CaseReport[] = [];
  const allTrials: TrialResult[] = [];

  for (const testCase of cases) {
    const trials: TrialResult[] = [];
    process.stdout.write(`  ${testCase.name}: `);

    for (let i = 0; i < iterations; i++) {
      try {
        const result = await classifyQuery(testCase.query);
        const correct = testCase.expectClassificationType!.includes(result.type);
        const trial: TrialResult = {
          type: result.type,
          confidence: result.confidence,
          correct,
        };
        trials.push(trial);
        allTrials.push(trial);
        process.stdout.write(correct ? '.' : 'X');
      } catch (err) {
        const errMsg = err instanceof Error ? err.message : String(err);
        process.stdout.write('E');
        trials.push({ type: 'error', confidence: 0, correct: false });
        allTrials.push({ type: 'error', confidence: 0, correct: false });
        console.error(`\n    Error: ${errMsg}`);
      }
    }

    const avgConf = trials.reduce((s, t) => s + t.confidence, 0) / trials.length;
    const accuracy = trials.filter((t) => t.correct).length / trials.length;

    reports.push({
      name: testCase.name,
      query: testCase.query,
      expectedTypes: testCase.expectClassificationType!,
      trials,
      avgConfidence: avgConf,
      accuracy,
    });

    const types = [...new Set(trials.map((t) => t.type))].join('/');
    console.log(`  avg_conf=${avgConf.toFixed(2)} acc=${(accuracy * 100).toFixed(0)}% types=[${types}]`);
  }

  // Per-bucket accuracy table
  const buckets = [
    { label: '0.50-0.60', min: 0.5, max: 0.6 },
    { label: '0.60-0.70', min: 0.6, max: 0.7 },
    { label: '0.70-0.80', min: 0.7, max: 0.8 },
    { label: '0.80-0.90', min: 0.8, max: 0.9 },
    { label: '0.90-0.95', min: 0.9, max: 0.96 },
  ];

  console.log('\n=== Calibration Table ===');
  console.log('Bucket       | Trials | Correct | Accuracy');
  console.log('-------------|--------|---------|--------');

  for (const bucket of buckets) {
    const inBucket = allTrials.filter(
      (t) => t.confidence >= bucket.min && t.confidence < bucket.max
    );
    if (inBucket.length === 0) {
      console.log(`${bucket.label.padEnd(13)}| ${String(0).padStart(6)} | ${String(0).padStart(7)} | N/A`);
      continue;
    }
    const correct = inBucket.filter((t) => t.correct).length;
    const acc = ((correct / inBucket.length) * 100).toFixed(1);
    console.log(
      `${bucket.label.padEnd(13)}| ${String(inBucket.length).padStart(6)} | ${String(correct).padStart(7)} | ${acc}%`
    );
  }

  // Overall summary
  const totalTrials = allTrials.length;
  const totalCorrect = allTrials.filter((t) => t.correct).length;
  console.log('-------------|--------|---------|--------');
  console.log(
    `${'Total'.padEnd(13)}| ${String(totalTrials).padStart(6)} | ${String(totalCorrect).padStart(7)} | ${((totalCorrect / totalTrials) * 100).toFixed(1)}%`
  );

  // Per-case failures
  const failures = reports.filter((r) => r.accuracy < 1);
  if (failures.length > 0) {
    console.log(`\n=== Cases with misclassifications ===`);
    for (const r of failures) {
      console.log(`\n  ${r.name} (acc=${(r.accuracy * 100).toFixed(0)}%)`);
      console.log(`    Query: "${r.query}"`);
      console.log(`    Expected: [${r.expectedTypes.join(', ')}]`);
      for (const t of r.trials) {
        const mark = t.correct ? 'OK' : 'MISS';
        console.log(`    ${mark}: type=${t.type} conf=${t.confidence.toFixed(2)}`);
      }
    }
  }

  console.log('\nDone.');
}

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
