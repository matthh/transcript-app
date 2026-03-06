import { NextRequest } from 'next/server';

export function checkAuth(request: NextRequest): boolean {
  const auth = request.headers.get('authorization');
  if (!auth?.startsWith('Bearer ')) return false;
  return auth.slice(7) === process.env.PODREVIEW_PASSWORD;
}
