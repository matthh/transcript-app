/**
 * Lazy loader for BM25 index from Vercel Blob storage.
 */

import { list } from '@vercel/blob';
import { BM25Index } from './bm25';

// In-memory cache for the BM25 index
let cachedBM25Index: BM25Index | null = null;
let loadPromise: Promise<BM25Index | null> | null = null;

const SEARCH_DATA_PREFIX = 'search-data/';

const EMPTY_INDEX: BM25Index = {
  df: {},
  invertedIndex: {},
  docLengths: [],
  avgDocLength: 0,
  numDocs: 0,
  docIds: [],
};

/**
 * Load BM25 index from Vercel Blob storage.
 * Uses in-memory caching to avoid repeated fetches.
 */
export async function loadBM25IndexAsync(): Promise<BM25Index> {
  // Return cached data if available
  if (cachedBM25Index !== null) {
    return cachedBM25Index;
  }

  // If already loading, wait for the existing promise
  if (loadPromise !== null) {
    const result = await loadPromise;
    return result || EMPTY_INDEX;
  }

  // Start loading
  loadPromise = (async () => {
    try {
      console.log('Loading BM25 index from Blob storage...');
      const startTime = Date.now();

      // Find the BM25 index blob
      const blobs = await list({ prefix: `${SEARCH_DATA_PREFIX}bm25-index.json` });
      const match = blobs.blobs.find((b) => b.pathname === `${SEARCH_DATA_PREFIX}bm25-index.json`);

      if (!match) {
        console.warn('BM25 index not found in Blob storage');
        cachedBM25Index = EMPTY_INDEX;
        return cachedBM25Index;
      }

      // Fetch the data
      const response = await fetch(match.url);
      if (!response.ok) {
        throw new Error(`Failed to fetch BM25 index: ${response.status}`);
      }

      const data: BM25Index = await response.json();
      cachedBM25Index = data;

      const elapsed = Date.now() - startTime;
      console.log(`Loaded BM25 index (${data.numDocs} docs, ${Object.keys(data.df).length} terms) in ${elapsed}ms`);

      return cachedBM25Index;
    } catch (error) {
      console.error('Error loading BM25 index:', error);
      cachedBM25Index = EMPTY_INDEX;
      return cachedBM25Index;
    } finally {
      loadPromise = null;
    }
  })();

  const result = await loadPromise;
  return result || EMPTY_INDEX;
}

/**
 * Check if BM25 index is loaded and has data.
 */
export function isBM25Loaded(): boolean {
  return cachedBM25Index !== null && cachedBM25Index.numDocs > 0;
}

/**
 * Get the cached BM25 index (may be null if not loaded yet).
 */
export function getCachedBM25Index(): BM25Index | null {
  return cachedBM25Index;
}
