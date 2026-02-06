import { NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';
import { loadEpisodeMetadata } from '@/lib/metadata-store';
import { listBlobTranscripts, loadTranscript as loadBlobTranscript } from '@/lib/blob-storage';
import type { EpisodeMetadata } from '@/types/episode-metadata';
import type { Transcript } from '@/types/transcript';

export interface CoverageEpisode {
  episode: number;
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
 */
const UNMAPPED_SPEAKER_PATTERN = /^(Speaker\s*)?[A-Z]$/i;

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
    .replace(/bonus\s*/gi, '')
    .replace(/on deck\s*-?\s*/gi, '')
    .replace(/episode\s*\d+\s*:?\s*/gi, '')
    .replace(/special edition/gi, '')
    .trim();
}

/**
 * Check if two names match (fuzzy)
 */
function namesMatch(metadataFilm: string, transcriptName: string): boolean {
  const normalizedMeta = normalizeName(metadataFilm);
  const normalizedTranscript = normalizeName(transcriptName);

  // Exact match after normalization
  if (normalizedMeta === normalizedTranscript) return true;

  // One contains the other
  if (normalizedMeta.includes(normalizedTranscript) || normalizedTranscript.includes(normalizedMeta)) return true;

  // Check if significant words match
  const metaWords = normalizedMeta.split(' ').filter(w => w.length > 2);
  const transWords = normalizedTranscript.split(' ').filter(w => w.length > 2);

  if (metaWords.length > 0 && transWords.length > 0) {
    const matchingWords = metaWords.filter(w => transWords.includes(w));
    // If most words match, consider it a match
    if (matchingWords.length >= Math.min(metaWords.length, transWords.length) * 0.6) {
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
  const metadata = loadEpisodeMetadata();

  // Load all transcripts with their info
  const transcripts: TranscriptInfo[] = [];
  const transcriptsDir = path.join(process.cwd(), 'transcripts');

  // Load filesystem transcripts
  try {
    if (fs.existsSync(transcriptsDir)) {
      const files = fs.readdirSync(transcriptsDir).filter(f => f.endsWith('.json'));
      for (const filename of files) {
        try {
          const filePath = path.join(transcriptsDir, filename);
          const content = JSON.parse(fs.readFileSync(filePath, 'utf-8')) as Transcript;
          transcripts.push({
            filename: filename.replace('.json', ''),
            episodeNumber: content.episode_number,
            episodeName: content.episode_name || '',
            source: 'filesystem',
            needsReview: hasUnmappedSpeakers(content),
          });
        } catch {
          // Skip unparseable files
        }
      }
    }
  } catch {
    // Directory doesn't exist
  }

  // Load blob transcripts
  try {
    const blobList = await listBlobTranscripts();
    for (const blob of blobList) {
      try {
        const transcript = await loadBlobTranscript(blob.episodeNumber);
        if (transcript) {
          transcripts.push({
            filename: `episode_${blob.episodeNumber}`,
            episodeNumber: transcript.episode_number,
            episodeName: transcript.episode_name || '',
            source: 'blob',
            needsReview: hasUnmappedSpeakers(transcript),
          });
        }
      } catch {
        // Skip
      }
    }
  } catch {
    // Blob storage not available
  }

  // Build lookup maps
  const transcriptsByNumber = new Map<number, TranscriptInfo>();
  const transcriptsByName: TranscriptInfo[] = [];

  for (const t of transcripts) {
    if (typeof t.episodeNumber === 'number' && t.episodeNumber > 0) {
      transcriptsByNumber.set(t.episodeNumber, t);
    }
    transcriptsByName.push(t);
  }

  // Build coverage data
  const episodes: CoverageEpisode[] = metadata.map((ep: EpisodeMetadata) => {
    let hasTranscript = false;
    let needsReview = false;
    let transcriptSource: 'filesystem' | 'blob' | undefined;
    let transcriptFile: string | undefined;

    // Try to match by episode number first (for regular episodes)
    if (ep.episode > 0 && transcriptsByNumber.has(ep.episode)) {
      const match = transcriptsByNumber.get(ep.episode)!;
      hasTranscript = true;
      needsReview = match.needsReview;
      transcriptSource = match.source;
      transcriptFile = match.filename;
    }
    // For bonus episodes (episode=0) or if no match, try to match by name
    else {
      for (const t of transcriptsByName) {
        if (namesMatch(ep.film, t.episodeName)) {
          hasTranscript = true;
          needsReview = t.needsReview;
          transcriptSource = t.source;
          transcriptFile = t.filename;
          break;
        }
      }
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

  // Sort by season then episode
  episodes.sort((a, b) => {
    if (a.season !== b.season) return a.season - b.season;
    return a.episode - b.episode;
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

  return NextResponse.json(response);
}
