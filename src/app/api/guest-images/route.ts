import { NextRequest, NextResponse } from 'next/server';
import * as fs from 'fs';
import * as path from 'path';
import { checkAuth } from '@/lib/podreview-auth';

const DATA_PATH = path.join(process.cwd(), 'data', 'guest-images.json');

function loadImages(): Record<string, { imageUrl: string; source: string; profileUrl?: string }> {
  try {
    return JSON.parse(fs.readFileSync(DATA_PATH, 'utf-8'));
  } catch {
    return {};
  }
}

function saveImages(data: Record<string, unknown>) {
  fs.writeFileSync(DATA_PATH, JSON.stringify(data, null, 2) + '\n');
}

export async function GET() {
  const images = loadImages();
  return NextResponse.json(images);
}

export async function POST(request: NextRequest) {
  if (!checkAuth(request)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const body = await request.json();
    const { name, imageUrl, originalUrl } = body;

    if (!name || typeof name !== 'string') {
      return NextResponse.json({ error: 'Missing or invalid name' }, { status: 400 });
    }

    const images = loadImages();
    if (!images[name]) {
      return NextResponse.json({ error: `Guest "${name}" not found` }, { status: 404 });
    }

    // Reject URLs that are Instagram/Twitter page links, not actual image files
    if (imageUrl && /^https?:\/\/(www\.)?(instagram\.com|x\.com|twitter\.com)\/[a-zA-Z]/.test(imageUrl)) {
      return NextResponse.json({ error: 'That looks like a profile page URL, not a direct image URL. Right-click the image → Copy Image Address.' }, { status: 400 });
    }
    images[name].imageUrl = imageUrl || '';
    if (imageUrl) {
      images[name].source = 'manual';
    }
    // Always save the original uncropped source for re-cropping later
    if (originalUrl) {
      (images[name] as any).originalUrl = originalUrl;
    }

    saveImages(images);
    return NextResponse.json({ ok: true, guest: name, imageUrl });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
