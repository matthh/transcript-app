/**
 * Download a transcript from Vercel Blob to the local transcripts/ directory.
 * Used in CI to fetch the latest speaker-mapped version before ingest.
 *
 * Usage: npx tsx scripts/download-blob-transcript.ts <episode_number>
 */

import * as fs from 'fs';
import * as path from 'path';
import * as dotenv from 'dotenv';
import { loadTranscript } from '../src/lib/blob-storage';

dotenv.config({ path: '.env.local' });

const episodeNum = parseInt(process.argv[2], 10);
if (!episodeNum || isNaN(episodeNum)) {
  console.error('Usage: npx tsx scripts/download-blob-transcript.ts <episode_number>');
  process.exit(1);
}

async function main() {
  const transcript = await loadTranscript(episodeNum);
  if (!transcript) {
    console.error(`Transcript for episode ${episodeNum} not found in Blob`);
    process.exit(1);
  }

  const dir = path.join(process.cwd(), 'transcripts');
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

  const outPath = path.join(dir, `episode_${episodeNum}.json`);
  fs.writeFileSync(outPath, JSON.stringify(transcript, null, 2));
  console.log(`Downloaded episode ${episodeNum} transcript from Blob to ${outPath}`);
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
