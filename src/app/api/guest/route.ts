import { NextRequest, NextResponse } from 'next/server';
import { loadEpisodeMetadata } from '@/lib/metadata-store';
import { episodeSortKey } from '@/lib/episode-format';

export type GuestEpisode = {
  film: string;
  episodeNumber: number | string;
  pod: string;
  season: number;
  releaseDate: string;
};

export type GuestResponse = {
  guest: string;
  episodes: GuestEpisode[];
};

const BLANK_GUESTS = new Set(['none', 'n/a', '', 'na']);

function isBlankGuest(g: string | null): boolean {
  return !g || BLANK_GUESTS.has(g.trim().toLowerCase());
}

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const name = searchParams.get('name')?.trim() ?? '';

  if (!name) {
    return NextResponse.json({ error: 'Missing required parameter: name' }, { status: 400 });
  }

  const nameLower = name.toLowerCase();
  const episodes = loadEpisodeMetadata();

  const matched = episodes
    .filter((e) => !isBlankGuest(e.guest) && e.guest!.toLowerCase().includes(nameLower))
    .sort(
      (a, b) =>
        a.season * 1000 + episodeSortKey(a.episode) - (b.season * 1000 + episodeSortKey(b.episode))
    );

  if (matched.length === 0) {
    return NextResponse.json(
      { error: `No episodes found with guest matching "${name}"` },
      { status: 404 }
    );
  }

  // Use the most common spelling of the guest name from the data
  const guestName = matched[0].guest!;

  const response: GuestResponse = {
    guest: guestName,
    episodes: matched.map((e) => ({
      film: e.film,
      episodeNumber: e.episode,
      pod: e.pod,
      season: e.season,
      releaseDate: e.releaseDate,
    })),
  };

  return NextResponse.json(response);
}
