import { NextRequest } from 'next/server';
import { timingSafeEqual } from 'crypto';

export function checkAuth(request: NextRequest): boolean {
  const auth = request.headers.get('authorization');
  if (!auth?.startsWith('Bearer ')) return false;
  const provided = auth.slice(7);
  const expected = process.env.PODREVIEW_PASSWORD ?? '';
  if (provided.length !== expected.length) return false;
  return timingSafeEqual(Buffer.from(provided), Buffer.from(expected));
}
