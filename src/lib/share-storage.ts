import { put, list } from '@vercel/blob';

const SHARE_PREFIX = 'shares/';

interface TranscriptSource {
  episodeTitle: string;
  episodeNumber?: number;
  speakers: string;
  startTimestamp: string;
  endTimestamp: string;
  text: string;
  score: number;
}

interface MetadataSource {
  film: string;
  season: number;
  episode: number;
  releaseDate: string;
  guest: string | null;
  reviewer: string;
  relevantFields: Record<string, string>;
}

export interface ShareableResult {
  id: string;
  createdAt: string;
  query: string;
  answer: string;
  queryType: 'factual' | 'interpretive' | 'hybrid';
  sources: {
    transcripts?: TranscriptSource[];
    metadata?: MetadataSource[];
  };
  primaryEpisode?: {
    film: string;
    season?: number;
    episode?: number;
  };
}

/**
 * Generate a unique share ID
 */
function generateShareId(): string {
  const timestamp = Date.now().toString(36);
  const random = Math.random().toString(36).substring(2, 8);
  return `shr_${timestamp}_${random}`;
}

/**
 * Extract primary episode info from sources
 */
function extractPrimaryEpisode(sources: ShareableResult['sources']): ShareableResult['primaryEpisode'] | undefined {
  // Try metadata first
  if (sources.metadata && sources.metadata.length > 0) {
    const first = sources.metadata[0];
    return {
      film: first.film,
      season: first.season,
      episode: first.episode,
    };
  }

  // Fall back to transcript source
  if (sources.transcripts && sources.transcripts.length > 0) {
    const first = sources.transcripts[0];
    return {
      film: first.episodeTitle,
      episode: first.episodeNumber,
    };
  }

  return undefined;
}

/**
 * Save a shareable result to Vercel Blob storage
 */
export async function saveShare(data: {
  query: string;
  answer: string;
  queryType: 'factual' | 'interpretive' | 'hybrid';
  sources: ShareableResult['sources'];
}): Promise<string> {
  const id = generateShareId();
  const pathname = `${SHARE_PREFIX}${id}.json`;

  const shareData: ShareableResult = {
    id,
    createdAt: new Date().toISOString(),
    query: data.query,
    answer: data.answer,
    queryType: data.queryType,
    sources: data.sources,
    primaryEpisode: extractPrimaryEpisode(data.sources),
  };

  await put(pathname, JSON.stringify(shareData), {
    access: 'public',
    contentType: 'application/json',
    addRandomSuffix: false,
  });

  return id;
}

/**
 * Load a shareable result from Vercel Blob storage
 */
export async function loadShare(id: string): Promise<ShareableResult | null> {
  // Validate ID format to prevent path traversal
  if (!id.startsWith('shr_') || id.includes('/') || id.includes('..')) {
    return null;
  }

  const pathname = `${SHARE_PREFIX}${id}.json`;

  try {
    const blobs = await list({ prefix: pathname });
    const match = blobs.blobs.find((b) => b.pathname === pathname);

    if (!match) {
      return null;
    }

    const response = await fetch(match.url, { cache: 'no-store' });
    if (!response.ok) {
      return null;
    }

    return await response.json();
  } catch {
    return null;
  }
}
