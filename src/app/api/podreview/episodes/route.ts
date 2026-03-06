import { NextRequest, NextResponse } from 'next/server';
import { episodeMetadata } from '@/lib/metadata-data';

function checkAuth(request: NextRequest): boolean {
  const auth = request.headers.get('authorization');
  if (!auth?.startsWith('Bearer ')) return false;
  return auth.slice(7) === process.env.PODREVIEW_PASSWORD;
}

export async function GET(request: NextRequest) {
  if (!checkAuth(request)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  // Return summary list for episode picker
  const episodes = episodeMetadata.map(ep => ({
    pod: ep.pod,
    season: ep.season,
    episode: ep.episode,
    film: ep.film,
    reviewer: ep.reviewer,
    releaseDate: ep.releaseDate,
  }));

  // Sort descending by episode number for the dropdown
  episodes.sort((a, b) => {
    const aNum = typeof a.episode === 'number' ? a.episode : parseInt(String(a.episode)) || 0;
    const bNum = typeof b.episode === 'number' ? b.episode : parseInt(String(b.episode)) || 0;
    return bNum - aNum;
  });

  // Compute next episode number and latest season
  const maxEpisode = episodeMetadata.reduce((max, ep) => {
    const num = typeof ep.episode === 'number' ? ep.episode : parseInt(String(ep.episode)) || 0;
    return num > max ? num : max;
  }, 0);

  const latestSeason = episodeMetadata.reduce((max, ep) => {
    return ep.season > max ? ep.season : max;
  }, 0);

  return NextResponse.json({ episodes, nextEpisode: maxEpisode + 1, latestSeason });
}

// Load full data for a specific episode
export async function POST(request: NextRequest) {
  if (!checkAuth(request)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { episode: epId } = await request.json();
  const ep = episodeMetadata.find(e => String(e.episode) === String(epId));

  if (!ep) {
    return NextResponse.json({ error: 'Episode not found' }, { status: 404 });
  }

  return NextResponse.json({ episode: ep });
}
