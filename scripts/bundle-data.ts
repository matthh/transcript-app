/**
 * Bundle only metadata as a JS module.
 * Vector store and BM25 index are loaded from Blob storage at runtime
 * to stay under the 250MB serverless function limit.
 */

import * as fs from 'fs';
import * as path from 'path';

// Bundle metadata as a JS module (small enough to bundle)
const metadataPath = path.join(process.cwd(), 'data', 'episode-metadata.json');
const metadataData = fs.readFileSync(metadataPath, 'utf-8');

const metadataModule = `// Auto-generated - do not edit
import { EpisodeMetadata } from '@/types/episode-metadata';
export const episodeMetadata: EpisodeMetadata[] = ${metadataData};
`;

fs.writeFileSync(
  path.join(process.cwd(), 'src', 'lib', 'metadata-data.ts'),
  metadataModule
);
console.log('Created src/lib/metadata-data.ts');

// Note: vector-store and bm25-index are NOT bundled.
// They are uploaded to Vercel Blob storage and loaded at runtime.
// See scripts/upload-search-data.ts

console.log('Metadata bundled successfully!');
console.log('(Vector store and BM25 index are loaded from Blob storage at runtime)');
