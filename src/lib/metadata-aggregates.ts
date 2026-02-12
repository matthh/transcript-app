import {
  countByYearRange,
  getCurrentSeason,
  getEpisodeByFilm,
  getEpisodeByNumber,
  getEpisodeWithMaxField,
  getFieldForLatestEpisode,
  getLatestEpisode,
  getOneEpisodePerYear,
  getTotalEpisodes,
  loadEpisodeMetadata,
  MetadataFieldKey,
} from './metadata-store';
import { QueryIntent } from './query-intent';
import { EpisodeMetadata, MetadataSource } from '@/types/episode-metadata';
import { formatEpisodeLabel } from './episode-format';

function episodeToMetadataSource(episode: EpisodeMetadata): MetadataSource {
  const relevantFields: Record<string, string> = {};

  if (episode.notableMoments) {
    relevantFields['Notable Moments'] = episode.notableMoments;
  }
  if (episode.hFlex) {
    relevantFields['H Flex'] = episode.hFlex;
  }
  if (episode.jFlex) {
    relevantFields['J Flex'] = episode.jFlex;
  }
  if (episode.kevsQuestion) {
    relevantFields["Kev's Question"] = episode.kevsQuestion;
  }
  if (episode.tildaH) {
    relevantFields['Tilda H'] = episode.tildaH;
  }
  if (episode.tildaJason) {
    relevantFields['Tilda Jason'] = episode.tildaJason;
  }
  if (episode.tildaGuest) {
    relevantFields['Tilda Guest'] = episode.tildaGuest;
  }
  if (episode.tildaCorey) {
    relevantFields['Tilda Corey'] = episode.tildaCorey;
  }

  return {
    film: episode.film,
    season: episode.season,
    episode: episode.episode,
    releaseDate: episode.releaseDate,
    guest: episode.guest,
    reviewer: episode.reviewer,
    relevantFields,
  };
}

function fieldLabel(field: MetadataFieldKey): string {
  switch (field) {
    case 'mmmCount':
      return 'MMM count';
    case 'thatsGreatCount':
      return '"That\'s Great" count';
    default:
      return 'Count';
  }
}

const NO_TILDA_PATTERNS = [
  /^n\/a$/i,
  /^no answer$/i,
  /^none$/i,
  /^didn't answer/i,
  /^didnt answer/i,
  /no tilda/i,
  /no tilda segment/i,
  /forgot to do tilda/i,
  /didn't give one/i,
  /didnt give one/i,
  /no mention/i,
  /voicemail/i,
];

function isTildaAnswer(value: string | null): value is string {
  if (!value) return false;
  const trimmed = value.trim();
  if (!trimmed) return false;
  return !NO_TILDA_PATTERNS.some((pattern) => pattern.test(trimmed));
}

function cleanTildaValue(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}

function formatKevsQuestion(value: string | null): string {
  if (!value) return 'Not recorded';
  const trimmed = value.trim();
  if (!trimmed) return 'Not recorded';
  if (/^(n\/a|na|none|no answer|no question)$/i.test(trimmed)) {
    return 'Not recorded';
  }
  return trimmed;
}

const TILDA_FIELDS: Array<{ key: 'tildaH' | 'tildaJason' | 'tildaGuest' | 'tildaCorey'; label: string }> = [
  { key: 'tildaH', label: 'H' },
  { key: 'tildaJason', label: 'Jason' },
  { key: 'tildaGuest', label: 'Guest' },
  { key: 'tildaCorey', label: 'Corey' },
];


export function buildMetadataAggregateResponse(intent: QueryIntent): {
  answer: string;
  sources: { metadata?: MetadataSource[] };
} | null {
  if (intent.type === 'metadata_latest') {
    const latest = getLatestEpisode();
    if (!latest) return null;
    const source = episodeToMetadataSource(latest);
    return {
      answer: `The latest episode is "${latest.film}" (${formatEpisodeLabel(latest.season, latest.episode)}), released ${latest.releaseDate}.`,
      sources: { metadata: [source] },
    };
  }

  if (intent.type === 'metadata_current_season') {
    const currentSeason = getCurrentSeason();
    const latest = getLatestEpisode();
    if (!currentSeason || !latest) return null;
    const source = episodeToMetadataSource(latest);
    return {
      answer: `The podcast is currently on season ${currentSeason}. The latest episode is "${latest.film}" (${formatEpisodeLabel(latest.season, latest.episode)}).`,
      sources: { metadata: [source] },
    };
  }

  if (intent.type === 'metadata_total_episodes') {
    const total = getTotalEpisodes();
    return {
      answer: `There are ${total} episodes in the metadata database.`,
      sources: {},
    };
  }

  if (intent.type === 'metadata_year_range_count' && intent.yearRange) {
    const { min, max } = intent.yearRange;
    const total = countByYearRange(min, max);
    return {
      answer: `There are ${total} episodes covering films released between ${min} and ${max}.`,
      sources: {},
    };
  }

  if (intent.type === 'metadata_year_range_sample' && intent.yearRange) {
    const { min, max } = intent.yearRange;
    const samples = getOneEpisodePerYear(min, max);
    const lines = samples.map((sample) => {
      if (!sample.episode) {
        return `${sample.year}: No episodes found in metadata.`;
      }
      const ep = sample.episode;
      return `${sample.year}: ${ep.film} — ${formatEpisodeLabel(ep.season, ep.episode)}`;
    });

    const sources = samples
      .map((sample) => sample.episode)
      .filter((episode): episode is EpisodeMetadata => Boolean(episode))
      .map(episodeToMetadataSource);

    return {
      answer: `Movies Covered by Year (${min}–${max})\n${lines.join('\n')}`,
      sources: sources.length > 0 ? { metadata: sources } : {},
    };
  }

  if (intent.type === 'metadata_field_max' && intent.field) {
    const episode = getEpisodeWithMaxField(intent.field);
    if (!episode) return null;
    const label = fieldLabel(intent.field);
    const source = episodeToMetadataSource(episode);
    return {
      answer: `The episode with the highest ${label} is "${episode.film}" (${formatEpisodeLabel(episode.season, episode.episode)}) with ${episode[intent.field]} ${label}.`,
      sources: { metadata: [source] },
    };
  }

  if (intent.type === 'metadata_field_latest' && intent.field) {
    const result = getFieldForLatestEpisode(intent.field);
    if (!result.episode || result.value === null) return null;
    const label = fieldLabel(intent.field);
    const episode = result.episode;
    const source = episodeToMetadataSource(episode);
    return {
      answer: `The latest episode ("${episode.film}", ${formatEpisodeLabel(episode.season, episode.episode)}) has ${result.value} ${label}.`,
      sources: { metadata: [source] },
    };
  }

  if (intent.type === 'metadata_episode_fields') {
    const episode = intent.episodeNumber !== undefined
      ? getEpisodeByNumber(intent.episodeNumber)
      : intent.film
        ? getEpisodeByFilm(intent.film)
        : null;
    if (!episode) return null;

    const requestedFields = intent.episodeFields && intent.episodeFields.length > 0
      ? intent.episodeFields
      : ['reviewer', 'guest'];
    const uniqueFields = Array.from(new Set(requestedFields));
    const lines: string[] = [];

    for (const field of uniqueFields) {
      if (field === 'reviewer') {
        lines.push(`- Reviewer: ${episode.reviewer}`);
      } else if (field === 'guest') {
        const guestValue = episode.guest && episode.guest.trim()
          ? episode.guest
          : 'No guest listed';
        lines.push(`- Guest: ${guestValue}`);
      } else if (field === 'releaseDate') {
        lines.push(`- Release date: ${episode.releaseDate}`);
      } else if (field === 'kevsQuestion') {
        lines.push(`- Kev's Question: ${formatKevsQuestion(episode.kevsQuestion)}`);
      }
    }

    const epLabel = formatEpisodeLabel(episode.season, episode.episode);
    const source = episodeToMetadataSource(episode);
    return {
      answer: lines.length > 0 ? lines.join('\n') : `Credits for "${episode.film}" (${epLabel}) not found.`,
      sources: { metadata: [source] },
    };
  }

  // metadata_tilda is handled by LLM synthesis in the route handlers
  // (collectTildaContext provides the data, routes do the synthesis)

  return null;
}

export interface TildaContext {
  context: string;
  sources: MetadataSource[];
  totalPicks: number;
  episodeCount: number;
  earliestEpisode: EpisodeMetadata | null;
  earliestPicks: string[];
}

export type TildaPick = { label: string; value: string };

export function getTildaEpisodePicks(episodeNumber: number): {
  episode: EpisodeMetadata;
  picks: TildaPick[];
} | null {
  const episodes = loadEpisodeMetadata();
  const episode = episodes.find((entry) => entry.episode === episodeNumber);
  if (!episode) return null;

  const picks: TildaPick[] = [];
  for (const { key, label } of TILDA_FIELDS) {
    const value = episode[key];
    if (isTildaAnswer(value)) {
      picks.push({ label, value: cleanTildaValue(value) });
    }
  }

  return { episode, picks };
}

export function collectTildaContext(): TildaContext | null {
  const episodes = loadEpisodeMetadata();
  const withTilda = episodes.filter((episode) =>
    TILDA_FIELDS.some(({ key }) => isTildaAnswer(episode[key]))
  );

  if (withTilda.length === 0) return null;

  const sortedDesc = [...withTilda].sort(
    (a, b) => (b.season * 1000 + b.episode) - (a.season * 1000 + a.episode)
  );
  const sortedAsc = [...withTilda].sort(
    (a, b) => (a.season * 1000 + a.episode) - (b.season * 1000 + b.episode)
  );

  const counts = { H: 0, Jason: 0, Guest: 0, Corey: 0 };
  const lines: string[] = [];
  const sources: MetadataSource[] = [];
  const MAX_EPISODES = 50;
  let earliestEpisode: EpisodeMetadata | null = null;
  let earliestPicks: string[] = [];

  for (const episode of sortedDesc) {
    const picks: string[] = [];
    for (const { key, label } of TILDA_FIELDS) {
      const value = episode[key];
      if (isTildaAnswer(value)) {
        counts[label as keyof typeof counts] += 1;
        picks.push(`${label}: "${cleanTildaValue(value)}"`);
      }
    }

    if (picks.length > 0) {
      const epLabel = formatEpisodeLabel(episode.season, episode.episode);
      lines.push(`${epLabel} — ${episode.film}: ${picks.join(', ')}`);
      if (sources.length < 8) {
        sources.push(episodeToMetadataSource(episode));
      }
    }

    if (lines.length >= MAX_EPISODES) break;
  }

  for (const episode of sortedAsc) {
    const picks: string[] = [];
    for (const { key, label } of TILDA_FIELDS) {
      const value = episode[key];
      if (isTildaAnswer(value)) {
        picks.push(`${label}: "${cleanTildaValue(value)}"`);
      }
    }
    if (picks.length > 0) {
      earliestEpisode = episode;
      earliestPicks = picks;
      break;
    }
  }

  if (earliestEpisode) {
    sources.unshift(episodeToMetadataSource(earliestEpisode));
  }
  if (sources.length > 8) {
    sources.length = 8;
  }

  const totalPicks = counts.H + counts.Jason + counts.Guest + counts.Corey;
  const hostBreakdown = `Picks by host: H (${counts.H}), Jason (${counts.Jason}), Guest (${counts.Guest}), Corey (${counts.Corey})`;
  const earliestLine = earliestEpisode
    ? `Earliest recorded picks: ${formatEpisodeLabel(earliestEpisode.season, earliestEpisode.episode)} — ${earliestEpisode.film}: ${earliestPicks.join(', ')}`
    : 'Earliest recorded picks: unavailable.';

  const context = `"Who Would Tilda Swinton Play?" picks from ${withTilda.length} episodes (${totalPicks} total picks):

${lines.join('\n')}

${hostBreakdown}`;

  return {
    context: `${context}\n\n${earliestLine}`,
    sources,
    totalPicks,
    episodeCount: withTilda.length,
    earliestEpisode,
    earliestPicks,
  };
}
