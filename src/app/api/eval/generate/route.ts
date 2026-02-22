import { NextResponse } from 'next/server';
import { getAnthropic } from '@/lib/claude';
import { loadEpisodeMetadata } from '@/lib/metadata-store';
import { loadVectorStoreAsync, StoredChunk } from '@/lib/vectorstore';
import { QUICK_SYNTHESIS } from '@/lib/routing-policy';

function buildMetadataPrompt(episodeSummaries: string): string {
  return `You are generating search evaluation questions for a podcast search engine (Escape Hatch Pod — a movie review podcast).

Given these episode summaries, generate ONE natural search question that a listener might ask. Vary the question type randomly:

- Factual: "Who was the guest on the X episode?" or "Which episodes cover 80s films?"
- Interpretive: "What did the hosts think about X?" or "How did they feel about the director's choices in X?"
- Cross-episode: "Compare what the hosts said about [director] across episodes" or "Which horror films did they enjoy most?"
- Quote/phrase: "Did anyone mention X?" or "What was said about Y?"
- Person-scoped: "What has Haitch said about X?" or "What does Jason think about Y?"

EPISODES:
${episodeSummaries}

Respond in JSON format only:
{"question": "...", "type": "factual|interpretive|cross-episode|quote|person-scoped", "seedEpisode": "film title of primary episode used"}`;
}

function buildTranscriptPrompt(chunkSummaries: string): string {
  return `You are generating search evaluation questions for a podcast search engine (Escape Hatch Pod — a movie review podcast).

Given these transcript excerpts from actual episodes, generate ONE natural search question that a real listener might ask. The question should be the kind that requires searching through transcripts — specific moments, recurring ideas, or things someone actually said.

Vary the question type randomly:

- Incident/moment: "What happened when they started talking about X?" or "Tell me about the discussion on Y"
- Recurring theme: "How often do the hosts bring up X?" or "Do they ever talk about Y?"
- Specific quote: "Who said something about X?" or "What was the quote about Y?"
- Cross-reference: "They mentioned X in one episode — did that come up again?"
- Opinion deep-dive: "What's Jason's take on X?" or "How does Haitch feel about Y?"

TRANSCRIPT EXCERPTS:
${chunkSummaries}

Respond in JSON format only:
{"question": "...", "type": "incident|recurring-theme|quote|cross-reference|opinion", "seedEpisode": "episode title from the primary excerpt used"}`;
}

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

function sampleTranscriptChunks(chunks: StoredChunk[]): string {
  // Pick 3-5 random chunks, trim text to ~300 chars each
  const count = 3 + Math.floor(Math.random() * 3);
  const shuffled = [...chunks].sort(() => Math.random() - 0.5);
  const sample = shuffled.slice(0, count);

  return sample
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

export async function POST() {
  try {
    // Decide seed mode: 50/50 metadata vs transcript
    const chunks = await loadVectorStoreAsync();
    const useTranscript = chunks.length > 0 && Math.random() < 0.5;

    const prompt = useTranscript
      ? buildTranscriptPrompt(sampleTranscriptChunks(chunks))
      : buildMetadataPrompt(sampleMetadata());

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
