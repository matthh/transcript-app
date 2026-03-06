import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';

function run(command: string, args: string[]) {
  const result = spawnSync(command, args, { stdio: 'inherit', env: process.env });
  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}

// Skip re-ingestion when transcripts haven't changed.
// The ingest script fingerprints local + blob transcripts and compares against
// a stored manifest — only re-embeds when the hash differs.
// Override with SKIP_INGEST_IF_NO_NEW=0 to force re-ingest.
if (process.env.SKIP_INGEST_IF_NO_NEW !== '0') {
  process.env.SKIP_INGEST_IF_NO_NEW = '1';
  console.log('Build: skipping embeddings when transcripts are unchanged (override with SKIP_INGEST_IF_NO_NEW=0).');
}

run('npm', ['run', 'ingest', '--', '--skip-topics']);

// Only upload if ingest produced new data files (they're gitignored, so they
// only exist when ingest actually ran and generated embeddings)
if (existsSync('vector-store.json') || existsSync('bm25-index.json')) {
  run('npm', ['run', 'upload-search-data']);
} else {
  console.log('Build: no new search data files — skipping upload.');
}
// Note: bundle step removed. src/lib/metadata-data.ts is maintained directly
// by sync-metadata.ts (via GitHub Action) and committed to git.
// The old bundle-data.ts would overwrite it with stale data/episode-metadata.json.
