import { NextResponse } from 'next/server';
import { unstable_noStore as noStore } from 'next/cache';
import { loadEpisodeMetadata } from '@/lib/metadata-store';
import { listBlobTranscripts } from '@/lib/blob-storage';
import type { EpisodeMetadata } from '@/types/episode-metadata';
import type { Transcript } from '@/types/transcript';
import { type EpisodeId, episodeSortKey, isBonusEpisode } from '@/lib/episode-format';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

export interface CoverageEpisode {
  episode: EpisodeId;
  film: string;
  season: number;
  releaseDate: string;
  reviewer: string;
  guest: string | null;
  hasTranscript: boolean;
  needsReview: boolean;
  transcriptSource?: 'filesystem' | 'blob';
  transcriptFile?: string;
}

export interface CoverageResponse {
  total: number;
  withTranscripts: number;
  withoutTranscripts: number;
  needsReview: number;
  coveragePercent: number;
  episodes: CoverageEpisode[];
  bySeason: Record<number, { total: number; transcribed: number }>;
}

/**
 * Pattern for detecting unmapped AssemblyAI speakers (e.g., "A", "B", "Speaker A")
 * Excludes "I" and "M" which appear as parsing artifacts in some older transcripts
 */
const UNMAPPED_SPEAKER_PATTERN = /^(Speaker\s*)?[A-HJ-LN-Z]$/i;

/**
 * Check if a transcript has unmapped speaker names
 */
function hasUnmappedSpeakers(transcript: Transcript): boolean {
  return transcript.dialogues.some(d => UNMAPPED_SPEAKER_PATTERN.test(d.name.trim()));
}

interface TranscriptInfo {
  filename: string;
  episodeNumber: number | string;
  episodeName: string;
  source: 'filesystem' | 'blob';
  needsReview: boolean;
}

function normalizeEpisodeId(id: EpisodeId | number | string): string {
  return String(id).trim().toLowerCase();
}

function parseEpisodeNumberLike(id: EpisodeId | number | string): number | null {
  const str = String(id).trim().toLowerCase();
  const bonusMatch = str.match(/^(\d+)b\d+$/);
  if (bonusMatch) return parseInt(bonusMatch[1], 10);
  if (/^\d+$/.test(str)) return parseInt(str, 10);
  return null;
}

/**
 * Normalize a film/episode name for fuzzy matching
 */
function normalizeName(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, '') // Remove special chars
    .replace(/\s+/g, ' ')
    .replace(/\b(the|a|an)\b/g, '') // Remove articles
    .replace(/\(\d{4}\)/g, '') // Remove year in parens
    .replace(/\d{4}$/g, '') // Remove year at end (parens already stripped above)
    .replace(/bonus\s*/gi, '')
    .replace(/on deck\s*-?\s*/gi, '')
    .replace(/episode\s*\d+\s*:?\s*/gi, '')
    .replace(/special edition/gi, '')
    .trim();
}

/**
 * Check if two names match (fuzzy).
 * Uses length-ratio guards on substring checks to prevent false positives
 * (e.g. "Best of: No Country for Old Men" should NOT match "No Country for Old Men"
 * as a different episode just because one contains the other).
 */
function namesMatch(metadataFilm: string, transcriptName: string): boolean {
  const normalizedMeta = normalizeName(metadataFilm);
  const normalizedTranscript = normalizeName(transcriptName);

  if (!normalizedMeta || !normalizedTranscript) return false;

  // Exact match after normalization
  if (normalizedMeta === normalizedTranscript) return true;

  // One contains the other — but only if the shorter string is at least 70% the
  // length of the longer one.  This prevents "No Country Old Men" (short) from
  // matching "Escape Hatch No Country Old Men" (long) when they are different episodes.
  const shorter = normalizedMeta.length <= normalizedTranscript.length ? normalizedMeta : normalizedTranscript;
  const longer  = normalizedMeta.length >  normalizedTranscript.length ? normalizedMeta : normalizedTranscript;

  if (longer.includes(shorter) && shorter.length >= longer.length * 0.7) {
    return true;
  }

  // Check if significant words match
  const metaWords = normalizedMeta.split(' ').filter(w => w.length > 2);
  const transWords = normalizedTranscript.split(' ').filter(w => w.length > 2);

  if (metaWords.length > 0 && transWords.length > 0) {
    const matchingWords = metaWords.filter(w => transWords.includes(w));
    const matchRatio = matchingWords.length / Math.max(metaWords.length, transWords.length);
    // Require at least 60% of the LARGER word set to match (not just the smaller)
    if (matchRatio >= 0.6) {
      return true;
    }
  }

  return false;
}

/**
 * GET /api/coverage
 * Returns transcript coverage information comparing metadata to available transcripts
 */
export async function GET() {
  noStore();
  const metadata = loadEpisodeMetadata();
  const latestSeason = Math.max(...metadata.map(m => m.season));

  // Load all transcripts with their info
  const transcripts: TranscriptInfo[] = [];

  // Load blob transcripts — fetch directly via URL from list (avoids N+1 re-listing)
  try {
    const blobList = await listBlobTranscripts();
    const fetches = blobList.map(async (blob) => {
      try {
        const response = await fetch(blob.url, { cache: 'no-store' });
        if (!response.ok) return null;
        const transcript = await response.json() as Transcript;
        return {
          filename: `episode_${blob.episodeNumber}`,
          episodeNumber: transcript.episode_number,
          episodeName: transcript.episode_name || '',
          source: 'blob' as const,
          needsReview: hasUnmappedSpeakers(transcript),
        };
      } catch {
        return null;
      }
    });
    const results = await Promise.all(fetches);
    for (const r of results) {
      if (r) transcripts.push(r);
    }
  } catch {
    // Blob storage not available
  }

  // Build lookup maps
  const transcriptsByNumber = new Map<string, TranscriptInfo>();
  const transcriptsByName: TranscriptInfo[] = [];

  for (const t of transcripts) {
    const id = t.episodeNumber;
    // Add both numeric (>0) and string IDs (e.g. "49b1") to the lookup map
    if ((typeof id === 'number' && id > 0) || typeof id === 'string') {
      const idKey = normalizeEpisodeId(id);
      // Only add if not already present (prefer filesystem over blob)
      if (!transcriptsByNumber.has(idKey)) {
        transcriptsByNumber.set(idKey, t);
      }
    }
    transcriptsByName.push(t);
  }

  // Build coverage data
  const episodes: CoverageEpisode[] = metadata.map((ep: EpisodeMetadata) => {
    let hasTranscript = false;
    let needsReview = false;
    let transcriptSource: 'filesystem' | 'blob' | undefined;
    let transcriptFile: string | undefined;

    // Match by episode ID (works for both numeric and string IDs like "49b1")
    const epIdKey = normalizeEpisodeId(ep.episode);
    if (transcriptsByNumber.has(epIdKey)) {
      const match = transcriptsByNumber.get(epIdKey)!;
      hasTranscript = true;
      needsReview = match.needsReview;
      transcriptSource = match.source;
      transcriptFile = match.filename;
    }

    return {
      episode: ep.episode,
      film: ep.film,
      season: ep.season,
      releaseDate: ep.releaseDate,
      reviewer: ep.reviewer,
      guest: ep.guest,
      hasTranscript,
      needsReview,
      transcriptSource,
      transcriptFile,
    };
  });

  // Second pass: if ID matching failed, try matching by film/title.
  // This handles cases where transcript episode_number format drifts but title is accurate.
  // IMPORTANT: only assign to episodes that don't already have a transcript from
  // the first pass — otherwise a stray name match can corrupt an already-good episode.
  const unmatchedById = transcripts.filter(t => !episodes.some(
    ep => normalizeEpisodeId(ep.episode) === normalizeEpisodeId(t.episodeNumber)
  ));
  for (const t of unmatchedById) {
    const byNameIdx = episodes.findIndex(ep => !ep.hasTranscript && namesMatch(ep.film, t.episodeName));
    if (byNameIdx !== -1) {
      episodes[byNameIdx] = {
        ...episodes[byNameIdx],
        hasTranscript: true,
        needsReview: t.needsReview,
        transcriptSource: t.source,
        transcriptFile: t.filename,
      };
    }
  }

  // Include transcripts that still do not have metadata entries in this deployment.
  // This can happen when CI ingests/transcribes a new episode before the site is redeployed.
  const metadataEpisodeIds = new Set(episodes.map(ep => normalizeEpisodeId(ep.episode)));
  for (const t of transcripts) {
    const transcriptId = normalizeEpisodeId(t.episodeNumber);
    if (metadataEpisodeIds.has(transcriptId)) continue;
    if (episodes.some(ep => namesMatch(ep.film, t.episodeName))) continue;

    const inferredNum = parseEpisodeNumberLike(t.episodeNumber);
    let inferredSeason = 0;
    if (inferredNum !== null) {
      const nearest = metadata
        .filter(m => {
          const n = parseEpisodeNumberLike(m.episode);
          return n !== null && n <= inferredNum;
        })
        .sort((a, b) => episodeSortKey(b.episode) - episodeSortKey(a.episode))[0];
      inferredSeason = nearest?.season ?? latestSeason;
    } else {
      inferredSeason = latestSeason;
    }

    episodes.push({
      episode: t.episodeNumber,
      film: t.episodeName || `Episode ${transcriptId}`,
      season: inferredSeason,
      releaseDate: '',
      reviewer: '',
      guest: null,
      hasTranscript: true,
      needsReview: t.needsReview,
      transcriptSource: t.source,
      transcriptFile: t.filename,
    });
    metadataEpisodeIds.add(transcriptId);
  }

  // Sort by season then episode
  episodes.sort((a, b) => {
    if (a.season !== b.season) return a.season - b.season;
    return episodeSortKey(a.episode) - episodeSortKey(b.episode);
  });

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

  const needsReviewCount = episodes.filter(e => e.needsReview).length;

  const response: CoverageResponse = {
    total: episodes.length,
    withTranscripts,
    withoutTranscripts,
    needsReview: needsReviewCount,
    coveragePercent: episodes.length > 0 ? Math.round((withTranscripts / episodes.length) * 100) : 0,
    episodes,
    bySeason,
  };

  return NextResponse.json(response, {
    headers: {
      'Cache-Control': 'no-store, no-cache, must-revalidate, max-age=0',
      'x-coverage-build': process.env.VERCEL_GIT_COMMIT_SHA || 'local',
    },
  });
}
