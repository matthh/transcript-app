import { NextResponse } from 'next/server';
import { getAnthropic } from '@/lib/claude';
import { loadEpisodeMetadata } from '@/lib/metadata-store';
import { QUICK_SYNTHESIS } from '@/lib/routing-policy';

export async function POST() {
  try {
    const episodes = loadEpisodeMetadata();

    // Pick 5-8 random episodes
    const count = 5 + Math.floor(Math.random() * 4);
    const shuffled = [...episodes].sort(() => Math.random() - 0.5);
    const sample = shuffled.slice(0, count);

    const episodeSummaries = sample
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

    const message = await getAnthropic().messages.create({
      model: QUICK_SYNTHESIS.model,
      max_tokens: 200,
      temperature: 1,
      messages: [
        {
          role: 'user',
          content: `You are generating search evaluation questions for a podcast search engine (Escape Hatch Pod — a movie review podcast).

Given these episode summaries, generate ONE natural search question that a listener might ask. Vary the question type randomly:

- Factual: "Who was the guest on the X episode?" or "Which episodes cover 80s films?"
- Interpretive: "What did the hosts think about X?" or "How did they feel about the director's choices in X?"
- Cross-episode: "Compare what the hosts said about [director] across episodes" or "Which horror films did they enjoy most?"
- Quote/phrase: "Did anyone mention X?" or "What was said about Y?"
- Person-scoped: "What has Haitch said about X?" or "What does Jason think about Y?"

EPISODES:
${episodeSummaries}

Respond in JSON format only:
{"question": "...", "type": "factual|interpretive|cross-episode|quote|person-scoped", "seedEpisode": "film title of primary episode used"}`,
        },
      ],
    });

    const textBlock = message.content.find((block) => block.type === 'text');
    if (!textBlock) {
      return NextResponse.json({ error: 'No response from model' }, { status: 500 });
    }

    const parsed = JSON.parse(textBlock.text);
    return NextResponse.json(parsed);
  } catch (err) {
    console.error('Question generation error:', err);
    return NextResponse.json(
      { error: 'Failed to generate question' },
      { status: 500 }
    );
  }
}
