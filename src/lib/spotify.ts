/**
 * Spotify Web API client for soundtrack lookups.
 * Uses Client Credentials flow (no user OAuth needed).
 */

export interface SpotifyTrack {
  name: string;
  artist: string;
  trackUrl: string;
  durationMs: number;
}

export interface SpotifyResult {
  albumUrl: string;
  albumName: string;
  albumArt: string | null;
  topTracks: SpotifyTrack[];
}

// In-memory token cache
let cachedToken: { token: string; expiresAt: number } | null = null;

// In-memory soundtrack result cache (24h TTL)
const soundtrackCache = new Map<string, { result: SpotifyResult | null; cachedAt: number }>();
const CACHE_TTL_MS = 24 * 60 * 60 * 1000;

async function getSpotifyToken(): Promise<string | null> {
  const clientId = process.env.SPOTIFY_CLIENT_ID;
  const clientSecret = process.env.SPOTIFY_CLIENT_SECRET;

  if (!clientId || !clientSecret) {
    return null;
  }

  // Return cached token if still valid (with 60s buffer)
  if (cachedToken && Date.now() < cachedToken.expiresAt - 60_000) {
    return cachedToken.token;
  }

  try {
    const response = await fetch('https://accounts.spotify.com/api/token', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        Authorization: `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString('base64')}`,
      },
      body: 'grant_type=client_credentials',
    });

    if (!response.ok) {
      console.error('Spotify token request failed:', response.status);
      return null;
    }

    const data = await response.json();
    cachedToken = {
      token: data.access_token,
      expiresAt: Date.now() + data.expires_in * 1000,
    };
    return cachedToken.token;
  } catch (err) {
    console.error('Spotify token error:', err);
    return null;
  }
}

export async function searchSoundtrack(
  filmTitle: string,
  filmYear: number | null
): Promise<SpotifyResult | null> {
  // Check cache
  const cacheKey = `${filmTitle}|${filmYear}`;
  const cached = soundtrackCache.get(cacheKey);
  if (cached && Date.now() - cached.cachedAt < CACHE_TTL_MS) {
    return cached.result;
  }

  const token = await getSpotifyToken();
  if (!token) {
    return null;
  }

  try {
    // Search for soundtrack album
    const query = `${filmTitle} soundtrack`;
    const searchUrl = `https://api.spotify.com/v1/search?q=${encodeURIComponent(query)}&type=album&limit=10`;

    const searchRes = await fetch(searchUrl, {
      headers: { Authorization: `Bearer ${token}` },
    });

    if (!searchRes.ok) {
      console.error('Spotify search failed:', searchRes.status);
      soundtrackCache.set(cacheKey, { result: null, cachedAt: Date.now() });
      return null;
    }

    const searchData = await searchRes.json();
    const albums = searchData.albums?.items;

    if (!albums || albums.length === 0) {
      soundtrackCache.set(cacheKey, { result: null, cachedAt: Date.now() });
      return null;
    }

    // Find best match: prefer albums starting with film title, with "soundtrack" in name,
    // and released near the film year
    const titleLower = filmTitle.toLowerCase();
    const scored = albums.map((album: { name: string; album_type: string; release_date?: string }) => {
      const nameLower = album.name.toLowerCase();
      let score = 0;
      if (nameLower.includes('soundtrack') || nameLower.includes('original motion picture')) score += 3;
      // Strong boost for album name starting with the film title (avoids partial substring matches)
      if (nameLower.startsWith(titleLower)) score += 4;
      else if (nameLower.includes(titleLower)) score += 1;
      if (album.album_type === 'compilation') score += 1;
      // Boost albums released within a few years of the film
      if (filmYear && album.release_date) {
        const albumYear = parseInt(album.release_date.substring(0, 4), 10);
        if (!isNaN(albumYear)) {
          const yearDiff = Math.abs(albumYear - filmYear);
          if (yearDiff <= 2) score += 3;
          else if (yearDiff <= 10) score += 1;
        }
      }
      return { album, score };
    });
    scored.sort((a: { score: number }, b: { score: number }) => b.score - a.score);

    const bestAlbum = scored[0].album;

    // Fetch tracks
    const tracksUrl = `https://api.spotify.com/v1/albums/${bestAlbum.id}/tracks?limit=10`;
    const tracksRes = await fetch(tracksUrl, {
      headers: { Authorization: `Bearer ${token}` },
    });

    if (!tracksRes.ok) {
      console.error('Spotify tracks fetch failed:', tracksRes.status);
      soundtrackCache.set(cacheKey, { result: null, cachedAt: Date.now() });
      return null;
    }

    const tracksData = await tracksRes.json();
    const topTracks: SpotifyTrack[] = (tracksData.items || []).map(
      (track: { name: string; artists: { name: string }[]; external_urls: { spotify: string }; duration_ms: number }) => ({
        name: track.name,
        artist: track.artists.map((a: { name: string }) => a.name).join(', '),
        trackUrl: track.external_urls.spotify,
        durationMs: track.duration_ms,
      })
    );

    const albumArt = bestAlbum.images?.[0]?.url ?? null;

    const result: SpotifyResult = {
      albumUrl: bestAlbum.external_urls.spotify,
      albumName: bestAlbum.name,
      albumArt,
      topTracks,
    };

    soundtrackCache.set(cacheKey, { result, cachedAt: Date.now() });
    return result;
  } catch (err) {
    console.error('Spotify search error:', err);
    soundtrackCache.set(cacheKey, { result: null, cachedAt: Date.now() });
    return null;
  }
}
