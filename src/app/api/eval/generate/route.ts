import { NextRequest, NextResponse } from 'next/server';
import { getAnthropic } from '@/lib/claude';
import { loadEpisodeMetadata } from '@/lib/metadata-store';
import { loadVectorStoreAsync, StoredChunk } from '@/lib/vectorstore';
import { QUICK_SYNTHESIS } from '@/lib/routing-policy';
import { EpisodeMetadata } from '@/types/episode-metadata';
import { checkAuth } from '@/lib/podreview-auth';

// ---------- Failure-mode-aware adversarial question types ----------
// Derived from docs/query-failure-modes.md FM-01 through FM-13

const ADVERSARIAL_TYPES = `
IMPORTANT: Vary the question type randomly, but strongly prefer these adversarial styles that stress-test the search pipeline:

- Multi-referent: Ask about a term/name that could refer to multiple things (a person, character, franchise, concept). E.g. "What have they said about Zelda?" (could be the game, the actress, or a character).
- Negation/absence: Ask about something NOT happening. E.g. "Are there any Spielberg films they didn't like?" or "Did they ever skip Kev's question?"
- Person-scoped attribution: Ask what a specific host said, requiring the system to distinguish speakers. E.g. "What has Haitch specifically said about practical effects?" or "What's Jason's opinion on horror remakes?"
- Cross-episode counting: Ask how many episodes or how often something comes up. E.g. "How many episodes mention Stanley Kubrick?" or "How often do they discuss film school?"
- Vague/colloquial: Use imprecise phrasing like a real person would. E.g. "that bit where someone rants about CGI" or "the argument about sequels"
- Ambiguous intent: Questions that blur factual and interpretive. E.g. "What's the deal with their 80s movies?" (could want a list OR opinions).
- Episode-specific scoping: Ask about something in a SPECIFIC episode when the topic appears in multiple. E.g. "What did they say about [director] in the [film] episode specifically?"
- Weak-evidence opinion: Ask for strongest preferences or rankings. E.g. "What's their all-time favorite film they've covered?" or "Which guest was the most controversial?"`;

// ---------- Prompt builders ----------

function buildMetadataPrompt(episodeSummaries: string): string {
  return `You are generating search evaluation questions for a podcast search engine (Escape Hatch Pod — a movie review podcast with hosts Jason, Haitch, and sometimes guests).

Given these episode summaries, generate ONE natural search question that a listener might ask.
${ADVERSARIAL_TYPES}

Also include these standard types occasionally:
- Factual: "Who was the guest on the X episode?"
- Interpretive: "What did the hosts think about X?"
- Cross-episode: "Compare what the hosts said about [director] across episodes"

EPISODES:
${episodeSummaries}

Respond in JSON format only:
{"question": "...", "type": "multi-referent|negation|attribution|counting|vague|ambiguous|episode-scoped|weak-evidence|factual|interpretive|cross-episode", "seedEpisode": "film title of primary episode used"}`;
}

function buildTranscriptPrompt(chunkSummaries: string): string {
  return `You are generating search evaluation questions for a podcast search engine (Escape Hatch Pod — a movie review podcast with hosts Jason, Haitch, and sometimes guests).

Given these transcript excerpts from actual episodes, generate ONE natural search question that a real listener might ask. The question should be grounded in what you see in the excerpts — specific moments, people, phrases, or ideas.
${ADVERSARIAL_TYPES}

Also include these transcript-specific types occasionally:
- Incident/moment: "What happened when they started talking about X?"
- Specific quote: "Who said something about X?"
- Recurring theme: "Do they ever talk about Y?"

TRANSCRIPT EXCERPTS:
${chunkSummaries}

Respond in JSON format only:
{"question": "...", "type": "multi-referent|negation|attribution|counting|vague|ambiguous|episode-scoped|weak-evidence|incident|quote|recurring-theme", "seedEpisode": "episode title from the primary excerpt used"}`;
}

function buildHardNegativePrompt(chunkSummaries: string, sharedTopic: string): string {
  return `You are generating search evaluation questions for a podcast search engine (Escape Hatch Pod — a movie review podcast with hosts Jason, Haitch, and sometimes guests).

Below are transcript excerpts from DIFFERENT episodes that all relate to the topic "${sharedTopic}". The search engine needs to distinguish between these episodes correctly.

Generate ONE natural search question that requires the system to find information from a SPECIFIC episode while ignoring the similar content from other episodes. The question should be hard — it should be easy to accidentally return content from the wrong episode.

Question styles to use:
- "In the [specific episode] episode, what did they say about ${sharedTopic}?"
- "What was [host]'s take on ${sharedTopic} when they discussed [specific film]?"
- "Did they mention ${sharedTopic} in the [film] episode, and what was the context?"

TRANSCRIPT EXCERPTS (from different episodes, same topic):
${chunkSummaries}

Respond in JSON format only:
{"question": "...", "type": "hard-negative", "seedEpisode": "the specific episode the question targets"}`;
}

// ---------- Samplers ----------

function sampleMetadata(): string {
  const episodes = loadEpisodeMetadata();
  const count = 5 + Math.floor(Math.random() * 4);
  const shuffled = [...episodes].sort(() => Math.random() - 0.5);
  const sample = shuffled.slice(0, count);

  return sample
    .map((ep, i) => {
      const parts = [`[${i + 1}] "${ep.film}"`];
      if (ep.guest) parts.push(`Guest: ${ep.guest}`);
      if (ep.notableMoments) parts.push(`Notable: ${ep.notableMoments}`);
      if (ep.kevsQuestion) parts.push(`Kev's Question: ${ep.kevsQuestion}`);
      if (ep.directors?.length) parts.push(`Director(s): ${ep.directors.join(', ')}`);
      if (ep.genres?.length) parts.push(`Genres: ${ep.genres.join(', ')}`);
      if (ep.reviewer) parts.push(`Reviewer: ${ep.reviewer}`);
      return parts.join('\n  ');
    })
    .join('\n\n');
}

function formatChunks(chunks: StoredChunk[]): string {
  return chunks
    .map((chunk, i) => {
      const text = chunk.text.length > 300
        ? chunk.text.slice(0, 300) + '...'
        : chunk.text;
      return `[${i + 1}] Episode: "${chunk.metadata.episodeTitle}"
  Speakers: ${chunk.metadata.speakers}
  Timestamp: ${chunk.metadata.startTimestamp} - ${chunk.metadata.endTimestamp}
  Text: ${text}`;
    })
    .join('\n\n');
}

function sampleTranscriptChunks(chunks: StoredChunk[]): string {
  const count = 3 + Math.floor(Math.random() * 3);
  const shuffled = [...chunks].sort(() => Math.random() - 0.5);
  return formatChunks(shuffled.slice(0, count));
}

/**
 * Find chunks from different episodes that share a topical keyword.
 * Returns the chunks and the shared topic, or null if no good pair found.
 */
function sampleHardNegativeChunks(
  chunks: StoredChunk[],
  episodes: EpisodeMetadata[]
): { chunks: string; topic: string } | null {
  // Pick a shared topic from directors, genres, or cast across episodes
  const topicCandidates: { topic: string; field: string }[] = [];
  for (const ep of episodes) {
    for (const d of ep.directors || []) topicCandidates.push({ topic: d, field: 'director' });
    for (const g of ep.genres || []) topicCandidates.push({ topic: g, field: 'genre' });
  }

  // Count topic frequency — we want topics that appear in 2+ episodes
  const topicCounts = new Map<string, number>();
  for (const { topic } of topicCandidates) {
    topicCounts.set(topic, (topicCounts.get(topic) || 0) + 1);
  }

  const sharedTopics = [...topicCounts.entries()]
    .filter(([, count]) => count >= 2)
    .map(([topic]) => topic);

  if (sharedTopics.length === 0) return null;

  // Pick a random shared topic
  const topic = sharedTopics[Math.floor(Math.random() * sharedTopics.length)];
  const topicLower = topic.toLowerCase();

  // Find chunks that mention this topic from different episodes
  const matching = chunks.filter(
    (c) => c.text.toLowerCase().includes(topicLower)
  );

  // Group by episode and take one chunk per episode
  const byEpisode = new Map<string, StoredChunk>();
  for (const chunk of matching) {
    if (!byEpisode.has(chunk.metadata.episodeTitle)) {
      byEpisode.set(chunk.metadata.episodeTitle, chunk);
    }
  }

  const episodeChunks = [...byEpisode.values()];
  if (episodeChunks.length < 2) return null;

  // Take 2-4 chunks from different episodes
  const shuffled = episodeChunks.sort(() => Math.random() - 0.5);
  const selected = shuffled.slice(0, Math.min(4, shuffled.length));

  return { chunks: formatChunks(selected), topic };
}

// ---------- Route handler ----------

type GenerationMode = 'metadata' | 'transcript' | 'hard-negative';

export async function POST(request: NextRequest) {
  if (!checkAuth(request)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const chunks = await loadVectorStoreAsync();
    const episodes = loadEpisodeMetadata();
    const hasChunks = chunks.length > 0;

    // Pick generation mode: 35% metadata, 35% transcript, 30% hard-negative
    let mode: GenerationMode;
    const roll = Math.random();
    if (!hasChunks) {
      mode = 'metadata';
    } else if (roll < 0.35) {
      mode = 'metadata';
    } else if (roll < 0.70) {
      mode = 'transcript';
    } else {
      mode = 'hard-negative';
    }

    let prompt: string;

    if (mode === 'hard-negative') {
      const hardNeg = sampleHardNegativeChunks(chunks, episodes);
      if (hardNeg) {
        prompt = buildHardNegativePrompt(hardNeg.chunks, hardNeg.topic);
      } else {
        // Fallback to transcript mode if no shared topics found
        mode = 'transcript';
        prompt = buildTranscriptPrompt(sampleTranscriptChunks(chunks));
      }
    } else if (mode === 'transcript') {
      prompt = buildTranscriptPrompt(sampleTranscriptChunks(chunks));
    } else {
      prompt = buildMetadataPrompt(sampleMetadata());
    }

    const message = await getAnthropic().messages.create({
      model: QUICK_SYNTHESIS.model,
      max_tokens: 200,
      temperature: 1,
      messages: [{ role: 'user', content: prompt }],
    });

    const textBlock = message.content.find((block) => block.type === 'text');
    if (!textBlock) {
      return NextResponse.json({ error: 'No response from model' }, { status: 500 });
    }

    // Extract JSON from response (handle markdown code fences)
    const jsonMatch = textBlock.text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      console.error('No JSON in generate response:', textBlock.text);
      return NextResponse.json({ error: 'Invalid model response' }, { status: 500 });
    }

    const parsed = JSON.parse(jsonMatch[0]);
    return NextResponse.json(parsed);
  } catch (err) {
    console.error('Question generation error:', err);
    return NextResponse.json(
      { error: 'Failed to generate question' },
      { status: 500 }
    );
  }
}
