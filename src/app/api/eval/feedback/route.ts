import { NextRequest, NextResponse } from 'next/server';
import { put } from '@vercel/blob';

interface EvalFeedbackEntry {
  id: string;
  timestamp: string;
  question: string;
  questionType: string;
  seedEpisode: string;
  answer: string;
  sourceCount: number;
  transcriptEpisodes: string[];
  rating: 'good' | 'bad';
  comment: string | null;
  latencyMs: number;
}

function generateEvalId(): string {
  const ts = Date.now().toString(36);
  const rand = Math.random().toString(36).substring(2, 8);
  return `ev_${ts}_${rand}`;
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const {
      question,
      questionType,
      seedEpisode,
      answer,
      sourceCount,
      transcriptEpisodes,
      rating,
      comment,
      latencyMs,
    } = body;

    if (!question || typeof question !== 'string') {
      return NextResponse.json({ error: 'Question is required' }, { status: 400 });
    }

    if (!rating || (rating !== 'good' && rating !== 'bad')) {
      return NextResponse.json({ error: 'Rating must be "good" or "bad"' }, { status: 400 });
    }

    if (!answer || typeof answer !== 'string') {
      return NextResponse.json({ error: 'Answer is required' }, { status: 400 });
    }

    const entry: EvalFeedbackEntry = {
      id: generateEvalId(),
      timestamp: new Date().toISOString(),
      question,
      questionType: questionType || 'unknown',
      seedEpisode: seedEpisode || 'unknown',
      answer,
      sourceCount: sourceCount || 0,
      transcriptEpisodes: transcriptEpisodes || [],
      rating,
      comment: comment?.trim() || null,
      latencyMs: latencyMs || 0,
    };

    const month = entry.timestamp.slice(0, 7);
    await put(`eval-human/${month}/${entry.id}.json`, JSON.stringify(entry), {
      access: 'public',
      contentType: 'application/json',
      addRandomSuffix: false,
    });

    return NextResponse.json({ success: true, id: entry.id });
  } catch (err) {
    console.error('Eval feedback error:', err);
    return NextResponse.json(
      { error: 'Failed to store feedback' },
      { status: 500 }
    );
  }
}
