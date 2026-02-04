import { list } from '@vercel/blob';

export interface StoredChunk {
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

interface VectorStoreData {
  chunks: StoredChunk[];
}

// In-memory cache for the vector store (persists across requests in the same Lambda instance)
let cachedVectorStore: StoredChunk[] | null = null;
let loadPromise: Promise<StoredChunk[]> | null = null;

const SEARCH_DATA_PREFIX = 'search-data/';

/**
 * Load vector store from Vercel Blob storage.
 * Uses in-memory caching to avoid repeated fetches.
 */
export async function loadVectorStoreAsync(): Promise<StoredChunk[]> {
  // Return cached data if available
  if (cachedVectorStore !== null) {
    return cachedVectorStore;
  }

  // If already loading, wait for the existing promise
  if (loadPromise !== null) {
    return loadPromise;
  }

  // Start loading
  loadPromise = (async () => {
    try {
      console.log('Loading vector store from Blob storage...');
      const startTime = Date.now();

      // Find the vector store blob
      const blobs = await list({ prefix: `${SEARCH_DATA_PREFIX}vector-store.json` });
      const match = blobs.blobs.find((b) => b.pathname === `${SEARCH_DATA_PREFIX}vector-store.json`);

      if (!match) {
        console.warn('Vector store not found in Blob storage');
        cachedVectorStore = [];
        return cachedVectorStore;
      }

      // Fetch the data
      const response = await fetch(match.url);
      if (!response.ok) {
        throw new Error(`Failed to fetch vector store: ${response.status}`);
      }

      const data: VectorStoreData = await response.json();
      cachedVectorStore = data.chunks || [];

      const elapsed = Date.now() - startTime;
      console.log(`Loaded ${cachedVectorStore.length} chunks from Blob in ${elapsed}ms`);

      return cachedVectorStore;
    } catch (error) {
      console.error('Error loading vector store:', error);
      cachedVectorStore = [];
      return cachedVectorStore;
    } finally {
      loadPromise = null;
    }
  })();

  return loadPromise;
}

/**
 * Synchronous version that returns cached data or empty array.
 * Use loadVectorStoreAsync() for guaranteed data loading.
 * @deprecated Use loadVectorStoreAsync instead
 */
export function loadVectorStore(): StoredChunk[] {
  if (cachedVectorStore !== null) {
    return cachedVectorStore;
  }
  // Trigger async load for next request
  loadVectorStoreAsync().catch(console.error);
  return [];
}

export function saveVectorStore(): void {
  // No-op in production - data is managed via Blob storage
  console.warn('saveVectorStore is not available in production');
}

function cosineSimilarity(a: number[], b: number[]): number {
  let dotProduct = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < a.length; i++) {
    dotProduct += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  return dotProduct / (Math.sqrt(normA) * Math.sqrt(normB));
}

export function searchSimilar(
  queryEmbedding: number[],
  chunks: StoredChunk[],
  topK: number = 10
): { chunk: StoredChunk; score: number }[] {
  const scored = chunks.map((chunk) => ({
    chunk,
    score: cosineSimilarity(queryEmbedding, chunk.embedding),
  }));

  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, topK);
}
