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

  const vectorStart = Date.now();
  const vectorStore = await loadVectorStoreAsync();
  const vectorMs = Date.now() - vectorStart;

  const bm25Start = Date.now();
  const bm25Index = await loadBM25IndexAsync();
  const bm25Ms = Date.now() - bm25Start;

  const totalMs = Date.now() - startedAt;

  return NextResponse.json({
    ok: true,
    totalMs,
    vectorStore: {
      chunks: vectorStore.length,
      ms: vectorMs,
    },
    bm25: {
      docs: bm25Index?.numDocs || 0,
      ms: bm25Ms,
    },
  });
}
