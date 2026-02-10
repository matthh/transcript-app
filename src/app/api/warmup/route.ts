import { NextRequest, NextResponse } from 'next/server';
import { loadVectorStoreAsync } from '@/lib/vectorstore';
import { loadBM25IndexAsync } from '@/lib/bm25-loader';

export const runtime = 'nodejs';

export async function GET(request: NextRequest) {
  const token = process.env.WARMUP_TOKEN;
  if (token) {
    const provided = request.headers.get('x-warmup-token')
      || request.nextUrl.searchParams.get('token');
    if (provided !== token) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
  }

  const startedAt = Date.now();

  // Load both in parallel (saves ~50% on cold start vs sequential)
  const vectorPromise = loadVectorStoreAsync().then(r => ({ data: r, ms: Date.now() - startedAt }));
  const bm25Promise = loadBM25IndexAsync().then(r => ({ data: r, ms: Date.now() - startedAt }));
  const [vectorResult, bm25Result] = await Promise.all([vectorPromise, bm25Promise]);

  const totalMs = Date.now() - startedAt;
  const vectorStore = vectorResult.data;
  const bm25Index = bm25Result.data;

  return NextResponse.json({
    ok: true,
    totalMs,
    vectorStore: {
      chunks: vectorStore.length,
      ms: vectorResult.ms,
    },
    bm25: {
      docs: bm25Index?.numDocs || 0,
      ms: bm25Result.ms,
    },
  });
}
