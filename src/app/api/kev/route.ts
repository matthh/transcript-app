import { NextRequest, NextResponse } from 'next/server';
import Anthropic from '@anthropic-ai/sdk';
import { findEpisodesByFilm } from '@/lib/metadata-store';

export type KevResponse = {
  film: string;
  episodeNumber: number | null;
  pod: string | null;
  question: string;
  source: 'metadata' | 'generated';
};

const BLANK_QUESTION = new Set(['n/a', 'na', '']);
const NO_QUESTION_SIGNALS = ['voicemail', 'no question', 'but no question'];

function isRealQuestion(q: string | null | undefined): boolean {
  if (!q) return false;
  const lower = q.trim().toLowerCase();
  if (BLANK_QUESTION.has(lower)) return false;
  if (NO_QUESTION_SIGNALS.some((s) => lower.includes(s))) return false;
  return q.trim().length > 10;
}

const FEW_SHOT_EXAMPLES = [
  'If you could put Christopher Walken in any fairy tale, what would it be and why?',
  'What is your least favorite performance by your favorite actor (can\'t be Tilda!)?',
  'Tell me about your crazy commutes where everything goes wrong, and you find out that God is real and he hates you.',
  'Is there a forgotten TV show that you think would make a movie as great as The Fugitive?',
  'If you could put any episode of Escape Hatch on the Voyager records, what would it be and why?',
  'TRON Legacy is one of the most underrated movies ever, in my opinion. What is a movie that you champion?',
];


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

async function generateKevQuestion(film: string): Promise<string> {
  const [client, tmdbOverview] = await Promise.all([
    Promise.resolve(new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })),
    fetchTmdbOverview(film),
  ]);

  const examples = FEW_SHOT_EXAMPLES.map((q) => `- ${q}`).join('\n');

  const filmContext = tmdbOverview ? `\nFilm context: ${tmdbOverview}\n` : '';

  const prompt = `"Kev" is a loyal listener of the Escape Hatch Podcast who submits a quirky question each week for the hosts to answer. His questions are personal, sometimes pop-culture adjacent, often a little absurd, and frequently end with "and why?" Study these real examples:

${examples}
${filmContext}
Now write ONE Kev-style question inspired by the themes or era of the film: ${film}

Rules:
- One question only, no preamble
- Should feel personal and a little odd, like Kev wrote it
- Can reference the film's themes, era, or mood — but doesn't have to be directly about the film
- Keep it under 200 characters`;

  const message = await client.messages.create({
    model: 'claude-haiku-4-5-20251001',
    max_tokens: 100,
    messages: [{ role: 'user', content: prompt }],
  });

  const textBlock = message.content.find((b) => b.type === 'text');
  if (!textBlock || textBlock.type !== 'text') throw new Error('No text in Claude response');
  return textBlock.text.trim().replace(/^["']|["']$/g, '');
}

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const film = searchParams.get('film')?.trim() ?? '';

  if (!film) {
    return NextResponse.json({ error: 'Missing required parameter: film' }, { status: 400 });
  }

  const episode = findEpisodesByFilm(film)[0] ?? null;
  const epNum = episode && typeof episode.episode === 'number' ? episode.episode : null;

  if (episode && isRealQuestion(episode.kevsQuestion)) {
    return NextResponse.json({
      film: episode.film,
      episodeNumber: epNum,
      pod: episode.pod,
      question: episode.kevsQuestion!.trim(),
      source: 'metadata',
    } satisfies KevResponse);
  }

  let question: string;
  try {
    question = await generateKevQuestion(film);
  } catch (error) {
    console.error('Failed to generate Kev question:', error);
    return NextResponse.json({ error: 'Failed to generate question' }, { status: 500 });
  }

  return NextResponse.json({
    film: episode?.film ?? film,
    episodeNumber: epNum,
    pod: episode?.pod ?? null,
    question,
    source: 'generated',
  } satisfies KevResponse);
}
