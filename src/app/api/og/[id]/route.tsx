import { ImageResponse } from 'next/og';
import { loadShare } from '@/lib/share-storage';

export const runtime = 'nodejs';

const MAX_ANSWER_CHARS = 520;
const MAX_CLIP_CHARS = 160;
const FALLBACK_PNG_BASE64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR4nGNgYAAAAAMAASsJTYQAAAAASUVORK5CYII=';
const FALLBACK_PNG_BYTES = (() => {
  if (typeof Buffer !== 'undefined') {
    return Buffer.from(FALLBACK_PNG_BASE64, 'base64');
  }
  if (typeof atob !== 'undefined') {
    return Uint8Array.from(atob(FALLBACK_PNG_BASE64), (c) => c.charCodeAt(0));
  }
  return new Uint8Array();
})();

function truncateText(text: string, maxChars: number): string {
  if (text.length <= maxChars) {
    return text;
  }
  return `${text.slice(0, maxChars).trim()}...`;
}

function stripMarkdown(text: string): string {
  return text
    .replace(/\*\*/g, '')
    .replace(/\*/g, '')
    .replace(/`/g, '')
    .replace(/#+\s/g, '')
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    .replace(/^>\s?/gm, '')
    .replace(/\n+/g, ' ')
    .trim();
}

function formatEpisodeLine(share: Awaited<ReturnType<typeof loadShare>>): string | null {
  if (!share) {
    return null;
  }

  const metadata = share.sources.metadata?.[0];
  if (metadata) {
    return `S${metadata.season}E${metadata.episode} - ${metadata.film}`;
  }

  if (share.primaryEpisode) {
    const { film, season, episode } = share.primaryEpisode;
    if (season && episode) {
      return `S${season}E${episode} - ${film}`;
    }
    if (episode) {
      return `Episode ${episode} - ${film}`;
    }
    return film;
  }

  return null;
}

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const share = await loadShare(id);

  if (!share) {
    return new Response('Share not found', { status: 404 });
  }

  const url = new URL(request.url);
  const debugParam = url.searchParams.get('debug');
  const debugJson = debugParam === '1' || request.url.includes('debug=1');
  const debugRender = debugParam === 'render' || request.url.includes('debug=render');

  if (debugJson) {
    return Response.json({
      id: share.id,
      query: share.query,
      queryType: share.queryType,
      primaryEpisode: share.primaryEpisode ?? null,
      transcriptCount: share.sources.transcripts?.length ?? 0,
      metadataCount: share.sources.metadata?.length ?? 0,
    });
  }

  const answerExcerpt = truncateText(stripMarkdown(share.answer), MAX_ANSWER_CHARS);
  const episodeLine = formatEpisodeLine(share);
  const metadata = share.sources.metadata?.[0];
  const transcript = share.sources.transcripts?.[0];
  const clipExcerpt = transcript?.text
    ? truncateText(stripMarkdown(transcript.text), MAX_CLIP_CHARS)
    : null;
  const timestampRange = transcript?.startTimestamp && transcript?.endTimestamp
    ? `${transcript.startTimestamp} - ${transcript.endTimestamp}`
    : null;
  const speakers = transcript?.speakers ?? null;
  const clipCount = share.sources.transcripts?.length ?? 0;

  try {
    const imageResponse = new ImageResponse(
      (
        <div
          style={{
            width: '100%',
            height: '100%',
            display: 'flex',
            flexDirection: 'column',
            backgroundColor: '#0b1020',
            color: '#f8fafc',
            fontFamily: 'Arial, sans-serif',
            padding: 56,
          }}
        >
          <div style={{ fontSize: 20, fontWeight: 700, letterSpacing: 1, marginBottom: 24 }}>
            ESCAPE HATCH PODCAST SEARCH
          </div>

          <div
            style={{
              display: 'flex',
              flexDirection: 'column',
              backgroundColor: '#f8fafc',
              color: '#0f172a',
              borderRadius: 18,
              padding: '28px 32px',
              gap: 18,
              flex: 1,
            }}
          >
            <div style={{ fontSize: 28, fontWeight: 600, lineHeight: 1.35, color: '#0f172a' }}>
              Answer
            </div>
            <div style={{ fontSize: 26, lineHeight: 1.5, color: '#1f2937' }}>
              {answerExcerpt}
            </div>
            {episodeLine && (
              <div style={{ fontSize: 18, fontWeight: 600, color: '#475569' }}>
                {`Source: ${episodeLine}`}
              </div>
            )}
          </div>
        </div>
      ),
      {
        width: 1200,
        height: 630,
      }
    );
    const imageBuffer = await imageResponse.arrayBuffer();
    if (debugRender) {
      return new Response('OK', {
        status: 200,
        headers: { 'content-type': 'text/plain; charset=utf-8' },
      });
    }
    return new Response(imageBuffer, {
      status: 200,
      headers: {
        'content-type': 'image/png',
        'cache-control': 'public, max-age=0, must-revalidate',
      },
    });
  } catch (error) {
    console.error('OG image render failed:', error);
    if (debugRender) {
      return new Response(`OG render error: ${String(error)}`, {
        status: 500,
        headers: { 'content-type': 'text/plain; charset=utf-8' },
      });
    }
    return new Response(FALLBACK_PNG_BYTES, {
      status: 200,
      headers: {
        'content-type': 'image/png',
        'cache-control': 'public, max-age=0, must-revalidate',
        'x-og-fallback': '1',
      },
    });
  }
}
