import { NextRequest, NextResponse } from 'next/server';
import { findEpisodesByFilm, loadEpisodeMetadata } from '@/lib/metadata-store';

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

function isBlank(v: string | null | undefined): boolean {
  return !v || v.trim() === '' || v.trim().toUpperCase() === 'N/A';
}

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const film = searchParams.get('film')?.trim() ?? '';
  const episodeParam = searchParams.get('episode')?.trim() ?? '';

  if (!film && !episodeParam) {
    return NextResponse.json({ error: 'Missing required parameter: film or episode' }, { status: 400 });
  }

  let episode = null;
  if (episodeParam) {
    const epNum = Number(episodeParam);
    if (!Number.isInteger(epNum) || epNum <= 0) {
      return NextResponse.json({ error: `Invalid episode number "${episodeParam}"` }, { status: 400 });
    }
    episode = loadEpisodeMetadata().find((e) => e.episode === epNum) ?? null;
    if (!episode) {
      return NextResponse.json({ error: `No episode found for episode #${epNum}` }, { status: 404 });
    }
  } else {
    episode = findEpisodesByFilm(film)[0] ?? null;
    if (!episode) {
      return NextResponse.json(
        { error: `No episode found for film "${film}"` },
        { status: 404 }
      );
    }
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
