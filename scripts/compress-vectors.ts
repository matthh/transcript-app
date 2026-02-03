import * as fs from 'fs';
import * as path from 'path';

const STORE_PATH = path.join(process.cwd(), 'vector-store.json');
const COMPRESSED_PATH = path.join(process.cwd(), 'vector-store.min.json');

interface StoredChunk {
  id: string;
  text: string;
  embedding: number[];
  metadata: {
    episodeTitle: string;
    speakers: string;
    startTimestamp: string;
    endTimestamp: string;
  };
}

interface VectorStore {
  chunks: StoredChunk[];
}

function compressVectorStore(): void {
  console.log('Reading vector store...');
  const data = fs.readFileSync(STORE_PATH, 'utf-8');
  const store: VectorStore = JSON.parse(data);

  console.log(`Found ${store.chunks.length} chunks`);

  // Reduce embedding precision to 6 decimal places
  const compressed: VectorStore = {
    chunks: store.chunks.map((chunk) => ({
      ...chunk,
      embedding: chunk.embedding.map((v) => Math.round(v * 1000000) / 1000000),
    })),
  };

  // Write without pretty printing to save space
  const output = JSON.stringify(compressed);
  fs.writeFileSync(COMPRESSED_PATH, output);

  const originalSize = fs.statSync(STORE_PATH).size;
  const compressedSize = fs.statSync(COMPRESSED_PATH).size;

  console.log(`Original size: ${(originalSize / 1024 / 1024).toFixed(2)} MB`);
  console.log(`Compressed size: ${(compressedSize / 1024 / 1024).toFixed(2)} MB`);
  console.log(`Reduction: ${(((originalSize - compressedSize) / originalSize) * 100).toFixed(1)}%`);

  // Replace original with compressed
  fs.renameSync(STORE_PATH, STORE_PATH + '.backup');
  fs.renameSync(COMPRESSED_PATH, STORE_PATH);
  console.log('\nReplaced original with compressed version (backup saved as .backup)');
}

compressVectorStore();
