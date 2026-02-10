/**
 * Feedback-to-eval pipeline.
 *
 * Reads feedback entries from Vercel Blob (feedback-log/) and generates
 * eval case skeletons for queries rated "bad". Output can be reviewed
 * and merged into data/eval-dataset.json.
 *
 * Usage:
 *   npx tsx scripts/feedback-to-eval.ts                  # print skeleton cases
 *   npx tsx scripts/feedback-to-eval.ts --out cases.json  # write to file
 *   npx tsx scripts/feedback-to-eval.ts --month 2026-02   # specific month only
 */

import * as dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

import { list } from '@vercel/blob';
import * as fs from 'fs';
import * as path from 'path';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface FeedbackEntry {
  id: string;
  timestamp: string;
  name: string;
  query: string;
  answer: string;
  rating: 'good' | 'bad';
  comment?: string;
  queryType?: string;
}

interface EvalCase {
  name: string;
  query: string;
  tags: string[];
  rejectTextInAnswer?: string[];
  expectMinTranscriptSources?: number;
  _feedbackComment?: string;
  _feedbackId?: string;
}

// ---------------------------------------------------------------------------
// Blob reader
// ---------------------------------------------------------------------------

async function loadFeedbackEntries(month?: string): Promise<FeedbackEntry[]> {
  const prefix = month ? `feedback-log/${month}/` : 'feedback-log/';

  const entries: FeedbackEntry[] = [];
  let cursor: string | undefined;

  // Paginate through all blobs under the prefix
  do {
    const result = await list({ prefix, cursor });
    cursor = result.hasMore ? result.cursor : undefined;

    for (const blob of result.blobs) {
      if (!blob.pathname.endsWith('.json')) continue;

      try {
        const response = await fetch(blob.url, { cache: 'no-store' });
        if (!response.ok) continue;
        const entry: FeedbackEntry = await response.json();
        entries.push(entry);
      } catch {
        console.error(`Failed to load ${blob.pathname}`);
      }
    }
  } while (cursor);

  return entries;
}

// ---------------------------------------------------------------------------
// Generator
// ---------------------------------------------------------------------------

function feedbackToEvalCase(entry: FeedbackEntry): EvalCase {
  const slug = entry.query
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .slice(0, 40)
    .replace(/-$/, '');

  return {
    name: `Feedback: ${slug}`,
    query: entry.query,
    tags: ['feedback', 'bad-rating'],
    // Default assertions: the answer should not be a dead-end
    rejectTextInAnswer: ['no information', "don't have", 'cannot find'],
    expectMinTranscriptSources: 1,
    // Developer review fields (remove before merging into eval dataset)
    _feedbackComment: entry.comment || undefined,
    _feedbackId: entry.id,
  };
}

// ---------------------------------------------------------------------------
// Dedup against existing eval dataset
// ---------------------------------------------------------------------------

function loadExistingQueries(): Set<string> {
  const datasetPath = path.join(__dirname, '..', 'data', 'eval-dataset.json');
  try {
    const dataset = JSON.parse(fs.readFileSync(datasetPath, 'utf-8'));
    return new Set(
      (dataset.cases || []).map((c: { query: string }) => c.query.toLowerCase())
    );
  } catch {
    return new Set();
  }
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

function parseArgs() {
  const args = process.argv.slice(2);
  const opts: Record<string, string> = {};
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--out' && args[i + 1]) opts.out = args[++i];
    if (args[i] === '--month' && args[i + 1]) opts.month = args[++i];
    if (args[i] === '--all') opts.all = 'true';
  }
  return opts;
}

async function main() {
  const opts = parseArgs();

  console.error('Loading feedback entries from Vercel Blob...');
  const entries = await loadFeedbackEntries(opts.month);
  console.error(`Found ${entries.length} feedback entries`);

  // Filter to bad ratings (unless --all)
  const badEntries = opts.all === 'true'
    ? entries
    : entries.filter((e) => e.rating === 'bad');
  console.error(`${badEntries.length} with bad rating`);

  // Dedup against existing eval dataset
  const existing = loadExistingQueries();
  const newEntries = badEntries.filter(
    (e) => !existing.has(e.query.toLowerCase())
  );
  console.error(`${newEntries.length} not already in eval dataset`);

  if (newEntries.length === 0) {
    console.error('No new eval cases to generate.');
    return;
  }

  const cases = newEntries.map(feedbackToEvalCase);

  const output = JSON.stringify({ cases }, null, 2);

  if (opts.out) {
    const outPath = path.resolve(opts.out);
    fs.writeFileSync(outPath, output);
    console.error(`Written ${cases.length} eval case skeletons to ${outPath}`);
    console.error('Review the _feedbackComment and _feedbackId fields, add assertions, then merge into data/eval-dataset.json');
  } else {
    console.log(output);
  }
}

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
