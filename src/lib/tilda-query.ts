export type TildaPickerLabel = 'H' | 'Jason' | 'Guest' | 'Corey';

const EPISODE_PATTERNS: RegExp[] = [
  /\b(?:episode|ep)\s*#?\s*(\d{1,4})\b/i,
  /\bS\d+\s*E(\d{1,4})\b/i,
  /\bS\d+E(\d{1,4})\b/i,
];

export function extractEpisodeNumberFromQuery(query: string): number | null {
  for (const pattern of EPISODE_PATTERNS) {
    const match = query.match(pattern);
    if (match?.[1]) {
      const parsed = Number.parseInt(match[1], 10);
      if (!Number.isNaN(parsed)) return parsed;
    }
  }
  return null;
}

export function extractTildaPickerFromQuery(query: string): TildaPickerLabel | null {
  const normalized = query.toLowerCase();
  if (/\bcorey\b/.test(normalized)) return 'Corey';
  if (/\bjason\b/.test(normalized)) return 'Jason';
  if (/\bguest\b/.test(normalized)) return 'Guest';
  if (/\bmatt\b/.test(normalized) || /\bhaitch\b/.test(normalized) || /\bhost\b/.test(normalized) || /\bh\b/.test(normalized)) {
    return 'H';
  }
  return null;
}
