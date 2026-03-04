import { NextRequest, NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';
import Anthropic from '@anthropic-ai/sdk';
import { Transcript } from '@/types/transcript';
import { loadEpisodeMetadata } from '@/lib/metadata-store';
import { loadTranscript as loadBlobTranscript } from '@/lib/blob-storage';
import { episodeSortKey } from '@/lib/episode-format';
import type { EpisodeMetadata } from '@/types/episode-metadata';

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
const FEW_SHOT_EXAMPLES = [
  {
    film: 'Drive',
    synopsis:
      "Drive is a dangerous ride that asks whether you can chart your own course, get the girl, and hold on to your innocence as danger closes in all around you. Driver is a young car driving stuntman and mechanic who has allowed himself to get drawn into the seedy underworld of organized crime. He's highly sought after for his incredible skills as a wheel man and his steely, cool temperament under extreme pressure. Driver's world is upended when he meets Irene, an innocent mother with a young son. What seems to be a blossoming romance with Irene becomes complicated when her husband Standard returns from prison and immediately draws heat on to his family. In order to save Irene and her son, Driver will be forced into the heart of darkness as he goes head to head with the mafia. Will he have what it takes to defeat his enemies and emerge a free man, or will he be left as wreckage along the side of the road? Drive?",
  },
  {
    film: 'Inception',
    synopsis:
      "Inception is the search within ourselves for forgiveness and connection. Dom Cobb is an extractor using complex illegal technology devised by the government to kidnap and pull his targets into a dream where he can steal their secrets. But Cobb has a problem — when he and his wife Mal experimented with creating dreams within dreams, they found themselves lost in the limbo of their own subconscious, trapped together seemingly for decades, until Cobb forced them back up. Distraught and resorting to framing him for her own death, Mal now lives only in Cobb's dreams, and he is desperate to clear his name and return to his children in the real world. Taking on a dangerous heist for a powerful industrialist, Cobb will assemble a team of experts who construct a maze across interlocking dreams to place an idea deep in the subconscious of their target. But under desperate assault, as it becomes impossible to distinguish reality from collapsing dreams, can Cobb find his way through the labyrinth of his own mind, or will he be trapped by the guilt of his own inception?",
  },
  {
    film: '1917',
    synopsis:
      "1917 is a journey through darkness and death to honor the bonds of loyalty in the depths of the Great War. Over a century ago, Lance Corporals Tom Blake and Will Schofield are given an impossible mission: cross No Man's Land and venture deep into enemy territory to locate and warn two Allied battalions that are about to be lured into a deadly snare by a German feint. 1,600 lives are on the line, including Blake's own brother. With no time to consider, they set off on a treacherous course leading them across blasted landscapes, deadly underground tunnels, a nightmare hellscape of fire, and a literal river of the dead, confronting the ultimate sacrifice with every step. Can they stay true to their honor and complete their mission, or will it all be in vain as they draw their final breaths on an unmarked field in France in the spring of 1917?",
  },
];

function normalizeFilmName(name: string): string {
  return name
    .replace(/^Episode\s+\d+:\s*/i, '')  // strip "Episode 250: " prefix
    .replace(/\s*\([^)]+\)/g, '')         // strip "(year)" suffixes
    .replace(/\bFINAL\b/gi, '')           // strip "FINAL"
    .trim();
}

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

function findMatchingEpisodes(filmQuery: string): EpisodeMetadata[] {
  const episodes = loadEpisodeMetadata();
  const queryLower = filmQuery.toLowerCase();

  // Normalize both sides for matching (strip year suffixes etc.)
  const normalizedQuery = normalizeFilmName(filmQuery).toLowerCase();

  // Pass 1: exact match on raw film name
  const exactRaw = episodes.filter((e) => e.film.toLowerCase() === queryLower);
  if (exactRaw.length > 0) return sortDesc(exactRaw);

  // Pass 2: exact match on normalized film name (handles "Drive (2011)" → "Drive")
  const exactNorm = episodes.filter(
    (e) => normalizeFilmName(e.film).toLowerCase() === normalizedQuery
  );
  if (exactNorm.length > 0) return sortDesc(exactNorm);

  // Pass 3: partial match on normalized film name
  const partialMatches = episodes.filter((e) =>
    normalizeFilmName(e.film).toLowerCase().includes(normalizedQuery)
  );
  return sortDesc(partialMatches);
}

function sortDesc(episodes: EpisodeMetadata[]): EpisodeMetadata[] {
  return [...episodes].sort(
    (a, b) =>
      b.season * 1000 +
      episodeSortKey(b.episode) -
      (a.season * 1000 + episodeSortKey(a.episode))
  );
}

async function generateSynopsis(film: string): Promise<string> {
  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

  const examples = FEW_SHOT_EXAMPLES.map(
    (ex) => `Film: ${ex.film}\nSynopsis: ${ex.synopsis}`
  ).join('\n\n');

  const prompt = `You are writing a podcast intro synopsis in the exact style of "Haitch" from the Escape Hatch Podcast. Study these real examples carefully:

${examples}

Now write a synopsis for: ${film}

Style rules:
- Open with "{Film} is [thematic statement]" — a poetic, thematic sentence about what the film is really about
- Follow with 3-5 sentences summarizing the plot: who the protagonist is, what they want, what obstacles they face
- The FINAL sentence must be a question that starts with "or will" and ends with the film title followed by a question mark — the film title must be the very last word(s) before the final "?" e.g. "or will [outcome]? ${film}?" — this is mandatory, never end on anything else
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

  // Safety net: if the synopsis doesn't end with the film title, append it
  const filmLower = film.toLowerCase();
  const synopsisLower = synopsis.toLowerCase();
  const endsWithFilm = synopsisLower.endsWith(`${filmLower}?`) || synopsisLower.endsWith(`${filmLower}.`);
  if (!endsWithFilm && synopsis.endsWith('?')) {
    synopsis = `${synopsis} ${film}?`;
  }

  return synopsis;
}

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const film = searchParams.get('film')?.trim() ?? '';

  if (!film) {
    return NextResponse.json({ error: 'Missing required parameter: film' }, { status: 400 });
  }

  const matchedEpisodes = findMatchingEpisodes(film);

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
