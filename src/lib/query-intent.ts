export type QueryIntentType =
  | 'metadata_latest'
  | 'metadata_current_season'
  | 'metadata_total_episodes'
  | 'metadata_year_range_count'
  | 'metadata_year_range_sample'
  | 'metadata_field_latest'
  | 'metadata_field_max'
  | 'metadata_tilda'
  | 'metadata_notable_moments'
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

function wantsYearSample(normalized: string): boolean {
  return (
    /one\s+(movie|film)\s+from\s+each\s+year/.test(normalized) ||
    /one\s+(movie|film)\s+per\s+year/.test(normalized) ||
    /each\s+year.*(movie|film)/.test(normalized) ||
    /list\s+one\s+(movie|film)\s+.*each\s+year/.test(normalized)
  );
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
