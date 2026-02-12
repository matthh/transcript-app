/**
 * Rename a transcript in Vercel Blob storage.
 * Usage: npx tsx scripts/rename-blob-transcript.ts <from> <to>
 * Example: npx tsx scripts/rename-blob-transcript.ts 0 147b1
 */

import { put, list, del } from '@vercel/blob';
import * as dotenv from 'dotenv';

dotenv.config({ path: '.env.local' });

async function main() {
  const [from, to] = process.argv.slice(2);
  if (!from || !to) {
    console.error('Usage: npx tsx scripts/rename-blob-transcript.ts <from> <to>');
    process.exit(1);
  }

  const fromPath = `transcripts/episode_${from}.json`;
  const toPath = `transcripts/episode_${to}.json`;

  console.log(`Renaming blob: ${fromPath} → ${toPath}`);

  // Find the source blob
  const blobs = await list({ prefix: fromPath });
  const match = blobs.blobs.find(b => b.pathname === fromPath);
  if (!match) {
    console.error(`Source blob not found: ${fromPath}`);
    process.exit(1);
  }

  // Fetch content
  const response = await fetch(match.url, { cache: 'no-store' });
  const content = await response.text();
  const transcript = JSON.parse(content);

  // Update episode_number in the transcript
  transcript.episode_number = to;

  // Upload with new name
  await put(toPath, JSON.stringify(transcript, null, 2), {
    access: 'public',
    contentType: 'application/json',
    addRandomSuffix: false,
    allowOverwrite: true,
  });
  console.log(`  ✓ Uploaded ${toPath}`);

  // Verify new blob exists
  const verifyBlobs = await list({ prefix: toPath });
  const verifyMatch = verifyBlobs.blobs.find(b => b.pathname === toPath);
  if (!verifyMatch) {
    console.error('  ✗ Verification failed — new blob not found. Aborting delete.');
    process.exit(1);
  }

  // Delete old blob
  await del(match.url);
  console.log(`  ✓ Deleted ${fromPath}`);

  console.log('Done.');
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
