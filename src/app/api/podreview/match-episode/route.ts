import { NextRequest, NextResponse } from 'next/server';

const PATREON_CAMPAIGN_ID = '10527831';
const SPOTIFY_SHOW_ID = '6qd41W3ueh2NLdKu9Xwt5G';

function checkAuth(request: NextRequest): boolean {
  const auth = request.headers.get('authorization');
  if (!auth?.startsWith('Bearer ')) return false;
  return auth.slice(7) === process.env.PODREVIEW_PASSWORD;
}

// ── Spotify helpers ──

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

interface SpotifyEpisode {
  name: string;
  duration_ms: number;
  release_date: string;
  images: Array<{ url: string; width: number; height: number }>;
  external_urls: { spotify: string };
}

async function searchSpotifyEpisodes(
  token: string,
  query: string
): Promise<SpotifyEpisode[]> {
  // Fetch recent episodes and match by title
  // Spotify show episodes endpoint returns in reverse chronological order
  const allEpisodes: SpotifyEpisode[] = [];
  let offset = 0;
  const limit = 50;

  // Fetch up to 200 episodes (4 pages) to have a good matching pool
  while (offset < 200) {
    const res = await fetch(
      `https://api.spotify.com/v1/shows/${SPOTIFY_SHOW_ID}/episodes?limit=${limit}&offset=${offset}`,
      { headers: { Authorization: `Bearer ${token}` } }
    );
    if (!res.ok) break;
    const data = await res.json();
    const items: SpotifyEpisode[] = data.items || [];
    if (items.length === 0) break;
    allEpisodes.push(...items);
    if (!data.next) break;
    offset += limit;
  }

  return allEpisodes;
}

// ── Patreon helpers ──

interface PatreonPost {
  id: string;
  title: string;
  published_at: string;
  url: string;
}

async function fetchPatreonPosts(): Promise<PatreonPost[]> {
  const token = process.env.PATREON_CREATOR_TOKEN;
  if (!token) return [];

  const allPosts: PatreonPost[] = [];
  let nextUrl: string | null =
    `https://www.patreon.com/api/oauth2/v2/campaigns/${PATREON_CAMPAIGN_ID}/posts?fields%5Bpost%5D=title,published_at,url&page%5Bcount%5D=50`;

  while (nextUrl && allPosts.length < 400) {
    const fetchUrl = nextUrl;
    const res: Response = await fetch(fetchUrl, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) break;
    const data = await res.json();
    for (const post of data.data || []) {
      allPosts.push({
        id: post.id,
        title: post.attributes.title || '',
        published_at: post.attributes.published_at || '',
        url: post.attributes.url || '',
      });
    }
    nextUrl = data.links?.next || null;
  }

  return allPosts;
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
  // Word overlap
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

  // Fetch from both sources in parallel
  const spotifyTokenPromise = getSpotifyToken();
  const patreonPostsPromise = fetchPatreonPosts();

  const [spotifyToken, patreonPosts] = await Promise.all([
    spotifyTokenPromise,
    patreonPostsPromise,
  ]);

  const result: {
    spotify: {
      title: string;
      duration: string;
      durationMinutes: string;
      releaseDate: string;
      artworkUrl: string;
      spotifyUrl: string;
      score: number;
    } | null;
    patreon: {
      title: string;
      publishedAt: string;
      showLink: string;
      score: number;
    } | null;
  } = { spotify: null, patreon: null };

  // ── Match Spotify ──
  if (spotifyToken) {
    const episodes = await searchSpotifyEpisodes(spotifyToken, query);
    let bestScore = 0.5; // minimum threshold
    let bestEp: SpotifyEpisode | null = null;

    for (const ep of episodes) {
      if (isVideoOrUncut(ep.name)) continue;
      const score = scoreMatch(query, ep.name);
      if (score > bestScore) {
        bestScore = score;
        bestEp = ep;
      }
    }

    if (bestEp) {
      const artwork = bestEp.images?.[0]?.url || '';
      result.spotify = {
        title: bestEp.name,
        duration: formatDuration(bestEp.duration_ms),
        durationMinutes: formatDurationMinutes(bestEp.duration_ms),
        releaseDate: bestEp.release_date,
        artworkUrl: artwork,
        spotifyUrl: bestEp.external_urls?.spotify || '',
        score: bestScore,
      };
    }
  }

  // ── Match Patreon ──
  {
    let bestScore = 0.5;
    let bestPost: PatreonPost | null = null;

    for (const post of patreonPosts) {
      if (isVideoOrUncut(post.title)) continue;
      const score = scoreMatch(query, post.title);
      if (score > bestScore) {
        bestScore = score;
        bestPost = post;
      }
    }

    if (bestPost) {
      result.patreon = {
        title: bestPost.title,
        publishedAt: bestPost.published_at,
        showLink: `https://www.patreon.com${bestPost.url}`,
        score: bestScore,
      };
    }
  }

  return NextResponse.json(result);
}
