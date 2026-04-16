import { NextRequest, NextResponse } from 'next/server';
import * as fs from 'fs';
import * as path from 'path';
import Anthropic from '@anthropic-ai/sdk';
import { checkAuth } from '@/lib/podreview-auth';

const BLOB_BASE = 'https://q8ab6slzojco0myu.public.blob.vercel-storage.com/transcripts';
const BIOS_PATH = path.join(process.cwd(), 'data', 'guest-bios.json');
const META_PATH = path.join(process.cwd(), 'data', 'episode-metadata.json');

interface Dialogue { name: string; timestamp: string; text: string }
interface Transcript { episode_number: number; dialogues: Dialogue[] }
interface EpisodeMeta { pod: string; season: number; episode: number; film: string; guest: string | null; releaseDate: string }
interface GuestBio { bio: string; personality: string; topics: string[]; quotable: string }

async function fetchTranscript(epNum: number): Promise<Transcript | null> {
  try {
    const res = await fetch(`${BLOB_BASE}/episode_${epNum}.json`);
    if (!res.ok) return null;
    return await res.json();
  } catch { return null; }
}

export async function POST(request: NextRequest) {
  if (!checkAuth(request)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const { guestName } = await request.json() as { guestName?: string };
    if (!guestName) {
      return NextResponse.json({ error: 'guestName required' }, { status: 400 });
    }

    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) {
      return NextResponse.json({ error: 'ANTHROPIC_API_KEY not configured' }, { status: 500 });
    }

    const episodes: EpisodeMeta[] = JSON.parse(fs.readFileSync(META_PATH, 'utf-8'));
    const guestEps = episodes.filter((e) => {
      if (!e.guest || e.guest === 'None') return false;
      return e.guest === guestName
        || e.guest.split(/\s*\/\s*/).some((g) => g.trim() === guestName);
    });

    if (guestEps.length === 0) {
      return NextResponse.json({ error: `No episodes found for guest "${guestName}"` }, { status: 404 });
    }

    const transcriptTexts: string[] = [];
    for (const ep of guestEps) {
      const t = await fetchTranscript(ep.episode);
      if (!t?.dialogues) continue;
      const fullText = t.dialogues.map((d) => `${d.name}: ${d.text}`).join('\n');
      const trimmed = fullText.length > 8000
        ? fullText.substring(0, 8000) + '\n[...transcript continues...]'
        : fullText;
      transcriptTexts.push(`--- Episode: ${ep.film} (${ep.releaseDate}) ---\n${trimmed}`);
    }

    if (transcriptTexts.length === 0) {
      return NextResponse.json({ error: 'No transcripts available for this guest' }, { status: 404 });
    }

    const client = new Anthropic({ apiKey });
    const response = await client.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 200,
      messages: [{
        role: 'user',
        content: `You are reading transcripts from the Escape Hatch podcast (hosted by Haitch and Jason) where "${guestName}" appeared as a guest across ${guestEps.length} episode(s).

Pick ONE memorable, characteristic quote — something ${guestName} actually said, or something memorable said about them by a host. It should capture their personality, their running bit, or a standout reaction. Keep it under 15 words. Prefer wit, specificity, or a strong voice over generic statements.

Return ONLY a JSON object of the form {"quotable": "..."} — no other text, no markdown.

TRANSCRIPTS:
${transcriptTexts.join('\n\n')}`
      }],
    });

    const text = (response.content[0] as { text: string }).text.trim();
    const jsonStr = text.replace(/^```json?\s*/, '').replace(/\s*```$/, '');
    const parsed = JSON.parse(jsonStr) as { quotable: string };
    const newQuote = parsed.quotable?.trim();
    if (!newQuote) {
      return NextResponse.json({ error: 'Model returned empty quote' }, { status: 500 });
    }

    const bios: Record<string, GuestBio> = fs.existsSync(BIOS_PATH)
      ? JSON.parse(fs.readFileSync(BIOS_PATH, 'utf-8'))
      : {};
    const existing = bios[guestName];
    bios[guestName] = existing
      ? { ...existing, quotable: newQuote }
      : { bio: '', personality: '', topics: [], quotable: newQuote };
    fs.writeFileSync(BIOS_PATH, JSON.stringify(bios, null, 2));

    return NextResponse.json({ ok: true, guestName, quotable: newQuote });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
