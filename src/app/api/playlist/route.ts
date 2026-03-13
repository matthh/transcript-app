import { NextRequest, NextResponse } from 'next/server';
import { list } from '@vercel/blob';
import { normalizeEpisodeTitle } from '@/lib/hybrid-retrieval';
import { queryEpisodes } from '@/lib/metadata-store';
import { searchSoundtrack, SpotifyResult } from '@/lib/spotify';

interface SongMention {
  song: string;
  artist: string;
  context: string;
  quote: string;
  timestamp: string;
}

interface PlaylistData {
  episodes: Record<string, { episodeNumber: number | null; songs: SongMention[] }>;
}

export interface PlaylistResponse {
  film: string;
  episodeNumber: number | null;
  mentionedSongs: SongMention[];
  soundtrack: SpotifyResult | null;
}

// In-memory cache for playlist data (persists across requests in same Lambda)
let cachedPlaylistData: PlaylistData | null = null;
let playlistLoadPromise: Promise<PlaylistData | null> | null = null;

const SEARCH_DATA_PREFIX = 'search-data/';

async function loadPlaylistData(): Promise<PlaylistData | null> {
  if (cachedPlaylistData !== null) return cachedPlaylistData;
  if (playlistLoadPromise !== null) return playlistLoadPromise;

  playlistLoadPromise = (async () => {
    try {
      const blobs = await list({ prefix: `${SEARCH_DATA_PREFIX}playlist-data.json` });
      const match = blobs.blobs.find(b => b.pathname === `${SEARCH_DATA_PREFIX}playlist-data.json`);

      if (!match) {
        console.warn('playlist-data.json not found in Blob storage');
        return null;
      }

      const response = await fetch(match.url);
      if (!response.ok) {
        console.error('Failed to fetch playlist data:', response.status);
        return null;
      }

      cachedPlaylistData = await response.json();
      return cachedPlaylistData;
    } catch (error) {
      console.error('Error loading playlist data:', error);
      return null;
    } finally {
      playlistLoadPromise = null;
    }
  })();

  return playlistLoadPromise;
}

function findFilmInPlaylist(
  playlistData: PlaylistData,
  filmQuery: string
): { key: string; data: { episodeNumber: number | null; songs: SongMention[] } } | null {
  const normalizedQuery = normalizeEpisodeTitle(filmQuery);

  // Direct match first
  for (const [key, data] of Object.entries(playlistData.episodes)) {
    if (normalizeEpisodeTitle(key) === normalizedQuery) {
      return { key, data };
    }
  }

  // Combine multi-part episodes: look for keys starting with the query
  const parts: SongMention[] = [];
  let episodeNumber: number | null = null;
  let matchedKey = '';

  for (const [key, data] of Object.entries(playlistData.episodes)) {
    const normalizedKey = normalizeEpisodeTitle(key);
    // Check if key starts with the query (handles "Film Part 1", "Film Part 2")
    if (normalizedKey.startsWith(normalizedQuery) || normalizedQuery.startsWith(normalizedKey)) {
      parts.push(...data.songs);
      if (data.episodeNumber !== null) episodeNumber = data.episodeNumber;
      if (!matchedKey) matchedKey = key;
    }
  }

  if (parts.length > 0) {
    return { key: matchedKey, data: { episodeNumber, songs: parts } };
  }

  return null;
}

export async function GET(request: NextRequest) {
  const film = request.nextUrl.searchParams.get('film');

  if (!film) {
    return NextResponse.json({ error: 'Missing film parameter' }, { status: 400 });
  }

  const playlistData = await loadPlaylistData();

  // Find songs from pre-extracted data
  let mentionedSongs: SongMention[] = [];
  let episodeNumber: number | null = null;
  let canonicalFilm = film;

  if (playlistData) {
    const match = findFilmInPlaylist(playlistData, film);
    if (match) {
      mentionedSongs = match.data.songs;
      episodeNumber = match.data.episodeNumber;
      canonicalFilm = match.key;
    }
  }

  // Look up metadata for filmYear and episodeNumber
  // Prefer exact title match over loose substring match
  let filmYear: number | null = null;
  const metaResult = queryEpisodes({ film });
  if (metaResult.episodes.length > 0) {
    const normalizedQuery = normalizeEpisodeTitle(film);
    const exactMatch = metaResult.episodes.find(
      e => normalizeEpisodeTitle(e.film) === normalizedQuery
    );
    const ep = exactMatch ?? metaResult.episodes[0];
    filmYear = ep.filmYear;
    if (episodeNumber === null) episodeNumber = ep.episode as number;
    canonicalFilm = ep.film;
  }

  // Look up Spotify soundtrack
  const soundtrack = await searchSoundtrack(canonicalFilm.replace(/\s*\(\d{4}\)/g, ''), filmYear);

  // 404 if neither source has results
  if (mentionedSongs.length === 0 && !soundtrack) {
    return NextResponse.json(
      { error: `No music references found for "${film}"` },
      { status: 404 }
    );
  }

  const response: PlaylistResponse = {
    film: canonicalFilm,
    episodeNumber,
    mentionedSongs,
    soundtrack,
  };

  return NextResponse.json(response);
}
