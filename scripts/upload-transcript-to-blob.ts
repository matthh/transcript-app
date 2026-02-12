/**
 * Upload a local transcript to Vercel Blob storage.
 * Usage: npx tsx scripts/upload-transcript-to-blob.ts <episodeId> [<episodeId> ...]
 * Example: npx tsx scripts/upload-transcript-to-blob.ts 49b1 49b2 79b1
 */

import * as fs from 'fs';
import * as path from 'path';
import { put } from '@vercel/blob';
import * as dotenv from 'dotenv';

dotenv.config({ path: '.env.local' });

async function main() {
  const ids = process.argv.slice(2);
  if (ids.length === 0) {
    console.error('Usage: npx tsx scripts/upload-transcript-to-blob.ts <episodeId> [...]');
    process.exit(1);
  }

  for (const id of ids) {
    const localPath = path.join('transcripts', `episode_${id}.json`);
    if (!fs.existsSync(localPath)) {
      console.error(`  ✗ ${localPath} not found locally`);
      continue;
    }

    const content = fs.readFileSync(localPath, 'utf-8');
    JSON.parse(content); // validate

    const blobPath = `transcripts/episode_${id}.json`;
    await put(blobPath, content, {
      access: 'public',
      contentType: 'application/json',
      addRandomSuffix: false,
      allowOverwrite: true,
    });
    console.log(`  ✓ Uploaded ${blobPath}`);
  }

  console.log('Done.');
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
