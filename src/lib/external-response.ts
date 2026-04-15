import { getEpisodeByNumber } from '@/lib/metadata-store';
import type { SearchResult } from '@/lib/search-pipeline';
import type { EpisodeMetadata } from '@/types/episode-metadata';

export interface ExternalSource {
  episodeNumber: number;
  episodeTitle: string;
  episodeUrl: string;
  quote?: string;
  timestamp?: number;
}

export interface ExternalResponse {
  answer: string;
  sources: ExternalSource[];
  attribution: { text: string; url: string };
  requestId: string;
}

const QUOTE_MAX_LEN = 240;

const ATTRIBUTION = {
  text: 'Powered by search.escapehatchpod.com',
  url: 'https://search.escapehatchpod.com',
};

const FALLBACK_EPISODE_URL = 'https://escapehatchpod.com';

function episodeUrlFor(ep: EpisodeMetadata | null): string {
  return ep?.showLink || FALLBACK_EPISODE_URL;
}

function toEpisodeNumber(raw: number | string | undefined): number | null {
  if (typeof raw === 'number') return Number.isFinite(raw) ? raw : null;
  if (typeof raw === 'string') {
    const parsed = parseInt(raw, 10);
    return Number.isFinite(parsed) && String(parsed) === raw ? parsed : null;
  }
  return null;
}

function parseTimestamp(raw: string | undefined): number | undefined {
  if (!raw) return undefined;
  const parts = raw.split(':').map((p) => Number(p));
  if (parts.some((n) => Number.isNaN(n))) return undefined;
  if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2];
  if (parts.length === 2) return parts[0] * 60 + parts[1];
  if (parts.length === 1) return parts[0];
  return undefined;
}

function trimQuote(text: string): string {
  const clean = text.trim().replace(/\s+/g, ' ');
  if (clean.length <= QUOTE_MAX_LEN) return clean;
  return clean.slice(0, QUOTE_MAX_LEN - 1).trimEnd() + '…';
}

export function toExternalResponse(
  internal: SearchResult,
  limit: number,
  requestId: string,
): ExternalResponse {
  const seen = new Map<number, ExternalSource>();

  for (const t of internal.sources.transcripts ?? []) {
    if (seen.size >= limit) break;
    const epNum = toEpisodeNumber(t.episodeNumber);
    if (epNum === null) continue;
    if (seen.has(epNum)) continue;
    const ep = getEpisodeByNumber(epNum);
    seen.set(epNum, {
      episodeNumber: epNum,
      episodeTitle: ep?.film ?? t.episodeTitle,
      episodeUrl: episodeUrlFor(ep),
      quote: trimQuote(t.text),
      timestamp: parseTimestamp(t.startTimestamp),
    });
  }

  for (const m of internal.sources.metadata ?? []) {
    if (seen.size >= limit) break;
    const epNum = toEpisodeNumber(m.episode);
    if (epNum === null) continue;
    if (seen.has(epNum)) continue;
    const ep = getEpisodeByNumber(epNum);
    seen.set(epNum, {
      episodeNumber: epNum,
      episodeTitle: m.film,
      episodeUrl: episodeUrlFor(ep),
    });
  }

  return {
    answer: internal.answer,
    sources: Array.from(seen.values()),
    attribution: ATTRIBUTION,
    requestId,
  };
}
