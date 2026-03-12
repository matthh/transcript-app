/**
 * Patch episodes that are missing TMDB data by trying cleaned-up film names.
 * Handles: "Best of Escape Hatch: X", "Episode NNN: X", "David Lynch's X",
 * multi-film episodes ("Film A and Film B"), etc.
 *
 * Usage: node --import tsx ./scripts/patch-missing-tmdb.ts
 */

import * as fs from 'fs';
import * as path from 'path';
import dotenv from 'dotenv';
import type { EpisodeMetadata } from '@/types/episode-metadata';

dotenv.config({ path: '.env.local' });
dotenv.config({ path: '.env' });

const TMDB_API_KEY = process.env.TMDB_API_KEY;
const TMDB_BASE_URL = 'https://api.themoviedb.org/3';

if (!TMDB_API_KEY) {
  console.error('Missing TMDB_API_KEY');
  process.exit(1);
}

const metadataPath = path.join(process.cwd(), 'src/lib/metadata-data.ts');

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Extract the most likely searchable film title from a messy episode name. */
function extractSearchTitle(film: string): string {
  return film
    .replace(/^Best of Escape Hatch:\s*/i, '')
    .replace(/^Episode\s+\d+:\s*/i, '')
    .replace(/^BONUS:\s*/i, '')
    .replace(/^David Lynch's\s*/i, '')
    .replace(/^EMERGENCY EP\s*-\s*/i, '')
    .replace(/^SXSW \(\d+\) and\s*/i, '')
    .replace(/\s+and\s+.+$/i, '')      // "Film A and Film B" → "Film A"
    .replace(/\s*-\s*LIVE$/i, '')
    .replace(/\s*\([^)]+\)$/, '')      // strip trailing (year)
    .replace(/\bFINAL\b/gi, '')
    .trim();
}

async function searchMovie(title: string, year?: number | null) {
  const params = new URLSearchParams({ api_key: TMDB_API_KEY!, query: title });
  if (year) params.set('year', String(year));
  const res = await fetch(`${TMDB_BASE_URL}/search/movie?${params}`);
  if (!res.ok) return null;
  const data = await res.json() as { results?: { id: number; title: string; release_date: string }[] };
  return data.results?.[0] ?? null;
}

async function getCredits(movieId: number) {
  const res = await fetch(`${TMDB_BASE_URL}/movie/${movieId}/credits?api_key=${TMDB_API_KEY}`);
  if (!res.ok) return null;
  return res.json() as Promise<{ cast: { name: string; order: number }[]; crew: { name: string; job: string; department: string }[] }>;
}

async function getDetails(movieId: number) {
  const res = await fetch(`${TMDB_BASE_URL}/movie/${movieId}?api_key=${TMDB_API_KEY}`);
  if (!res.ok) return null;
  return res.json() as Promise<{ genres: { name: string }[]; poster_path: string | null }>;
}

async function main() {
  const src = fs.readFileSync(metadataPath, 'utf-8');
  const match = src.match(/export const episodeMetadata[^=]*=\s*(\[[\s\S]*\]);/);
  if (!match) { console.error('Could not parse metadata-data.ts'); process.exit(1); }
  const episodes: EpisodeMetadata[] = JSON.parse(match[1]);

  const missing = episodes.filter((e) => !e.tmdbId);
  console.log(`Found ${missing.length} episodes without TMDB data.\n`);

  let patched = 0;
  let skipped = 0;

  for (const episode of missing) {
    const searchTitle = extractSearchTitle(episode.film);
    if (!searchTitle || searchTitle.length < 3) {
      console.log(`  SKIP (no searchable title): ${episode.film}`);
      skipped++;
      continue;
    }

    console.log(`  Searching: "${searchTitle}" (from: "${episode.film}")`);
    const result = await searchMovie(searchTitle, episode.filmYear);
    await sleep(260);

    if (!result) {
      // Retry without year
      const retry = await searchMovie(searchTitle);
      await sleep(260);
      if (!retry) {
        console.log(`    ✗ No match`);
        skipped++;
        continue;
      }
      Object.assign(result ?? {}, retry);
      // reassign since result is null
      const found = retry;
      console.log(`    ✓ ${found.title} (${found.release_date?.slice(0, 4)})`);
      await applyEnrichment(episodes, episode, found.id);
      patched++;
      continue;
    }

    console.log(`    ✓ ${result.title} (${result.release_date?.slice(0, 4)})`);
    await applyEnrichment(episodes, episode, result.id);
    patched++;
  }

  // Save
  fs.writeFileSync(
    metadataPath,
    `// Auto-generated - do not edit - ${episodes.length} episodes - updated ${new Date().toISOString().split('T')[0]}\n` +
    `import { EpisodeMetadata } from '@/types/episode-metadata';\n` +
    `export const episodeMetadata: EpisodeMetadata[] = ${JSON.stringify(episodes, null, 2)};\n`
  );

  console.log(`\nDone. Patched: ${patched}, Skipped: ${skipped}`);
  console.log(`Saved to ${metadataPath}`);
}

async function applyEnrichment(episodes: EpisodeMetadata[], episode: EpisodeMetadata, movieId: number) {
  const [details, credits] = await Promise.all([getDetails(movieId), getCredits(movieId)]);
  await sleep(260);

  const idx = episodes.indexOf(episode);
  const enriched: EpisodeMetadata = { ...episode, tmdbId: movieId };

  if (details?.genres) enriched.genres = details.genres.map((g) => g.name);
  if (details?.poster_path) enriched.tmdbPosterPath = details.poster_path;

  if (credits) {
    const directors = credits.crew
      .filter((c) => c.job === 'Director')
      .map((c) => c.name);
    if (directors.length) enriched.directors = directors;

    const dps = credits.crew
      .filter((c) => c.job === 'Director of Photography')
      .map((c) => c.name);
    if (dps.length) enriched.cinematographers = dps;

    const cast = credits.cast
      .sort((a, b) => a.order - b.order)
      .slice(0, 10)
      .map((c) => c.name);
    if (cast.length) enriched.cast = cast;
  }

  episodes[idx] = enriched;
}

main().catch(console.error);
