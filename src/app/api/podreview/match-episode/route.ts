import { NextRequest, NextResponse } from 'next/server';
import { checkAuth } from '@/lib/podreview-auth';

const SPOTIFY_SHOW_ID = '6qd41W3ueh2NLdKu9Xwt5G';
const PATREON_CAMPAIGN_ID = '10527831';

interface SpotifyEpisode {
  name: string;
  duration_ms: number;
  release_date: string;
  images: Array<{ url: string; width: number; height: number }>;
  external_urls: { spotify: string };
}

interface PatreonPost {
  id: string;
  title: string;
  published_at: string;
  url: string;
}

// ── Spotify: use search API for fast lookup ──

async function getSpotifyToken(): Promise<string | null> {
  const clientId = process.env.SPOTIFY_CLIENT_ID;
  const clientSecret = process.env.SPOTIFY_CLIENT_SECRET;
  if (!clientId || !clientSecret) return null;

  const res = await fetch('https://accounts.spotify.com/api/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: `grant_type=client_credentials&client_id=${clientId}&client_secret=${clientSecret}`,
  });
  if (!res.ok) return null;
  const data = await res.json();
  return data.access_token || null;
}

async function searchSpotifyEpisode(
  token: string,
  query: string
): Promise<SpotifyEpisode | null> {
  // Use Spotify search API — single request, fast
  const searchQuery = `${query} show:Escape Hatch`;
  const params = new URLSearchParams({
    q: searchQuery,
    type: 'episode',
    limit: '10',
  });

  const res = await fetch(`https://api.spotify.com/v1/search?${params}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) return null;

  const data = await res.json();
  const episodes: SpotifyEpisode[] = data.episodes?.items || [];

  // Filter to our show and find best title match
  let bestScore = 0.5;
  let bestEp: SpotifyEpisode | null = null;

  for (const ep of episodes) {
    if (isVideoOrUncut(ep.name)) continue;
    const score = scoreMatch(query, ep.name);
    if (score > bestScore) {
      bestScore = score;
      bestEp = ep;
    }
  }

  return bestEp;
}

// ── Patreon: paginate but with timeout guard ──

async function matchPatreonPost(query: string): Promise<PatreonPost | null> {
  const token = process.env.PATREON_CREATOR_TOKEN;
  if (!token) return null;

  let bestScore = 0.5;
  let bestPost: PatreonPost | null = null;

  let nextUrl: string | null =
    `https://www.patreon.com/api/oauth2/v2/campaigns/${PATREON_CAMPAIGN_ID}/posts?fields%5Bpost%5D=title,published_at,url&page%5Bcount%5D=50`;

  let pages = 0;
  const maxPages = 8; // 400 posts max, ~8 requests

  while (nextUrl && pages < maxPages) {
    const fetchUrl = nextUrl;
    const res: Response = await fetch(fetchUrl, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) break;
    const data = await res.json();

    for (const post of data.data || []) {
      const title = post.attributes?.title || '';
      if (isVideoOrUncut(title)) continue;
      const score = scoreMatch(query, title);
      if (score > bestScore) {
        bestScore = score;
        bestPost = {
          id: post.id,
          title,
          published_at: post.attributes.published_at || '',
          url: post.attributes.url || '',
        };
        // Perfect match — no need to keep paginating
        if (score >= 1.0) return bestPost;
      }
    }

    nextUrl = data.links?.next || null;
    pages++;
  }

  return bestPost;
}

// ── Matching logic ──

function normalizeTitle(title: string): string {
  return title
    .toLowerCase()
    .replace(/\s*\(\d{4}\)\s*/g, ' ')
    .replace(/[^a-z0-9\s]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function isVideoOrUncut(title: string): boolean {
  const upper = title.toUpperCase();
  return upper.includes('VIDEO') || upper.includes('UNCUT');
}

function scoreMatch(query: string, candidate: string): number {
  const q = normalizeTitle(query);
  const c = normalizeTitle(candidate);
  if (q === c) return 1.0;
  if (c.includes(q) || q.includes(c)) return 0.8;
  const qWords = q.split(' ').filter(Boolean);
  const cWords = new Set(c.split(' ').filter(Boolean));
  const overlap = qWords.filter(w => cWords.has(w)).length;
  return overlap / Math.max(qWords.length, 1);
}

function formatDuration(ms: number): string {
  const totalSec = Math.floor(ms / 1000);
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;
  return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

function formatDurationMinutes(ms: number): string {
  return String(Math.round(ms / 60000));
}

export async function GET(request: NextRequest) {
  if (!checkAuth(request)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const query = request.nextUrl.searchParams.get('q');
  if (!query || query.trim().length < 2) {
    return NextResponse.json({ error: 'Query too short' }, { status: 400 });
  }

  // Run Spotify search and Patreon match in parallel
  const [spotifyToken, patreonMatch] = await Promise.all([
    getSpotifyToken(),
    matchPatreonPost(query),
  ]);

  const result: {
    spotify: {
      title: string;
      duration: string;
      durationMinutes: string;
      releaseDate: string;
      artworkUrl: string;
      spotifyUrl: string;
    } | null;
    patreon: {
      title: string;
      publishedAt: string;
      showLink: string;
    } | null;
  } = { spotify: null, patreon: null };

  // ── Spotify ──
  if (spotifyToken) {
    const ep = await searchSpotifyEpisode(spotifyToken, query);
    if (ep) {
      result.spotify = {
        title: ep.name,
        duration: formatDuration(ep.duration_ms),
        durationMinutes: formatDurationMinutes(ep.duration_ms),
        releaseDate: ep.release_date,
        artworkUrl: ep.images?.[0]?.url || '',
        spotifyUrl: ep.external_urls?.spotify || '',
      };
    }
  }

  // ── Patreon ──
  if (patreonMatch) {
    result.patreon = {
      title: patreonMatch.title,
      publishedAt: patreonMatch.published_at,
      showLink: `https://www.patreon.com${patreonMatch.url}`,
    };
  }

  return NextResponse.json(result);
}
