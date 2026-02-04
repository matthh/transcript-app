import * as fs from 'fs';
import * as path from 'path';

// Bundle vector store as a JS module
const vectorStorePath = path.join(process.cwd(), 'vector-store.json');
const vectorStoreData = fs.readFileSync(vectorStorePath, 'utf-8');

const vectorStoreModule = `// Auto-generated - do not edit
export const vectorStore = ${vectorStoreData};
`;

fs.writeFileSync(
  path.join(process.cwd(), 'src', 'lib', 'vector-data.ts'),
  vectorStoreModule
);
console.log('Created src/lib/vector-data.ts');

// Bundle BM25 index as a JS module
const bm25IndexPath = path.join(process.cwd(), 'bm25-index.json');
if (fs.existsSync(bm25IndexPath)) {
  const bm25IndexData = fs.readFileSync(bm25IndexPath, 'utf-8');

  const bm25Module = `// Auto-generated - do not edit
import { BM25Index } from './bm25';
export const bm25Index: BM25Index = ${bm25IndexData};
`;

  fs.writeFileSync(
    path.join(process.cwd(), 'src', 'lib', 'bm25-data.ts'),
    bm25Module
  );
  console.log('Created src/lib/bm25-data.ts');
} else {
  // Create empty BM25 index if not found
  const emptyBm25Module = `// Auto-generated - do not edit
import { BM25Index } from './bm25';
export const bm25Index: BM25Index = {
  df: {},
  invertedIndex: {},
  docLengths: [],
  avgDocLength: 0,
  numDocs: 0,
  docIds: [],
};
`;
  fs.writeFileSync(
    path.join(process.cwd(), 'src', 'lib', 'bm25-data.ts'),
    emptyBm25Module
  );
  console.log('Created src/lib/bm25-data.ts (empty - run ingest first)');
}

// Bundle metadata as a JS module
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

console.log('Data bundled successfully!');
