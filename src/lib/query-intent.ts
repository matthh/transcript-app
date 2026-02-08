export type QueryIntentType =
  | 'metadata_latest'
  | 'metadata_current_season'
  | 'metadata_total_episodes'
  | 'metadata_year_range_count'
  | 'metadata_field_latest'
  | 'metadata_field_max'
  | 'transcript_only'
  | 'none';

export type MetadataFieldKey = 'mmmCount' | 'thatsGreatCount';

export interface QueryIntent {
  type: QueryIntentType;
  field?: MetadataFieldKey;
  yearRange?: { min: number; max: number };
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

export function detectQueryIntent(query: string): QueryIntent {
  const normalized = normalize(query);
  const yearRange = extractYearRange(normalized);

  if (normalized.includes('what does') && normalized.includes('do for a living')) {
    return { type: 'transcript_only' };
  }

  if (normalized.includes('join the discord') || normalized.includes('joined the discord')) {
    return { type: 'transcript_only' };
  }

  if ((normalized.includes('current season') || normalized.includes('what season') || normalized.includes('season is the pod on now'))
    && (normalized.includes('now') || normalized.includes('current') || normalized.includes('pod'))) {
    return { type: 'metadata_current_season' };
  }

  if (normalized.includes('how many episodes') || normalized.includes('total episodes')) {
    return { type: 'metadata_total_episodes' };
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

  return { type: 'none' };
}
