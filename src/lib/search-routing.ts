import { ClassificationResult } from '@/types/episode-metadata';

const TRANSCRIPT_FALLBACK_TRIGGERS = [
  'mention',
  'mentions',
  'instance',
  'instances',
  'every time',
  'quote',
  'quoted',
  'line',
  'lines',
  'said',
  'say',
  'says',
  'award',
];

const METADATA_CUES = [
  'episode',
  'episodes',
  'season',
  'guest',
  'how many',
  'count',
  'list',
  'latest',
  'most recent',
  'current season',
  'total',
];

export function shouldForceTranscriptSearch(query: string, classification: ClassificationResult): boolean {
  if (classification.type !== 'factual') return false;
  if (Object.keys(classification.filters).length > 0) return false;

  const normalized = query.toLowerCase();

  if (METADATA_CUES.some((cue) => normalized.includes(cue))) {
    return false;
  }

  if (TRANSCRIPT_FALLBACK_TRIGGERS.some((cue) => normalized.includes(cue))) {
    return true;
  }

  if (/".+?"/.test(query)) {
    return true;
  }

  return false;
}
