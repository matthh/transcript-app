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
  const normalized = query.toLowerCase();

  if (METADATA_CUES.some((cue) => normalized.includes(cue))) {
    return false;
  }

  const hasTranscriptCue = TRANSCRIPT_FALLBACK_TRIGGERS.some((cue) => normalized.includes(cue))
    || /".+?"/.test(query);

  if (hasTranscriptCue) {
    return true;
  }

  if (classification.type !== 'factual') return false;

  return false;
}
