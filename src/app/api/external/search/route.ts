import { NextRequest, NextResponse } from 'next/server';
import { runSearch } from '@/lib/search-pipeline';
import { validateExternalKey } from '@/lib/external-auth';
import { checkRateLimit } from '@/lib/external-rate-limit';
import { toExternalResponse } from '@/lib/external-response';

const MAX_EXTERNAL_LIMIT = 20;
const DEFAULT_EXTERNAL_LIMIT = 8;
const MAX_QUERY_LENGTH = 2000;

export async function POST(request: NextRequest) {
  const auth = validateExternalKey(request.headers.get('x-eh-key'));
  if (!auth.ok) {
    return NextResponse.json(
      { error: auth.reason === 'missing' ? 'Missing x-eh-key header' : 'Invalid key' },
      { status: 401 },
    );
  }

  const rl = checkRateLimit(auth.keyId);
  if (!rl.allowed) {
    const headers: Record<string, string> = {};
    if (rl.retryAfterSec) headers['Retry-After'] = String(rl.retryAfterSec);
    return NextResponse.json(
      { error: `Rate limit exceeded (${rl.scope})`, retryAfterSec: rl.retryAfterSec },
      { status: 429, headers },
    );
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const { query, limit: rawLimit } = (body ?? {}) as { query?: unknown; limit?: unknown };
  if (!query || typeof query !== 'string' || query.trim().length === 0) {
    return NextResponse.json({ error: 'query is required' }, { status: 400 });
  }
  if (query.length > MAX_QUERY_LENGTH) {
    return NextResponse.json(
      { error: `query exceeds ${MAX_QUERY_LENGTH} chars` },
      { status: 400 },
    );
  }

  const limit = typeof rawLimit === 'number' && Number.isFinite(rawLimit)
    ? Math.min(MAX_EXTERNAL_LIMIT, Math.max(1, Math.floor(rawLimit)))
    : DEFAULT_EXTERNAL_LIMIT;

  try {
    const internal = await runSearch({
      query,
      limit,
      source: 'external',
      externalKeyId: auth.keyId,
    });
    const external = toExternalResponse(internal, limit, internal.queryId);
    return NextResponse.json(external);
  } catch (err) {
    console.error('External search error:', err, { keyId: auth.keyId });
    return NextResponse.json(
      { error: 'Search failed. Please try again.' },
      { status: 500 },
    );
  }
}
