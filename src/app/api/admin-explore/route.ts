import { NextRequest, NextResponse } from 'next/server';
import * as fs from 'fs';
import * as path from 'path';
import { checkAuth } from '@/lib/podreview-auth';

const DATA_PATH = path.join(process.cwd(), 'data', 'episode-metadata.json');

interface Episode {
  pod: string;
  season: number;
  episode: number;
  film: string;
  filmYear?: number | null;
  guest: string;
  artworkLink?: string;
  tmdbId?: number;
  tmdbPosterPath?: string;
  genres?: string[];
  directors?: string[];
  cast?: string[];
  [key: string]: unknown;
}

function loadEpisodes(): Episode[] {
  try {
    return JSON.parse(fs.readFileSync(DATA_PATH, 'utf-8'));
  } catch {
    return [];
  }
}

function saveEpisodes(data: Episode[]) {
  fs.writeFileSync(DATA_PATH, JSON.stringify(data, null, 2) + '\n');
}

export async function GET() {
  const episodes = loadEpisodes();
  const summary = episodes.map((ep, index) => ({
    index,
    pod: ep.pod,
    season: ep.season,
    episode: ep.episode,
    film: ep.film,
    filmYear: ep.filmYear ?? null,
    guest: ep.guest,
    artworkLink: ep.artworkLink ?? null,
    tmdbId: ep.tmdbId ?? null,
    tmdbPosterPath: ep.tmdbPosterPath ?? null,
    genres: ep.genres ?? [],
    directors: ep.directors ?? [],
    cast: ep.cast ?? [],
  }));
  return NextResponse.json(summary);
}

export async function POST(request: NextRequest) {
  if (!checkAuth(request)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const body = await request.json();
    const { index, updates } = body as {
      index: number;
      updates: {
        genres?: string[];
        artworkLink?: string;
        tmdbId?: number | null;
        tmdbPosterPath?: string | null;
      };
    };

    if (typeof index !== 'number' || !updates) {
      return NextResponse.json({ error: 'Missing index or updates' }, { status: 400 });
    }

    const episodes = loadEpisodes();
    if (index < 0 || index >= episodes.length) {
      return NextResponse.json({ error: 'Invalid episode index' }, { status: 400 });
    }

    const ep = episodes[index];

    if (updates.genres !== undefined) {
      ep.genres = updates.genres;
    }
    if (updates.artworkLink !== undefined) {
      ep.artworkLink = updates.artworkLink;
    }
    if (updates.tmdbId !== undefined) {
      if (updates.tmdbId === null) {
        delete ep.tmdbId;
      } else {
        ep.tmdbId = updates.tmdbId;
      }
    }
    if (updates.tmdbPosterPath !== undefined) {
      if (updates.tmdbPosterPath === null) {
        delete ep.tmdbPosterPath;
      } else {
        ep.tmdbPosterPath = updates.tmdbPosterPath;
      }
    }

    saveEpisodes(episodes);

    return NextResponse.json({ ok: true, episode: {
      index,
      film: ep.film,
      genres: ep.genres ?? [],
      artworkLink: ep.artworkLink ?? null,
      tmdbId: ep.tmdbId ?? null,
      tmdbPosterPath: ep.tmdbPosterPath ?? null,
    }});
  } catch (err) {
    return NextResponse.json({ error: 'Failed to save' }, { status: 500 });
  }
}
