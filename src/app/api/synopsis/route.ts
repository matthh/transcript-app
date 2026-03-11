import { NextRequest, NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';
import Anthropic from '@anthropic-ai/sdk';
import { Transcript } from '@/types/transcript';
import { findEpisodesByFilm, normalizeFilmName } from '@/lib/metadata-store';
import { loadTranscript as loadBlobTranscript } from '@/lib/blob-storage';

export type SynopsisResponse = {
  film: string;
  episodeNumber: number | null;
  episodeName: string | null;
  pod: string | null;
  timestamp: string | null;
  synopsis: string;
  source: 'transcript' | 'generated';
};

const HAITCH_NAMES = new Set(['matt haitch', 'haitch matt', 'haitch', 'h']);

const INTRO_SIGNALS = [
  "if you're enjoying",
  'five star rating',
  'discord server',
  'show notes',
  'leave us a rating',
];

// Real examples for few-shot prompting
// Note: closing question must naturally incorporate the film title as the final word(s)
const FEW_SHOT_EXAMPLES = [
  {
    film: 'Inception',
    synopsis:
      "Inception is the search within ourselves for forgiveness and connection. Dom Cobb is an extractor using complex illegal technology devised by the government to kidnap and pull his targets into a dream where he can steal their secrets. But Cobb has a problem — when he and his wife Mal experimented with creating dreams within dreams, they found themselves lost in the limbo of their own subconscious, trapped together seemingly for decades, until Cobb forced them back up. Distraught and resorting to framing him for her own death, Mal now lives only in Cobb's dreams, and he is desperate to clear his name and return to his children in the real world. Taking on a dangerous heist for a powerful industrialist, Cobb will assemble a team of experts who construct a maze across interlocking dreams to place an idea deep in the subconscious of their target. But under desperate assault, as it becomes impossible to distinguish reality from collapsing dreams, can Cobb find his way through the labyrinth of his own mind, or will he be trapped by the guilt of his own Inception?",
  },
  {
    film: '1917',
    synopsis:
      "1917 is a journey through darkness and death to honor the bonds of loyalty in the depths of the Great War. Over a century ago, Lance Corporals Tom Blake and Will Schofield are given an impossible mission: cross No Man's Land and venture deep into enemy territory to locate and warn two Allied battalions that are about to be lured into a deadly snare by a German feint. 1,600 lives are on the line, including Blake's own brother. With no time to consider, they set off on a treacherous course leading them across blasted landscapes, deadly underground tunnels, a nightmare hellscape of fire, and a literal river of the dead, confronting the ultimate sacrifice with every step. Can they stay true to their honor and complete their mission, or will it all be in vain as they draw their final breaths on an unmarked field in France in the spring of 1917?",
  },
  {
    film: 'Sinners',
    synopsis:
      "Sinners is a reckoning with blood, music, and the devil's bargain at the heart of the American South. Twin brothers Smoke and Stack return to their Mississippi Delta hometown in 1932, hoping to leave their violent pasts behind and build something real by opening a juke joint for their community. But when they invite the wrong people through the door, a single night of music and celebration becomes a fight for survival against a darkness far older and hungrier than anything they have faced before. Can the bonds of family and the power of their music hold back what is coming for them, or will one night of joy be all they are allowed before being consumed as Sinners?",
  },
];


function isHaitch(speakerName: string): boolean {
  return HAITCH_NAMES.has(speakerName.toLowerCase().trim());
}

function isIntroBlurb(text: string): boolean {
  const lower = text.toLowerCase();
  return INTRO_SIGNALS.some((signal) => lower.includes(signal));
}

function extractSynopsis(transcript: Transcript): { text: string; timestamp: string } | null {
  const cleanName = normalizeFilmName(transcript.episode_name);
  const searchMarker = cleanName.toLowerCase() + ' is';

  const dialogues = transcript.dialogues;

  for (let i = 0; i < dialogues.length; i++) {
    const entry = dialogues[i];
    if (!isHaitch(entry.name)) continue;
    if (isIntroBlurb(entry.text)) continue;
    if (entry.text.length <= 150) continue;

    const lowerText = entry.text.toLowerCase();
    const markerIdx = lowerText.indexOf(searchMarker);
    if (markerIdx === -1) continue;

    // Found the synopsis entry — collect text starting from the marker
    let collected = entry.text.slice(markerIdx);
    const timestamp = entry.timestamp;

    // Check if this entry already contains "or will"
    if (collected.toLowerCase().includes('or will')) {
      return { text: trimAtOrWill(collected), timestamp };
    }

    // Collect up to 5 lookahead Haitch entries
    for (let j = i + 1; j < Math.min(i + 6, dialogues.length); j++) {
      const next = dialogues[j];
      if (!isHaitch(next.name)) continue;
      collected += ' ' + next.text;
      if (collected.toLowerCase().includes('or will')) {
        return { text: trimAtOrWill(collected), timestamp };
      }
    }

    // No "or will" found — return what we have (Goonies-style endings)
    return { text: collected.trim(), timestamp };
  }

  return null;
}

function trimAtOrWill(text: string): string {
  const lowerText = text.toLowerCase();
  const orWillIdx = lowerText.indexOf('or will');
  if (orWillIdx === -1) return text.trim();

  const afterOrWill = text.slice(orWillIdx);
  const questionIdx = afterOrWill.indexOf('?');
  if (questionIdx === -1) return text.trim();

  let end = orWillIdx + questionIdx + 1; // include the ?

  // Check for short film-title echo after the question (e.g., " Drive?")
  const remainder = text.slice(end).trimStart();
  const echoMatch = remainder.match(/^([A-Z][^.!?\n]{0,30})\?/);
  if (echoMatch) {
    const echoStart = text.indexOf(echoMatch[0], end);
    if (echoStart !== -1 && echoStart - end < 5) {
      end = echoStart + echoMatch[0].length;
    }
  }

  return text.slice(0, end).trim();
}

async function loadTranscript(epNum: number): Promise<Transcript | null> {
  const filePath = path.join(process.cwd(), 'transcripts', `episode_${epNum}.json`);
  if (fs.existsSync(filePath)) {
    try {
      const content = fs.readFileSync(filePath, 'utf-8');
      return JSON.parse(content) as Transcript;
    } catch {
      // Fall through to blob
    }
  }

  try {
    return await loadBlobTranscript(epNum);
  } catch {
    return null;
  }
}


function stripMidBodyFilmName(synopsis: string, film: string): string {
  // The film name must appear only at the very start and very end.
  // Find the end of the opening sentence (first period or end of "{film} is ..." clause)
  // and the start of the closing question ("or will"), then remove any film name in between.
  const filmEscaped = film.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const filmRegex = new RegExp(filmEscaped, 'gi');

  // Locate the opening sentence boundary and the closing question
  const orWillIdx = synopsis.toLowerCase().lastIndexOf('or will');
  if (orWillIdx === -1) return synopsis;

  // Find where the first sentence ends (first '.' after opening)
  const firstSentenceEnd = synopsis.indexOf('.');
  if (firstSentenceEnd === -1 || firstSentenceEnd >= orWillIdx) return synopsis;

  const body = synopsis.slice(firstSentenceEnd + 1, orWillIdx);
  const cleanedBody = body.replace(filmRegex, 'the film');

  return synopsis.slice(0, firstSentenceEnd + 1) + cleanedBody + synopsis.slice(orWillIdx);
}

async function fetchTmdbOverview(film: string): Promise<string | null> {
  const apiKey = process.env.TMDB_API_KEY;
  if (!apiKey) return null;
  try {
    const params = new URLSearchParams({ api_key: apiKey, query: film });
    const res = await fetch(`https://api.themoviedb.org/3/search/movie?${params}`);
    if (!res.ok) return null;
    const data = (await res.json()) as { results?: { overview?: string }[] };
    return data.results?.[0]?.overview ?? null;
  } catch {
    return null;
  }
}

async function generateSynopsis(film: string): Promise<string> {
  const [client, tmdbOverview] = await Promise.all([
    Promise.resolve(new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })),
    fetchTmdbOverview(film),
  ]);

  const examples = FEW_SHOT_EXAMPLES.map(
    (ex) => `Film: ${ex.film}\nSynopsis: ${ex.synopsis}`
  ).join('\n\n');

  const plotSection = tmdbOverview
    ? `\nReal plot summary to use as grounding (DO NOT copy verbatim — rewrite in Haitch's style):\n${tmdbOverview}\n`
    : '';

  const prompt = `You are writing a podcast intro synopsis in the exact style of "Haitch" from the Escape Hatch Podcast. Study these real examples carefully:

${examples}
${plotSection}
Now write a synopsis for: ${film}

Style rules:
- Open with "${film} is [thematic statement]" — the film title is the very first word(s)
- Follow with 3-5 sentences summarizing the plot using character names and pronouns — DO NOT mention the film title again anywhere in the middle
- The FINAL sentence must be a single question starting with "or will" with the film title naturally woven in as the very last word(s) before ONE closing "?": e.g. "or will they be consumed as ${film}?" — do NOT use two question marks or append the title as a separate echo after the question
- The film title "${film}" must appear ONLY at the start and at the end. Never in between.
- Write in present tense, plain prose, no markdown
- Match the voice: earnest, cinephile, slightly dramatic

Output only the synopsis text, nothing else.`;

  const message = await client.messages.create({
    model: 'claude-haiku-4-5-20251001',
    max_tokens: 512,
    messages: [{ role: 'user', content: prompt }],
  });

  const textBlock = message.content.find((b) => b.type === 'text');
  if (!textBlock || textBlock.type !== 'text') {
    throw new Error('No text in Claude response');
  }

  let synopsis = textBlock.text.trim();

  // Safety net: ensure the synopsis ends with the film title before the final "?"
  const filmLower = film.toLowerCase();
  if (!synopsis.toLowerCase().endsWith(`${filmLower}?`)) {
    // Strip any trailing punctuation and reattach with film title
    synopsis = synopsis.replace(/[.!?]+$/, '') + ` ${film}?`;
  }

  // Strip any mid-body film name occurrences (keep only first and last)
  synopsis = stripMidBodyFilmName(synopsis, film);

  return synopsis;
}

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const film = searchParams.get('film')?.trim() ?? '';

  if (!film) {
    return NextResponse.json({ error: 'Missing required parameter: film' }, { status: 400 });
  }

  const matchedEpisodes = findEpisodesByFilm(film);

  // Try to extract synopsis from each matched episode (most recent first)
  for (const episode of matchedEpisodes) {
    const epNum = typeof episode.episode === 'number' ? episode.episode : null;
    if (epNum === null) continue;

    const transcript = await loadTranscript(epNum);
    if (!transcript) continue;

    const extracted = extractSynopsis(transcript);
    if (extracted) {
      const response: SynopsisResponse = {
        film: episode.film,
        episodeNumber: epNum,
        episodeName: transcript.episode_name,
        pod: episode.pod,
        timestamp: extracted.timestamp || null,
        synopsis: extracted.text,
        source: 'transcript',
      };
      return NextResponse.json(response);
    }
  }

  // Fallback: generate with Claude
  const matchedEpisode = matchedEpisodes[0] ?? null;
  const epNum =
    matchedEpisode && typeof matchedEpisode.episode === 'number'
      ? matchedEpisode.episode
      : null;

  let synopsis: string;
  try {
    synopsis = await generateSynopsis(film);
  } catch (error) {
    console.error('Failed to generate synopsis:', error);
    return NextResponse.json({ error: 'Failed to generate synopsis' }, { status: 500 });
  }

  const response: SynopsisResponse = {
    film: matchedEpisode?.film ?? film,
    episodeNumber: epNum,
    episodeName: matchedEpisode?.film ?? null,
    pod: matchedEpisode?.pod ?? null,
    timestamp: null,
    synopsis,
    source: 'generated',
  };

  return NextResponse.json(response);
}
