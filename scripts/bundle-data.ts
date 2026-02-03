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
