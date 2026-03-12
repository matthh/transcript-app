import {
  EpisodeMetadata,
  QueryFilters,
  MetadataQueryResult,
  PaginationOptions,
} from '@/types/episode-metadata';
import { episodeMetadata } from './metadata-data';
import { EpisodeId, episodeSortKey } from './episode-format';

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 200;

// Cache for normalized metadata
let normalizedMetadata: EpisodeMetadata[] | null = null;

export function loadEpisodeMetadata(): EpisodeMetadata[] {
  if (normalizedMetadata) {
    return normalizedMetadata;
  }

  // Find the latest season (excluding season 0)
  const latestSeason = Math.max(...episodeMetadata.filter(e => e.season > 0).map(e => e.season));

  // Normalize: replace season 0 with latest season
  normalizedMetadata = episodeMetadata.map(e => {
    if (e.season === 0) {
      return { ...e, season: latestSeason };
    }
    return e;
  });

  return normalizedMetadata;
}

/**
 * Query episodes with filtering, sorting, and pagination.
 * Always returns deterministic results sorted by the specified field.
 */
export function queryEpisodes(
  filters: QueryFilters,
  pagination: PaginationOptions = {}
): MetadataQueryResult {
  const episodes = loadEpisodeMetadata();
  const matchedFilters: string[] = [];

  let filtered = episodes;

  // Apply filters
  if (filters.decade !== undefined) {
    const decadeStart = filters.decade;
    const decadeEnd = decadeStart + 9;
    filtered = filtered.filter(
      (e) => e.filmYear !== null && e.filmYear >= decadeStart && e.filmYear <= decadeEnd
    );
    matchedFilters.push(`decade:${filters.decade}s`);
  }

  if (filters.yearRange !== undefined) {
    filtered = filtered.filter(
      (e) =>
        e.filmYear !== null &&
        e.filmYear >= filters.yearRange!.min &&
        e.filmYear <= filters.yearRange!.max
    );
    matchedFilters.push(
      `year:${filters.yearRange.min}-${filters.yearRange.max}`
    );
  }

  if (filters.season !== undefined) {
    filtered = filtered.filter((e) => e.season === filters.season);
    matchedFilters.push(`season:${filters.season}`);
  }

  if (filters.guest !== undefined) {
    const guestLower = filters.guest.toLowerCase();
    filtered = filtered.filter(
      (e) => e.guest !== null && e.guest.toLowerCase().includes(guestLower)
    );
    matchedFilters.push(`guest:${filters.guest}`);
  }

  if (filters.film !== undefined) {
    const filmLower = filters.film.toLowerCase();
    filtered = filtered.filter((e) =>
      e.film.toLowerCase().includes(filmLower) ||
      (e.notableMoments && e.notableMoments.toLowerCase().includes(filmLower))
    );
    matchedFilters.push(`film:${filters.film}`);
  }

  if (filters.reviewer !== undefined) {
    const reviewerLower = filters.reviewer.toLowerCase();
    filtered = filtered.filter((e) =>
      e.reviewer.toLowerCase().includes(reviewerLower)
    );
    matchedFilters.push(`reviewer:${filters.reviewer}`);
  }

  // TMDB-enriched filters
  if (filters.director !== undefined) {
    const directorLower = filters.director.toLowerCase();
    filtered = filtered.filter(
      (e) => e.directors?.some((d) => d.toLowerCase().includes(directorLower))
    );
    matchedFilters.push(`director:${filters.director}`);
  }

  if (filters.cinematographer !== undefined) {
    const dpLower = filters.cinematographer.toLowerCase();
    filtered = filtered.filter(
      (e) => e.cinematographers?.some((c) => c.toLowerCase().includes(dpLower))
    );
    matchedFilters.push(`cinematographer:${filters.cinematographer}`);
  }

  if (filters.actor !== undefined) {
    const actorLower = filters.actor.toLowerCase();
    filtered = filtered.filter(
      (e) => e.cast?.some((a) => a.toLowerCase().includes(actorLower))
    );
    matchedFilters.push(`actor:${filters.actor}`);
  }

  if (filters.genre !== undefined) {
    const genreLower = filters.genre.toLowerCase();
    filtered = filtered.filter(
      (e) => e.genres?.some((g) => g.toLowerCase().includes(genreLower))
    );
    matchedFilters.push(`genre:${filters.genre}`);
  }

  // Sort deterministically
  const sortBy = pagination.sortBy || 'episode';
  const sortOrder = pagination.sortOrder || 'desc';
  const sortMultiplier = sortOrder === 'asc' ? 1 : -1;

  filtered.sort((a, b) => {
    let comparison = 0;
    switch (sortBy) {
      case 'episode':
        // Sort by season then episode number
        comparison = (a.season * 1000 + episodeSortKey(a.episode)) - (b.season * 1000 + episodeSortKey(b.episode));
        break;
      case 'releaseDate':
        comparison = new Date(a.releaseDate).getTime() - new Date(b.releaseDate).getTime();
        break;
      case 'filmYear':
        comparison = (a.filmYear || 0) - (b.filmYear || 0);
        break;
    }
    return comparison * sortMultiplier;
  });

  // Apply pagination
  const totalCount = filtered.length;
  const limit = Math.min(pagination.limit || DEFAULT_LIMIT, MAX_LIMIT);
  const offset = pagination.offset || 0;

  const paginated = filtered.slice(offset, offset + limit);

  return {
    episodes: paginated,
    totalCount,
    returnedCount: paginated.length,
    hasMore: offset + paginated.length < totalCount,
    matchedFilters,
  };
}

export interface EpisodeStats {
  totalEpisodes: number;
  totalSeasons: number;
  episodesWithGuests: number;
  uniqueGuests: string[];
  decadeDistribution: Record<string, number>;
  reviewerDistribution: Record<string, number>;
  averageMMMCount: number;
  averageThatsGreatCount: number;
}

export type MetadataFieldKey = 'mmmCount' | 'thatsGreatCount';

export function getLatestEpisode(): EpisodeMetadata | null {
  const episodes = loadEpisodeMetadata();
  if (episodes.length === 0) {
    return null;
  }
  return [...episodes].sort(
    (a, b) => new Date(b.releaseDate).getTime() - new Date(a.releaseDate).getTime()
  )[0];
}

export function getEpisodeByNumber(episodeNumber: EpisodeId): EpisodeMetadata | null {
  const episodes = loadEpisodeMetadata();
  return episodes.find((episode) => episode.episode === episodeNumber) ?? null;
}

export function getCurrentSeason(): number | null {
  const latest = getLatestEpisode();
  return latest ? latest.season : null;
}

export function getTotalEpisodes(): number {
  return loadEpisodeMetadata().length;
}

export function countByYearRange(min: number, max: number): number {
  const episodes = loadEpisodeMetadata();
  return episodes.filter(
    (e) => e.filmYear !== null && e.filmYear >= min && e.filmYear <= max
  ).length;
}

export type YearSample = {
  year: number;
  episode: EpisodeMetadata | null;
};

export function getOneEpisodePerYear(min: number, max: number): YearSample[] {
  const episodes = loadEpisodeMetadata()
    .filter((e) => e.filmYear !== null && e.filmYear >= min && e.filmYear <= max)
    .sort((a, b) => (b.season * 1000 + episodeSortKey(b.episode)) - (a.season * 1000 + episodeSortKey(a.episode)));

  const byYear = new Map<number, EpisodeMetadata>();
  for (const episode of episodes) {
    const year = episode.filmYear as number;
    if (!byYear.has(year)) {
      byYear.set(year, episode);
    }
  }

  const results: YearSample[] = [];
  for (let year = min; year <= max; year += 1) {
    results.push({
      year,
      episode: byYear.get(year) ?? null,
    });
  }

  return results;
}

export function getEpisodeWithMaxField(field: MetadataFieldKey): EpisodeMetadata | null {
  const episodes = loadEpisodeMetadata();
  if (episodes.length === 0) {
    return null;
  }
  return episodes.reduce((maxEpisode, current) =>
    current[field] > maxEpisode[field] ? current : maxEpisode
  );
}

export function getFieldForLatestEpisode(field: MetadataFieldKey): {
  episode: EpisodeMetadata | null;
  value: number | null;
} {
  const latest = getLatestEpisode();
  if (!latest) {
    return { episode: null, value: null };
  }
  return { episode: latest, value: latest[field] };
}

export function getStats(): EpisodeStats {
  const episodes = loadEpisodeMetadata();

  const seasons = new Set(episodes.map((e) => e.season));
  const guests = episodes
    .filter((e) => e.guest !== null)
    .map((e) => e.guest as string);
  const uniqueGuests = [...new Set(guests)];

  const decadeDistribution: Record<string, number> = {};
  episodes.forEach((e) => {
    if (e.filmYear !== null) {
      const decade = `${Math.floor(e.filmYear / 10) * 10}s`;
      decadeDistribution[decade] = (decadeDistribution[decade] || 0) + 1;
    }
  });

  const reviewerDistribution: Record<string, number> = {};
  episodes.forEach((e) => {
    reviewerDistribution[e.reviewer] =
      (reviewerDistribution[e.reviewer] || 0) + 1;
  });

  const totalMMM = episodes.reduce((sum, e) => sum + e.mmmCount, 0);
  const totalThatsGreat = episodes.reduce(
    (sum, e) => sum + e.thatsGreatCount,
    0
  );

  return {
    totalEpisodes: episodes.length,
    totalSeasons: seasons.size,
    episodesWithGuests: guests.length,
    uniqueGuests,
    decadeDistribution,
    reviewerDistribution,
    averageMMMCount: episodes.length > 0 ? totalMMM / episodes.length : 0,
    averageThatsGreatCount:
      episodes.length > 0 ? totalThatsGreat / episodes.length : 0,
  };
}

export function getEpisodeByFilm(filmName: string): EpisodeMetadata | null {
  const episodes = loadEpisodeMetadata();
  const filmLower = filmName.toLowerCase();

  return (
    episodes.find((e) => e.film.toLowerCase() === filmLower) ||
    episodes.find((e) => e.film.toLowerCase().includes(filmLower)) ||
    null
  );
}

/** Strip year suffixes, "Episode NNN:" prefixes, and "FINAL" from a film name. */
export function normalizeFilmName(name: string): string {
  return name
    .replace(/^Episode\s+\d+:\s*/i, '')
    .replace(/\s*\([^)]+\)/g, '')
    .replace(/\bFINAL\b/gi, '')
    .trim();
}

function levenshtein(a: string, b: string): number {
  const m = a.length, n = b.length;
  const dp: number[] = Array.from({ length: n + 1 }, (_, i) => i);
  for (let i = 1; i <= m; i++) {
    let prev = dp[0];
    dp[0] = i;
    for (let j = 1; j <= n; j++) {
      const tmp = dp[j];
      dp[j] = a[i - 1] === b[j - 1] ? prev : 1 + Math.min(prev, dp[j], dp[j - 1]);
      prev = tmp;
    }
  }
  return dp[n];
}

function sortDescByEpisode(episodes: EpisodeMetadata[]): EpisodeMetadata[] {
  return [...episodes].sort(
    (a, b) =>
      b.season * 1000 + episodeSortKey(b.episode) -
      (a.season * 1000 + episodeSortKey(a.episode))
  );
}

/**
 * Find episodes matching a film query.
 * Matching passes (in order):
 *   1. Exact match on raw film name
 *   2. Exact match on normalized film name (strips year, Episode NNN:, FINAL)
 *   3. Partial match on normalized film name
 *   4. Fuzzy match using Levenshtein distance (handles typos)
 * Returns results sorted most-recent first.
 */
export function findEpisodesByFilm(filmQuery: string): EpisodeMetadata[] {
  const episodes = loadEpisodeMetadata();
  const queryLower = filmQuery.toLowerCase();
  const normalizedQuery = normalizeFilmName(filmQuery).toLowerCase();

  const exactRaw = episodes.filter((e) => e.film.toLowerCase() === queryLower);
  if (exactRaw.length > 0) return sortDescByEpisode(exactRaw);

  const exactNorm = episodes.filter(
    (e) => normalizeFilmName(e.film).toLowerCase() === normalizedQuery
  );
  if (exactNorm.length > 0) return sortDescByEpisode(exactNorm);

  const partial = episodes.filter((e) =>
    normalizeFilmName(e.film).toLowerCase().includes(normalizedQuery)
  );
  if (partial.length > 0) return sortDescByEpisode(partial);

  // Fuzzy fallback: find closest match by Levenshtein distance
  const maxDist = Math.max(1, Math.floor(normalizedQuery.length / 8));
  let bestDist = Infinity;
  let bestMatches: EpisodeMetadata[] = [];
  for (const e of episodes) {
    const normFilm = normalizeFilmName(e.film).toLowerCase();
    const dist = levenshtein(normalizedQuery, normFilm);
    if (dist < bestDist) {
      bestDist = dist;
      bestMatches = [e];
    } else if (dist === bestDist) {
      bestMatches.push(e);
    }
  }
  if (bestDist <= maxDist) return sortDescByEpisode(bestMatches);

  return [];
}

export function getEpisodesByGuest(guestName: string): EpisodeMetadata[] {
  const episodes = loadEpisodeMetadata();
  const guestLower = guestName.toLowerCase();

  return episodes.filter(
    (e) => e.guest !== null && e.guest.toLowerCase().includes(guestLower)
  );
}

export function getEpisodesBySeason(season: number): EpisodeMetadata[] {
  const episodes = loadEpisodeMetadata();
  return episodes.filter((e) => e.season === season);
}

export function getEpisodesByDecade(decade: number): EpisodeMetadata[] {
  const episodes = loadEpisodeMetadata();
  const decadeEnd = decade + 9;

  return episodes.filter(
    (e) => e.filmYear !== null && e.filmYear >= decade && e.filmYear <= decadeEnd
  );
}

/**
 * Independent keyword search against notableMoments fields.
 * Last-resort fallback when classifier doesn't extract filters
 * (e.g., "Has Haitch ever lost his voice to a witch").
 */
export function searchNotableMoments(query: string, maxResults: number = 3): EpisodeMetadata[] {
  const STOPWORDS = new Set([
    'the','a','an','is','are','was','were','be','been','have','has','had',
    'do','does','did','will','would','shall','should','may','might','can',
    'could','about','after','all','also','and','any','at','but','by','for',
    'from','get','he','her','him','his','how','if','in','into','it','its',
    'just','let','like','me','more','most','my','no','not','now','of','on',
    'or','other','our','out','over','she','so','some','than','that','their',
    'them','then','there','they','this','to','too','up','us','very','we',
    'were','what','when','where','which','who','why','with','you','your',
    'ever','episode','episodes','podcast','pod','been','being',
  ]);

  const queryTokens = query.toLowerCase()
    .split(/\W+/)
    .filter(t => t.length >= 3 && !STOPWORDS.has(t));
  if (queryTokens.length === 0) return [];

  const episodes = loadEpisodeMetadata();
  const scored: { episode: EpisodeMetadata; matches: number }[] = [];

  for (const ep of episodes) {
    if (!ep.notableMoments || ep.notableMoments === 'N/A') continue;
    const momentsLower = ep.notableMoments.toLowerCase();
    const matchCount = queryTokens.filter(t => new RegExp(`\\b${t}\\b`).test(momentsLower)).length;
    if (matchCount >= 2) {
      scored.push({ episode: ep, matches: matchCount });
    }
  }

  scored.sort((a, b) => b.matches - a.matches);
  return scored.slice(0, maxResults).map(s => s.episode);
}

export function clearCache(): void {
  normalizedMetadata = null;
}
