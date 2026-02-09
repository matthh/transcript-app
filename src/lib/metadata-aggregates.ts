import {
  countByYearRange,
  getCurrentSeason,
  getEpisodeWithMaxField,
  getFieldForLatestEpisode,
  getLatestEpisode,
  getOneEpisodePerYear,
  getTotalEpisodes,
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

  return null;
}
