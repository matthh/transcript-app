import { NextRequest, NextResponse } from 'next/server';
import { safeEqual } from '@/lib/podreview-auth';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const password = body?.password;
    const correct = process.env.PODREVIEW_PASSWORD;

    if (!correct) {
      return NextResponse.json({ error: 'PODREVIEW_PASSWORD not configured' }, { status: 500 });
    }

    if (typeof password !== 'string' || !safeEqual(password, correct)) {
      return NextResponse.json({ error: 'Invalid password' }, { status: 401 });
    }

    return NextResponse.json({ ok: true });
  } catch (e) {
    console.error('Auth error:', e);
    return NextResponse.json({ error: 'Invalid request' }, { status: 400 });
  }
}
