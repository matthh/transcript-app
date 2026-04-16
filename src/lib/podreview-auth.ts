import { NextRequest } from 'next/server';
import { timingSafeEqual } from 'crypto';

/**
 * Constant-time string comparison to avoid timing attacks against
 * bearer-token / password equality checks.
 */
export function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ab.length !== bb.length) return false;
  return timingSafeEqual(ab, bb);
}

export function checkAuth(request: NextRequest): boolean {
  const auth = request.headers.get('authorization');
  if (!auth?.startsWith('Bearer ')) return false;
  const provided = auth.slice(7);
  const expected = process.env.PODREVIEW_PASSWORD;
  if (!expected) return false;
  return safeEqual(provided, expected);
}
