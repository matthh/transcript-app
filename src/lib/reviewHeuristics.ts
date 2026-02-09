import type { DialogueEntry } from '@/types/transcript';
import { timestampToSeconds } from '@/lib/timestamps';

export interface SegmentMeta {
  start: number;
  end: number;
  duration: number;
  wordCount: number;
}

export function countWords(text: string): number {
  const trimmed = text.trim();
  if (!trimmed) return 0;
  return trimmed.split(/\s+/).length;
}

export function buildSegmentMeta(
  dialogues: DialogueEntry[],
  audioDuration?: number | null
): SegmentMeta[] {
  const meta: SegmentMeta[] = [];
  const total = dialogues.length;

  for (let i = 0; i < total; i++) {
    const start = timestampToSeconds(dialogues[i].timestamp);
    const nextStart = i + 1 < total ? timestampToSeconds(dialogues[i + 1].timestamp) : undefined;
    let end = nextStart;

    if (end === undefined || Number.isNaN(end)) {
      if (typeof audioDuration === 'number' && audioDuration > 0) {
        end = audioDuration;
      } else {
        end = start + 5;
      }
    }

    if (end < start) {
      end = start;
    }

    const duration = end - start;
    meta.push({
      start,
      end,
      duration,
      wordCount: countWords(dialogues[i].text),
    });
  }

  return meta;
}

export function isSounderCandidate(dialogue: DialogueEntry, index: number): boolean {
  if (index > 1) return false;
  const text = dialogue.text.toLowerCase();
  if (/tapedeck|sounder|intro music|theme music|theme song|music bed|sting/.test(text)) {
    return true;
  }
  return countWords(dialogue.text) <= 3;
}

export function isSampleCandidate(text: string): boolean {
  if (/\[.*\]/.test(text)) return true;
  return /clip|trailer|scene|movie sample|audio sample|sound clip|from the film/i.test(text);
}

export function isInterjection(text: string, duration: number): boolean {
  return countWords(text) <= 2 || duration <= 1.2;
}
