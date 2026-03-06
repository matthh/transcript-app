import { NextRequest, NextResponse } from 'next/server';

const TMDB_BASE_URL = 'https://api.themoviedb.org/3';

function checkAuth(request: NextRequest): boolean {
  const auth = request.headers.get('authorization');
  if (!auth?.startsWith('Bearer ')) return false;
  return auth.slice(7) === process.env.PODREVIEW_PASSWORD;
}

export async function GET(request: NextRequest) {
  if (!checkAuth(request)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const query = request.nextUrl.searchParams.get('q');
  if (!query || query.trim().length < 2) {
    return NextResponse.json({ results: [] });
  }

  const apiKey = process.env.TMDB_API_KEY;
  if (!apiKey) {
    return NextResponse.json({ error: 'TMDB_API_KEY not configured' }, { status: 500 });
  }

  const params = new URLSearchParams({
    api_key: apiKey,
    query: query.trim(),
  });

  const response = await fetch(`${TMDB_BASE_URL}/search/movie?${params}`);
  if (!response.ok) {
    return NextResponse.json({ error: 'TMDB search failed' }, { status: 502 });
  }

  const data = await response.json();
  const results = (data.results || []).slice(0, 8).map((r: Record<string, unknown>) => ({
    id: r.id,
    title: r.title,
    releaseDate: r.release_date || '',
    year: r.release_date ? String(r.release_date).slice(0, 4) : null,
    posterPath: r.poster_path ? `https://image.tmdb.org/t/p/w92${r.poster_path}` : null,
  }));

  return NextResponse.json({ results });
}

// Fetch details for a selected movie (IMDB ID, etc.)
export async function POST(request: NextRequest) {
  if (!checkAuth(request)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { tmdbId } = await request.json();
  if (!tmdbId) {
    return NextResponse.json({ error: 'tmdbId required' }, { status: 400 });
  }

  const apiKey = process.env.TMDB_API_KEY;
  if (!apiKey) {
    return NextResponse.json({ error: 'TMDB_API_KEY not configured' }, { status: 500 });
  }

  const response = await fetch(
    `${TMDB_BASE_URL}/movie/${tmdbId}?api_key=${apiKey}&append_to_response=external_ids`
  );
  if (!response.ok) {
    return NextResponse.json({ error: 'TMDB fetch failed' }, { status: 502 });
  }

  const movie = await response.json();

  // Generate Letterboxd slug from title
  const letterboxdSlug = String(movie.title || '')
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .trim();

  return NextResponse.json({
    tmdbId: movie.id,
    title: movie.title,
    year: movie.release_date ? String(movie.release_date).slice(0, 4) : null,
    imdbId: movie.imdb_id || null,
    imdbLink: movie.imdb_id ? `https://www.imdb.com/title/${movie.imdb_id}/` : '',
    letterboxdLink: letterboxdSlug ? `https://letterboxd.com/film/${letterboxdSlug}/` : '',
  });
}
