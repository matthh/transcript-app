import { NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';
import { loadEpisodeMetadata } from '@/lib/metadata-store';
import { listBlobTranscripts } from '@/lib/blob-storage';
import type { EpisodeMetadata } from '@/types/episode-metadata';

export interface CoverageEpisode {
  episode: number;
  film: string;
  season: number;
  releaseDate: string;
  reviewer: string;
  guest: string | null;
  hasTranscript: boolean;
  transcriptSource?: 'filesystem' | 'blob';
}

export interface CoverageResponse {
  total: number;
  withTranscripts: number;
  withoutTranscripts: number;
  coveragePercent: number;
  episodes: CoverageEpisode[];
  bySeason: Record<number, { total: number; transcribed: number }>;
}

/**
 * GET /api/coverage
 * Returns transcript coverage information comparing metadata to available transcripts
 */
export async function GET() {
  const metadata = loadEpisodeMetadata();

  // Get episode numbers with filesystem transcripts
  const transcriptsDir = path.join(process.cwd(), 'transcripts');
  const filesystemEpisodes = new Map<number, true>();

  try {
    if (fs.existsSync(transcriptsDir)) {
      const files = fs.readdirSync(transcriptsDir).filter(f => f.endsWith('.json'));
      for (const filename of files) {
        try {
          const filePath = path.join(transcriptsDir, filename);
          const content = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
          if (content.episode_number) {
            filesystemEpisodes.set(content.episode_number, true);
          }
        } catch {
          // Skip unparseable files
        }
      }
    }
  } catch {
    // Directory doesn't exist
  }

  // Get episode numbers with Blob transcripts
  const blobEpisodes = new Map<number, true>();
  try {
    const blobTranscripts = await listBlobTranscripts();
    for (const blob of blobTranscripts) {
      blobEpisodes.set(blob.episodeNumber, true);
    }
  } catch {
    // Blob storage not available
  }

  // Build coverage data
  const episodes: CoverageEpisode[] = metadata.map((ep: EpisodeMetadata) => {
    const hasFilesystem = filesystemEpisodes.has(ep.episode);
    const hasBlob = blobEpisodes.has(ep.episode);
    const hasTranscript = hasFilesystem || hasBlob;

    return {
      episode: ep.episode,
      film: ep.film,
      season: ep.season,
      releaseDate: ep.releaseDate,
      reviewer: ep.reviewer,
      guest: ep.guest,
      hasTranscript,
      transcriptSource: hasFilesystem ? 'filesystem' : hasBlob ? 'blob' : undefined,
    };
  });

  // Sort by episode number
  episodes.sort((a, b) => a.episode - b.episode);

  // Calculate stats
  const withTranscripts = episodes.filter(e => e.hasTranscript).length;
  const withoutTranscripts = episodes.length - withTranscripts;

  // Calculate by season
  const bySeason: Record<number, { total: number; transcribed: number }> = {};
  for (const ep of episodes) {
    if (!bySeason[ep.season]) {
      bySeason[ep.season] = { total: 0, transcribed: 0 };
    }
    bySeason[ep.season].total++;
    if (ep.hasTranscript) {
      bySeason[ep.season].transcribed++;
    }
  }

  const response: CoverageResponse = {
    total: episodes.length,
    withTranscripts,
    withoutTranscripts,
    coveragePercent: episodes.length > 0 ? Math.round((withTranscripts / episodes.length) * 100) : 0,
    episodes,
    bySeason,
  };

  return NextResponse.json(response);
}
