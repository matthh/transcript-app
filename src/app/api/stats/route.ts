import { NextRequest, NextResponse } from 'next/server';
import { loadEpisodeMetadata } from '@/lib/metadata-store';
import type { EpisodeMetadata } from '@/types/episode-metadata';

export type StatsResponse = {
  film: string;
  episodeNumber: number | string | null;
  pod: string;
  season: number;
  releaseDate: string;
  guest: string | null;
  mmmCount: number;
  thatsGreatCount: number;
  notableMoments: string | null;
  showLink: string | null;
};

function normalizeFilmName(name: string): string {
  return name
    .replace(/^Episode\s+\d+:\s*/i, '')
    .replace(/\s*\([^)]+\)/g, '')
    .replace(/\bFINAL\b/gi, '')
    .trim();
}

function isBlank(v: string | null | undefined): boolean {
  return !v || v.trim() === '' || v.trim().toUpperCase() === 'N/A';
}

function findMatchingEpisode(filmQuery: string): EpisodeMetadata | null {
  const episodes = loadEpisodeMetadata();
  const queryLower = filmQuery.toLowerCase();
  const normalizedQuery = normalizeFilmName(filmQuery).toLowerCase();

  return (
    episodes.find((e) => e.film.toLowerCase() === queryLower) ||
    episodes.find((e) => normalizeFilmName(e.film).toLowerCase() === normalizedQuery) ||
    episodes.find((e) => normalizeFilmName(e.film).toLowerCase().includes(normalizedQuery)) ||
    null
  );
}

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const film = searchParams.get('film')?.trim() ?? '';

  if (!film) {
    return NextResponse.json({ error: 'Missing required parameter: film' }, { status: 400 });
  }

  const episode = findMatchingEpisode(film);

  if (!episode) {
    return NextResponse.json(
      { error: `No episode found for film "${film}"` },
      { status: 404 }
    );
  }

  const response: StatsResponse = {
    film: episode.film,
    episodeNumber: episode.episode,
    pod: episode.pod,
    season: episode.season,
    releaseDate: episode.releaseDate,
    guest: isBlank(episode.guest) || episode.guest?.toLowerCase() === 'none' ? null : episode.guest,
    mmmCount: episode.mmmCount,
    thatsGreatCount: episode.thatsGreatCount,
    notableMoments: isBlank(episode.notableMoments) ? null : episode.notableMoments!.trim(),
    showLink: isBlank(episode.showLink) ? null : episode.showLink,
  };

  return NextResponse.json(response);
}
