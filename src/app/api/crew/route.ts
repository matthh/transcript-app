import { NextRequest, NextResponse } from 'next/server';
import { loadEpisodeMetadata } from '@/lib/metadata-store';
import { episodeSortKey } from '@/lib/episode-format';

export type CrewMatch = {
  film: string;
  episodeNumber: number | string;
  pod: string;
  season: number;
  releaseDate: string;
  roles: string[];
};

export type CrewResponse = {
  name: string;
  matches: CrewMatch[];
};

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const name = searchParams.get('name')?.trim() ?? '';

  if (!name) {
    return NextResponse.json({ error: 'Missing required parameter: name' }, { status: 400 });
  }

  const nameLower = name.toLowerCase();
  const episodes = loadEpisodeMetadata();

  // Collect matches with their roles
  const matched: { episode: (typeof episodes)[0]; roles: string[]; canonicalName: string }[] = [];

  for (const e of episodes) {
    const roles: string[] = [];
    let canonicalName = '';

    const directorMatch = e.directors?.find((d) => d.toLowerCase().includes(nameLower));
    if (directorMatch) {
      roles.push('Director');
      canonicalName = canonicalName || directorMatch;
    }

    const dpMatch = e.cinematographers?.find((c) => c.toLowerCase().includes(nameLower));
    if (dpMatch) {
      roles.push('Cinematographer');
      canonicalName = canonicalName || dpMatch;
    }

    const castMatch = e.cast?.find((a) => a.toLowerCase().includes(nameLower));
    if (castMatch) {
      roles.push('Cast');
      canonicalName = canonicalName || castMatch;
    }

    if (roles.length > 0) {
      matched.push({ episode: e, roles, canonicalName });
    }
  }

  if (matched.length === 0) {
    return NextResponse.json(
      { error: `No episodes found with crew member matching "${name}"` },
      { status: 404 }
    );
  }

  // Sort ascending by season/episode
  matched.sort(
    (a, b) =>
      a.episode.season * 1000 +
      episodeSortKey(a.episode.episode) -
      (b.episode.season * 1000 + episodeSortKey(b.episode.episode))
  );

  // Use most common canonical name
  const nameCounts = new Map<string, number>();
  for (const m of matched) {
    nameCounts.set(m.canonicalName, (nameCounts.get(m.canonicalName) ?? 0) + 1);
  }
  const resolvedName = [...nameCounts.entries()].sort((a, b) => b[1] - a[1])[0][0];

  const response: CrewResponse = {
    name: resolvedName,
    matches: matched.map((m) => ({
      film: m.episode.film,
      episodeNumber: m.episode.episode,
      pod: m.episode.pod,
      season: m.episode.season,
      releaseDate: m.episode.releaseDate,
      roles: m.roles,
    })),
  };

  return NextResponse.json(response);
}
