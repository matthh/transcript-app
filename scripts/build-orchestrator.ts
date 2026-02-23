import { spawnSync } from 'node:child_process';

function run(command: string, args: string[]) {
  const result = spawnSync(command, args, { stdio: 'inherit', env: process.env });
  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}

const isPreview = process.env.VERCEL_ENV === 'preview';
const isLocal = !process.env.VERCEL_ENV;
if (isPreview || isLocal) {
  process.env.SKIP_INGEST_IF_NO_NEW = '1';
  console.log('Build: skipping embeddings when transcripts are unchanged (override with SKIP_INGEST_IF_NO_NEW=0).');
}

run('npm', ['run', 'ingest']);
run('npm', ['run', 'upload-search-data']);
// Note: bundle step removed. src/lib/metadata-data.ts is maintained directly
// by sync-metadata.ts (via GitHub Action) and committed to git.
// The old bundle-data.ts would overwrite it with stale data/episode-metadata.json.
