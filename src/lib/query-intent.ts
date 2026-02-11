import { loadEpisodeMetadata } from './metadata-store';
import { extractEpisodeNumberFromQuery } from './tilda-query';

export type QueryIntentType =
  | 'metadata_latest'
  | 'metadata_current_season'
  | 'metadata_total_episodes'
  | 'metadata_year_range_count'
  | 'metadata_year_range_sample'
  | 'metadata_field_latest'
  | 'metadata_field_max'
  | 'metadata_episode_fields'
  | 'metadata_tilda'
  | 'metadata_notable_moments'
  | 'transcript_only'
  | 'none';

export type MetadataFieldKey = 'mmmCount' | 'thatsGreatCount';
export type MetadataEpisodeField = 'guest' | 'reviewer';

export interface QueryIntent {
  type: QueryIntentType;
  field?: MetadataFieldKey;
  yearRange?: { min: number; max: number };
  episodeFields?: MetadataEpisodeField[];
  episodeNumber?: number;
  film?: string;
}

const YEAR_RANGE_PATTERN = /\b(19|20)\d{2}\s*-\s*(19|20)\d{2}\b/;
const YEAR_RANGE_WORD_PATTERN = /\bfrom\s+((19|20)\d{2})\s+to\s+((19|20)\d{2})\b/;

function normalize(text: string): string {
  return text
    .toLowerCase()
    .replace(/[’‘]/g, "'")
    .replace(/[–—]/g, '-')
    .replace(/\s+/g, ' ')
    .trim();
}

function normalizeForMatch(text: string): string {
  return text
    .toLowerCase()
    .replace(/[’‘]/g, "'")
    .replace(/[–—]/g, '-')
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function stripParenthetical(text: string): string {
  return text.replace(/\([^)]*\)/g, ' ');
}

function extractYearRange(query: string): { min: number; max: number } | null {
  const normalized = normalize(query);
  const dashMatch = normalized.match(YEAR_RANGE_PATTERN);
  if (dashMatch) {
    const [start, end] = dashMatch[0].split('-').map((v) => parseInt(v.trim(), 10));
    if (!Number.isNaN(start) && !Number.isNaN(end)) {
      return { min: Math.min(start, end), max: Math.max(start, end) };
    }
  }

  const wordMatch = normalized.match(YEAR_RANGE_WORD_PATTERN);
  if (wordMatch) {
    const start = parseInt(wordMatch[1], 10);
    const end = parseInt(wordMatch[3], 10);
    if (!Number.isNaN(start) && !Number.isNaN(end)) {
      return { min: Math.min(start, end), max: Math.max(start, end) };
    }
  }

  return null;
}

function findFilmFromQuery(query: string): string | null {
  const normalizedQuery = normalizeForMatch(query);
  if (!normalizedQuery) return null;

  const episodes = loadEpisodeMetadata();
  let bestMatch: { film: string; normalized: string; score: number } | null = null;

  for (const episode of episodes) {
    const normalizedFilm = normalizeForMatch(episode.film);
    const normalizedNoParen = normalizeForMatch(stripParenthetical(episode.film));
    const candidates = [normalizedFilm, normalizedNoParen].filter(Boolean);
    if (candidates.length === 0) continue;

    let matched: string | null = null;
    for (const candidate of candidates) {
      if (normalizedQuery.includes(candidate)) {
        matched = candidate;
        break;
      }
    }
    if (!matched) continue;

    const score = matched.length;
    if (!bestMatch || score > bestMatch.score) {
      bestMatch = { film: episode.film, normalized: matched, score };
    }
  }

  if (!bestMatch) return null;

  const wordCount = bestMatch.normalized.split(' ').length;
  if (bestMatch.normalized.length <= 3 && wordCount < 2) {
    return null;
  }

  return bestMatch.film;
}

function detectField(query: string): MetadataFieldKey | null {
  const normalized = normalize(query);
  if (normalized.includes("that's great") || normalized.includes('thats great')) {
    return 'thatsGreatCount';
  }
  if (normalized.includes('mmm')) {
    return 'mmmCount';
  }
  return null;
}

function wantsYearSample(normalized: string): boolean {
  return (
    /one\s+(movie|film)\s+from\s+each\s+year/.test(normalized) ||
    /one\s+(movie|film)\s+per\s+year/.test(normalized) ||
    /each\s+year.*(movie|film)/.test(normalized) ||
    /list\s+one\s+(movie|film)\s+.*each\s+year/.test(normalized)
  );
}

function detectEpisodeFieldsIntent(query: string): QueryIntent | null {
  const normalized = normalize(query);
  const wantsGuest = /\bguest\b/.test(normalized) || /\bguests\b/.test(normalized);
  const wantsReviewer =
    /\breviewer\b/.test(normalized) ||
    /\breviewed\b/.test(normalized) ||
    /\bwho reviewed\b/.test(normalized);

  if (!wantsGuest && !wantsReviewer) return null;

  const episodeNumber = extractEpisodeNumberFromQuery(query);
  const film = episodeNumber ? null : findFilmFromQuery(query);
  if (episodeNumber === null && !film) return null;

  const episodeFields: MetadataEpisodeField[] = [];
  if (wantsGuest) episodeFields.push('guest');
  if (wantsReviewer) episodeFields.push('reviewer');

  return {
    type: 'metadata_episode_fields',
    episodeFields,
    episodeNumber: episodeNumber ?? undefined,
    film: film ?? undefined,
  };
}

export function detectQueryIntent(query: string): QueryIntent {
  const normalized = normalize(query);
  const yearRange = extractYearRange(normalized);

  if (
    (normalized.includes('what does') && normalized.includes('do for a living')) ||
    (normalized.includes('what does') && normalized.includes('do for work')) ||
    (normalized.includes('what does') && normalized.includes('do for a job')) ||
    normalized.includes('what is their job') ||
    normalized.includes('what is his job') ||
    normalized.includes('what is her job') ||
    normalized.includes('what is their occupation') ||
    normalized.includes('what is his occupation') ||
    normalized.includes('what is her occupation')
  ) {
    return { type: 'transcript_only' };
  }

  if (normalized.includes('join the discord') || normalized.includes('joined the discord')) {
    return { type: 'transcript_only' };
  }

  const episodeFieldsIntent = detectEpisodeFieldsIntent(query);
  if (episodeFieldsIntent) {
    return episodeFieldsIntent;
  }

  if ((normalized.includes('current season') || normalized.includes('what season') || normalized.includes('season is the pod on now'))
    && (normalized.includes('now') || normalized.includes('current') || normalized.includes('pod'))) {
    return { type: 'metadata_current_season' };
  }

  if (normalized.includes('how many episodes') || normalized.includes('total episodes')) {
    return { type: 'metadata_total_episodes' };
  }

  if (yearRange && wantsYearSample(normalized)) {
    return { type: 'metadata_year_range_sample', yearRange };
  }

  if (yearRange && (normalized.includes('how many films') || normalized.includes('how many movies') || normalized.includes('how many episodes'))) {
    return { type: 'metadata_year_range_count', yearRange };
  }

  const field = detectField(normalized);
  if (field) {
    if (normalized.includes('greatest') || normalized.includes('most') || normalized.includes('highest')) {
      return { type: 'metadata_field_max', field };
    }
    if (normalized.includes('last episode') || normalized.includes('latest episode') || normalized.includes('most recent')) {
      return { type: 'metadata_field_latest', field };
    }
    return { type: 'metadata_field_latest', field };
  }

  if (normalized.includes('last episode') || normalized.includes('latest episode') || normalized.includes('most recent episode')) {
    return { type: 'metadata_latest' };
  }

  if (/\bnotable moments?\b/.test(normalized)) {
    return { type: 'metadata_notable_moments' };
  }

  if (
    normalized.includes('tilda') &&
    (
      /\btilda\s+(play|would|should|pick|cast|as|role|segment|swinton)\b/.test(normalized) ||
      /\bcast\s+tilda\b/.test(normalized) ||
      /\bwho\s+would\s+tilda\b/.test(normalized) ||
      /\btilda\s+(question|segment|picks?|casting)\b/.test(normalized) ||
      /\broles?\b.*\btilda\b/.test(normalized) ||
      /\btilda\b.*\broles?\b/.test(normalized)
    )
  ) {
    return { type: 'metadata_tilda' };
  }

  return { type: 'none' };
}
