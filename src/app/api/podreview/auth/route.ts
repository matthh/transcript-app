import { NextRequest, NextResponse } from 'next/server';

export async function POST(request: NextRequest) {
  const { password } = await request.json();
  const correct = process.env.PODREVIEW_PASSWORD;

  if (!correct) {
    return NextResponse.json({ error: 'PODREVIEW_PASSWORD not configured' }, { status: 500 });
  }

  if (password !== correct) {
    return NextResponse.json({ error: 'Invalid password' }, { status: 401 });
  }

  return NextResponse.json({ ok: true });
}
