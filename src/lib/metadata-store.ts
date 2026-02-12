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
      e.film.toLowerCase().includes(filmLower)
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

export function searchFilms(searchText: string): EpisodeMetadata[] {
  const episodes = loadEpisodeMetadata();
  const searchLower = searchText.toLowerCase();

  return episodes.filter(
    (e) =>
      e.film.toLowerCase().includes(searchLower) ||
      (e.notableMoments && e.notableMoments.toLowerCase().includes(searchLower))
  );
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

export function clearCache(): void {
  normalizedMetadata = null;
}
