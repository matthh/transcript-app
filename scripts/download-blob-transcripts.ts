/**
 * Download blob-only transcripts to local `transcripts/` directory.
 *
 * Fetches transcripts from Vercel Blob that don't exist locally.
 *
 * Usage:
 *   npx tsx scripts/download-blob-transcripts.ts              # Download all missing
 *   npx tsx scripts/download-blob-transcripts.ts --dry-run    # Preview only
 */

import * as fs from 'fs';
import * as path from 'path';
import { list } from '@vercel/blob';
import * as dotenv from 'dotenv';

dotenv.config({ path: '.env.local' });

const TRANSCRIPTS_DIR = './transcripts';
const TRANSCRIPT_PREFIX = 'transcripts/';

async function main() {
  const dryRun = process.argv.includes('--dry-run');

  if (!process.env.BLOB_READ_WRITE_TOKEN) {
    console.error('Error: BLOB_READ_WRITE_TOKEN not found in .env.local');
    process.exit(1);
  }

  // Get local transcript filenames
  const localFiles = new Set(
    fs.readdirSync(TRANSCRIPTS_DIR).filter(f => f.endsWith('.json'))
  );
  console.log(`Local transcripts: ${localFiles.size}`);

  // List all blob transcripts
  const blobResult = await list({ prefix: TRANSCRIPT_PREFIX });
  const blobTranscripts = blobResult.blobs.filter(b => b.pathname.endsWith('.json'));
  console.log(`Blob transcripts: ${blobTranscripts.length}`);

  // Find missing locally
  const missing: { pathname: string; url: string; filename: string }[] = [];
  for (const blob of blobTranscripts) {
    const filename = path.basename(blob.pathname);
    if (!localFiles.has(filename)) {
      missing.push({ pathname: blob.pathname, url: blob.url, filename });
    }
  }

  console.log(`Missing locally: ${missing.length}`);

  if (missing.length === 0) {
    console.log('All blob transcripts already exist locally.');
    return;
  }

  // Sort by episode number for clean output
  missing.sort((a, b) => {
    const numA = parseInt(a.filename.match(/episode_(\d+)/)?.[1] || '0', 10);
    const numB = parseInt(b.filename.match(/episode_(\d+)/)?.[1] || '0', 10);
    return numA - numB;
  });

  if (dryRun) {
    console.log('\n[DRY RUN] Would download:');
    for (const m of missing) {
      console.log(`  ${m.filename}`);
    }
    return;
  }

  console.log(`\nDownloading ${missing.length} transcripts...\n`);

  let downloaded = 0;
  let failed = 0;

  for (const m of missing) {
    try {
      const response = await fetch(m.url, { cache: 'no-store' });
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }
      const content = await response.text();

      // Validate it's parseable JSON
      JSON.parse(content);

      const outPath = path.join(TRANSCRIPTS_DIR, m.filename);
      fs.writeFileSync(outPath, content, 'utf-8');
      downloaded++;
      console.log(`  ✓ ${m.filename}`);
    } catch (err) {
      failed++;
      console.error(`  ✗ ${m.filename}: ${err instanceof Error ? err.message : err}`);
    }
  }

  console.log(`\nDone: ${downloaded} downloaded, ${failed} failed.`);
  console.log(`Local transcripts now: ${fs.readdirSync(TRANSCRIPTS_DIR).filter(f => f.endsWith('.json')).length}`);
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
