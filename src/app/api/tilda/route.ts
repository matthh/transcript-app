import { NextRequest, NextResponse } from 'next/server';
import Anthropic from '@anthropic-ai/sdk';
import { loadEpisodeMetadata } from '@/lib/metadata-store';
import { episodeSortKey } from '@/lib/episode-format';
import type { EpisodeMetadata } from '@/types/episode-metadata';

export type TildaResponse = {
  film: string;
  episodeNumber: number | null;
  pod: string | null;
  tildaH: string | null;
  tildaJason: string | null;
  tildaGuest: string | null;
  tildaCorey: string | null;
  source: 'metadata' | 'generated';
};

// Real examples for few-shot prompting
const FEW_SHOT_EXAMPLES = [
  {
    film: 'No Country for Old Men',
    tildaH: 'Deputy Wendell',
    tildaJason: 'Mother of Carla Jean or Woody Harrelson',
  },
  {
    film: 'Ex Machina',
    tildaH: 'Kyoko',
    tildaJason: 'All 4 roles — this would be a Tilda one-woman show',
  },
  {
    film: 'Drive',
    tildaH: 'The child: Benicio',
    tildaJason: 'Agree with Bernie Rose',
  },
  {
    film: 'Mission Impossible: Fallout',
    tildaH: 'Lane or Benji',
    tildaJason: 'Wolf Blitzer or Lane',
  },
];

function normalizeFilmName(name: string): string {
  return name
    .replace(/^Episode\s+\d+:\s*/i, '')
    .replace(/\s*\([^)]+\)/g, '')
    .replace(/\bFINAL\b/gi, '')
    .trim();
}

function isBlank(val: string | null | undefined): boolean {
  return !val || val.trim() === '' || val.trim().toUpperCase() === 'N/A';
}

function nullIfBlank(val: string | null | undefined): string | null {
  return isBlank(val) ? null : (val as string).trim();
}

function findMatchingEpisodes(filmQuery: string): EpisodeMetadata[] {
  const episodes = loadEpisodeMetadata();
  const queryLower = filmQuery.toLowerCase();
  const normalizedQuery = normalizeFilmName(filmQuery).toLowerCase();

  const exactRaw = episodes.filter((e) => e.film.toLowerCase() === queryLower);
  if (exactRaw.length > 0) return sortDesc(exactRaw);

  const exactNorm = episodes.filter(
    (e) => normalizeFilmName(e.film).toLowerCase() === normalizedQuery
  );
  if (exactNorm.length > 0) return sortDesc(exactNorm);

  const partial = episodes.filter((e) =>
    normalizeFilmName(e.film).toLowerCase().includes(normalizedQuery)
  );
  return sortDesc(partial);
}

function sortDesc(episodes: EpisodeMetadata[]): EpisodeMetadata[] {
  return [...episodes].sort(
    (a, b) =>
      b.season * 1000 +
      episodeSortKey(b.episode) -
      (a.season * 1000 + episodeSortKey(a.episode))
  );
}

async function fetchTmdbCast(film: string): Promise<string | null> {
  const apiKey = process.env.TMDB_API_KEY;
  if (!apiKey) return null;
  try {
    const searchParams = new URLSearchParams({ api_key: apiKey, query: film });
    const searchRes = await fetch(`https://api.themoviedb.org/3/search/movie?${searchParams}`);
    if (!searchRes.ok) return null;
    const searchData = (await searchRes.json()) as { results?: { id: number }[] };
    const movieId = searchData.results?.[0]?.id;
    if (!movieId) return null;

    const creditsRes = await fetch(
      `https://api.themoviedb.org/3/movie/${movieId}/credits?api_key=${apiKey}`
    );
    if (!creditsRes.ok) return null;
    const creditsData = (await creditsRes.json()) as {
      cast?: { name: string; character: string }[];
    };
    const top = (creditsData.cast ?? []).slice(0, 12);
    if (top.length === 0) return null;
    return top.map((c) => `${c.character} (played by ${c.name})`).join(', ');
  } catch {
    return null;
  }
}

async function generateTilda(film: string): Promise<{ tildaH: string | null; tildaJason: string | null; tildaCorey: string | null }> {
  const [client, castInfo] = await Promise.all([
    Promise.resolve(new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })),
    fetchTmdbCast(film),
  ]);

  const examples = FEW_SHOT_EXAMPLES.map(
    (ex) => `Film: ${ex.film}\nHaitch: ${ex.tildaH}\nJason: ${ex.tildaJason}`
  ).join('\n\n');

  const castSection = castInfo
    ? `\nCharacters in ${film}: ${castInfo}\n`
    : '';

  const prompt = `On the Escape Hatch Podcast, hosts Haitch, Jason, and Corey answer the question: "Who would Tilda Swinton play in this film?" Their answers are always actual characters from the movie — sometimes unexpected choices, sometimes multiple options, sometimes with a brief quip. Study these real examples:

${examples}
${castSection}
Now generate answers for: ${film}

Rules:
- Characters must actually appear in ${film}
- Match their voice: Haitch tends toward unexpected or thematic choices, Jason sometimes agrees or picks alternatives, Corey picks something different again
- Keep it short — just the character name(s), optionally one short quip
- Output exactly three lines:
Haitch: [answer]
Jason: [answer]
Corey: [answer]`;

  const message = await client.messages.create({
    model: 'claude-haiku-4-5-20251001',
    max_tokens: 160,
    messages: [{ role: 'user', content: prompt }],
  });

  const textBlock = message.content.find((b) => b.type === 'text');
  if (!textBlock || textBlock.type !== 'text') throw new Error('No text in Claude response');

  const lines = textBlock.text.trim().split('\n');
  const hLine = lines.find((l) => l.startsWith('Haitch:'));
  const jLine = lines.find((l) => l.startsWith('Jason:'));
  const cLine = lines.find((l) => l.startsWith('Corey:'));

  if (!hLine && !jLine && !cLine) {
    throw new Error(`Could not generate Tilda answers for "${film}" — the film may not have suitable fictional characters`);
  }

  return {
    tildaH: hLine ? hLine.replace(/^Haitch:\s*/, '').trim() : null,
    tildaJason: jLine ? jLine.replace(/^Jason:\s*/, '').trim() : null,
    tildaCorey: cLine ? cLine.replace(/^Corey:\s*/, '').trim() : null,
  };
}

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const film = searchParams.get('film')?.trim() ?? '';

  if (!film) {
    return NextResponse.json({ error: 'Missing required parameter: film' }, { status: 400 });
  }

  const matches = findMatchingEpisodes(film);
  const episode = matches[0] ?? null;
  const epNum = episode && typeof episode.episode === 'number' ? episode.episode : null;

  // If we have a matched episode with real tilda answers, return them
  if (episode) {
    const tH = nullIfBlank(episode.tildaH);
    const tJ = nullIfBlank(episode.tildaJason);
    const tG = nullIfBlank(episode.tildaGuest);
    const tC = nullIfBlank(episode.tildaCorey);

    if (tH || tJ) {
      const response: TildaResponse = {
        film: episode.film,
        episodeNumber: epNum,
        pod: episode.pod,
        tildaH: tH,
        tildaJason: tJ,
        tildaGuest: tG,
        tildaCorey: tC,
        source: 'metadata',
      };
      return NextResponse.json(response);
    }
  }

  // Generate with Claude
  let generated: { tildaH: string | null; tildaJason: string | null; tildaCorey: string | null };
  try {
    generated = await generateTilda(film);
  } catch (error) {
    console.error('Failed to generate tilda answer:', error);
    return NextResponse.json({ error: 'Failed to generate answer' }, { status: 500 });
  }

  const response: TildaResponse = {
    film: episode?.film ?? film,
    episodeNumber: epNum,
    pod: episode?.pod ?? null,
    tildaH: generated.tildaH,
    tildaJason: generated.tildaJason,
    tildaGuest: null,
    tildaCorey: generated.tildaCorey,
    source: 'generated',
  };
  return NextResponse.json(response);
}
