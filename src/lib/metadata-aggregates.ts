import {
  countByYearRange,
  getCurrentSeason,
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

const TILDA_FIELDS: Array<{ key: 'tildaH' | 'tildaJason' | 'tildaGuest' | 'tildaCorey'; label: string }> = [
  { key: 'tildaH', label: 'H' },
  { key: 'tildaJason', label: 'Jason' },
  { key: 'tildaGuest', label: 'Guest' },
  { key: 'tildaCorey', label: 'Corey' },
];

const MALE_ROLE_CUES = /\b(king|prince|mr\.?|sir|lord|baron|duke|father|dad|uncle|son|boy|man|him|his|husband|brother|grandpa|grandfather|male)\b/i;
const FEMALE_ROLE_CUES = /\b(queen|princess|mrs\.?|ms\.?|lady|duchess|mother|mom|aunt|daughter|girl|woman|her|she|wife|sister|grandma|grandmother|female)\b/i;
const NON_HUMAN_CUES = /\b(dog|cat|horse|rat|dragon|unicorn|monster|creature|alien|robot|droid|android|ai|ghost|demon|angel|god|devil|vampire|werewolf|zombie|ship|spaceship|car|truck|plane|rocket|planet|moon|sun|star|asteroid|comet|bomb|gun|sword|mask|object|thing|the dog|the rat)\b/i;

function classifyTildaPick(text: string): 'female' | 'male' | 'nonhuman' | 'unclear' {
  const normalized = text.toLowerCase();
  if (FEMALE_ROLE_CUES.test(normalized)) return 'female';
  if (MALE_ROLE_CUES.test(normalized)) return 'male';
  if (NON_HUMAN_CUES.test(normalized)) return 'nonhuman';
  return 'unclear';
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

  if (intent.type === 'metadata_tilda') {
    const episodes = loadEpisodeMetadata();
    const withTilda = episodes.filter((episode) =>
      TILDA_FIELDS.some(({ key }) => isTildaAnswer(episode[key]))
    );

    if (withTilda.length === 0) {
      return {
        answer: 'No Tilda casting picks were found in the metadata.',
        sources: {},
      };
    }

    const sorted = [...withTilda].sort(
      (a, b) => (b.season * 1000 + b.episode) - (a.season * 1000 + a.episode)
    );

    const counts = { H: 0, Jason: 0, Guest: 0, Corey: 0 };
    const categoryCounts = { female: 0, male: 0, nonhuman: 0, unclear: 0 };
    const examples = {
      female: [] as string[],
      male: [] as string[],
      nonhuman: [] as string[],
      unclear: [] as string[],
    };
    const sampleSources: MetadataSource[] = [];

    for (const episode of sorted) {
      const picks = TILDA_FIELDS.flatMap(({ key, label }) => {
        const value = episode[key];
        if (!isTildaAnswer(value)) return [];
        counts[label as keyof typeof counts] += 1;
        const cleaned = cleanTildaValue(value);
        const category = classifyTildaPick(cleaned);
        categoryCounts[category] += 1;
        if (examples[category].length < 5 && !examples[category].includes(cleaned)) {
          examples[category].push(cleaned);
        }
        return [{ label, value: cleaned }];
      });

      if (picks.length > 0 && sampleSources.length < 8) {
        sampleSources.push(episodeToMetadataSource(episode));
      }

      if (sampleSources.length >= 8 && examples.male.length >= 5 && examples.female.length >= 5) {
        break;
      }
    }

    const totalPicks = counts.H + counts.Jason + counts.Guest + counts.Corey;
    const classifiedTotal = categoryCounts.female + categoryCounts.male + categoryCounts.nonhuman;
    const breakdown = `Breakdown by host: H ${counts.H}, Jason ${counts.Jason}, Guest ${counts.Guest}, Corey ${counts.Corey}.`;
    const categoryBreakdown = `Category breakdown (heuristic): female-coded ${categoryCounts.female}, male-coded ${categoryCounts.male}, non-human/object ${categoryCounts.nonhuman}, unclear ${categoryCounts.unclear}.`;
    const categoryWinner = (() => {
      const entries: Array<[keyof typeof categoryCounts, number]> = [
        ['female', categoryCounts.female],
        ['male', categoryCounts.male],
        ['nonhuman', categoryCounts.nonhuman],
      ];
      entries.sort((a, b) => b[1] - a[1]);
      if (entries.length === 0 || entries[0][1] === 0) return 'unclear';
      if (entries.length > 1 && entries[0][1] === entries[1][1]) return 'mixed';
      return entries[0][0];
    })();

    const pct = (count: number) => {
      if (classifiedTotal === 0) return '0%';
      return `${Math.round((count / classifiedTotal) * 100)}%`;
    };

    const conclusion = (() => {
      if (categoryWinner === 'female') return `Answer: The metadata suggests the hosts are most likely to cast Tilda in female-coded roles.`;
      if (categoryWinner === 'male') return `Answer: The metadata suggests the hosts are most likely to cast Tilda in male-coded roles.`;
      if (categoryWinner === 'nonhuman') return `Answer: The metadata suggests the hosts are most likely to cast Tilda as a non-human or object role.`;
      if (categoryWinner === 'mixed') return `Answer: The metadata suggests a mixed set of picks with no single category dominating.`;
      return `Answer: The metadata is too ambiguous to show a clear preference.`;
    })();

    const exampleLine = (label: string, values: string[]) => {
      if (values.length === 0) return `${label}: none found.`;
      return `${label}: ${values.slice(0, 3).join(', ')}.`;
    };

    const answer = [
      `We track "Who would Tilda play?" in episode metadata.`,
      `Found ${totalPicks} picks across ${withTilda.length} episodes.`,
      conclusion,
      `Among classified picks: female-coded ${pct(categoryCounts.female)}, male-coded ${pct(categoryCounts.male)}, non-human/object ${pct(categoryCounts.nonhuman)}.`,
      categoryBreakdown,
      exampleLine('Female-coded examples', examples.female),
      exampleLine('Male-coded examples', examples.male),
      exampleLine('Non-human/object examples', examples.nonhuman),
      breakdown,
      `Note: category labels use simple keyword cues and may mark some picks as "unclear".`,
    ]
      .filter(Boolean)
      .join('\n\n');

    return {
      answer,
      sources: sampleSources.length > 0 ? { metadata: sampleSources } : {},
    };
  }

  return null;
}
