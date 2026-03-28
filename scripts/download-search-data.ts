/**
 * Download search index files from Vercel Blob to local disk.
 * Used in CI before running incremental ingest (--episode).
 *
 * Usage: npx tsx scripts/download-search-data.ts
 */

import * as fs from 'fs';
import * as path from 'path';
import * as dotenv from 'dotenv';
import { list } from '@vercel/blob';

dotenv.config({ path: '.env.local' });

const SEARCH_DATA_PREFIX = 'search-data/';

const FILES = [
  'vector-store.json',
  'bm25-index.json',
  'topic-vectors.json',
];

async function downloadSearchData() {
  console.log('Downloading search data from Vercel Blob...\n');

  const blobs = await list({ prefix: SEARCH_DATA_PREFIX });

  for (const fileName of FILES) {
    const blobPath = `${SEARCH_DATA_PREFIX}${fileName}`;
    const match = blobs.blobs.find(b => b.pathname === blobPath);

    if (!match) {
      console.log(`  ⚠ ${fileName} not found in Blob — skipping`);
      continue;
    }

    const response = await fetch(match.url);
    if (!response.ok) {
      console.error(`  ✗ Failed to download ${fileName}: ${response.status}`);
      continue;
    }

    const data = await response.text();
    const localPath = path.join(process.cwd(), fileName);
    fs.writeFileSync(localPath, data);
    const sizeMB = (Buffer.byteLength(data, 'utf-8') / (1024 * 1024)).toFixed(2);
    console.log(`  ✓ ${fileName} (${sizeMB} MB)`);
  }

  console.log('\n✓ Download complete.');
}

downloadSearchData().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
