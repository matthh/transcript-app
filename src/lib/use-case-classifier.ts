export const UC_LABELS: Record<string, string> = {
  'UC-1': 'Episode Lookup',
  'UC-2': 'Metadata Listing & Filtering',
  'UC-3': 'Single-Episode Opinion',
  'UC-4': 'Host-Scoped Attribution',
  'UC-5': 'Cross-Episode Thematic',
  'UC-6': 'Cross-Episode Entity / Exhaustive Tracking',
  'UC-7': 'Personal / Lifestyle',
  'UC-8': 'Voicemail, Letter & Segment',
  'UC-9': 'Counting & Frequency',
  'UC-10': 'Catchphrase & Recurring Patterns',
  'UC-11': 'Quote & Phrase Lookup',
  'UC-12': 'Factual Fallback',
  'UC-13': 'Guest-Scoped',
  'UC-14': 'Podcast Meta',
};

interface ClassifyInput {
  query: string;
  classificationType?: string;
  filters?: Record<string, unknown>;
  intentType?: string;
  routingPath?: string;
  searchStrategy?: string;
}

const VOICEMAIL_SEGMENT_RE = /\b(voicemail|voicemailer|letter writer|truthsayer|birria|corey|animal mother|mr\.?\s*java|lizzen|ethan|listener message|segment)\b/i;
const CATCHPHRASE_RE = /\b(catchphrase|recurring phrase|always says|signature line|verbal tic)\b/i;
const QUOTE_RE = /\b(which episode|what episode).{0,30}\b(say|said|quote|mention)/i;
const WHAT_MEAN_RE = /what did .{1,30} mean when/i;
const PERSONAL_RE = /\b(favorite food|favourite food|like to eat|bbq|barbecue|fishing|shorts|looks? like|physical|appearance|pets?|hobbies|wear|wearing|instrument)\b/i;
const HOST_RE = /\b(haitch|jason|matt|hatch)\b/i;
const COUNTING_RE = /\b(how many times|how often|every time|count)\b/i;
const METADATA_INTENTS = [
  'metadata_latest', 'metadata_total_episodes', 'metadata_director_films',
  'metadata_guest_search', 'metadata_current_season', 'metadata_field_latest',
  'metadata_field_max', 'metadata_year_range_count', 'metadata_year_range_sample',
  'metadata_episode_fields',
];

export function classifyUseCase(input: ClassifyInput): string {
  const { query, classificationType, filters, intentType, routingPath, searchStrategy } = input;
  const q = query.toLowerCase();

  // Priority 1: Episode lookup intent
  if (intentType === 'metadata_episode_lookup') return 'UC-1';

  // Priority 2: Metadata listing intents
  if (intentType && METADATA_INTENTS.includes(intentType)) return 'UC-2';

  // Priority 3: Podcast meta (tilda, full catalog)
  if (intentType === 'metadata_tilda') return 'UC-14';
  if (/\b(full catalog|every movie.*covered|suggest.*films?.*cover)\b/i.test(q)) return 'UC-14';

  // Priority 4: Agent search — counting vs exhaustive
  if (routingPath === 'agent_search' || searchStrategy === 'agent') {
    if (COUNTING_RE.test(q)) return 'UC-9';
    return 'UC-6';
  }

  // Priority 5: Voicemail/segment keywords
  if (VOICEMAIL_SEGMENT_RE.test(q)) return 'UC-8';

  // Priority 6: Catchphrase/recurring patterns
  if (CATCHPHRASE_RE.test(q)) return 'UC-10';

  // Priority 7: Quote/phrase lookup
  if (QUOTE_RE.test(q) || WHAT_MEAN_RE.test(q)) return 'UC-11';
  if (/["'\u2018\u2019\u201c\u201d].{3,}["'\u2018\u2019\u201c\u201d]/.test(query)) return 'UC-11';

  // Priority 8: Guest-scoped
  if (filters?.guest && (classificationType === 'interpretive' || classificationType === 'hybrid')) return 'UC-13';

  // Priority 9: Personal/lifestyle
  if (PERSONAL_RE.test(q)) return 'UC-7';

  // Priority 10: Film-scoped opinion (single-episode)
  if (filters?.film && (classificationType === 'interpretive' || classificationType === 'hybrid')) return 'UC-3';

  // Priority 11: Host-scoped attribution (no film, host named)
  if (HOST_RE.test(q) && !filters?.film && classificationType === 'interpretive') return 'UC-4';

  // Priority 12: Factual with filters
  if (classificationType === 'factual' && Object.keys(filters || {}).length > 0) return 'UC-12';

  // Priority 13: Cross-episode thematic (interpretive/hybrid, no specific entity)
  if (classificationType === 'interpretive' || classificationType === 'hybrid') return 'UC-5';

  // Priority 14: Factual fallback to UC-2
  if (classificationType === 'factual') return 'UC-2';

  return 'unclassified';
}
