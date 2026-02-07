import { ImageResponse } from 'next/og';
import { loadShare } from '@/lib/share-storage';

export const runtime = 'edge';

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const share = await loadShare(id);

  if (!share) {
    return new Response('Share not found', { status: 404 });
  }

  // Truncate answer for display (roughly 200 chars)
  const answerExcerpt =
    share.answer.length > 200
      ? share.answer.slice(0, 200).trim() + '...'
      : share.answer;

  // Clean markdown from answer for OG image
  const cleanAnswer = answerExcerpt
    .replace(/\*\*/g, '')
    .replace(/\*/g, '')
    .replace(/`/g, '')
    .replace(/#+\s/g, '')
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1');

  // Format episode info
  let episodeInfo = '';
  if (share.primaryEpisode) {
    const { film, season, episode } = share.primaryEpisode;
    if (season && episode) {
      episodeInfo = `S${season}E${episode} - ${film}`;
    } else if (episode) {
      episodeInfo = `Episode ${episode} - ${film}`;
    } else {
      episodeInfo = film;
    }
  }

  // Query type badge colors
  const badgeColors = {
    factual: { bg: '#dbeafe', text: '#2563eb', border: '#bfdbfe' },
    interpretive: { bg: '#f3e8ff', text: '#9333ea', border: '#e9d5ff' },
    hybrid: { bg: '#dcfce7', text: '#16a34a', border: '#bbf7d0' },
  };

  const badge = badgeColors[share.queryType];

  return new ImageResponse(
    (
      <div
        style={{
          width: '100%',
          height: '100%',
          display: 'flex',
          flexDirection: 'column',
          backgroundColor: '#ffffff',
          fontFamily: 'system-ui, sans-serif',
        }}
      >
        {/* Header */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            padding: '24px 40px',
            backgroundColor: '#1e40af',
            color: '#ffffff',
          }}
        >
          <div
            style={{
              fontSize: 24,
              fontWeight: 700,
              letterSpacing: '-0.02em',
            }}
          >
            ESCAPE HATCH PODCAST SEARCH
          </div>
          <div
            style={{
              display: 'flex',
              backgroundColor: badge.bg,
              color: badge.text,
              border: `2px solid ${badge.border}`,
              padding: '6px 16px',
              borderRadius: 20,
              fontSize: 16,
              fontWeight: 600,
              textTransform: 'uppercase',
            }}
          >
            {share.queryType}
          </div>
        </div>

        {/* Content */}
        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            flex: 1,
            padding: '40px',
            gap: 24,
          }}
        >
          {/* Question */}
          <div
            style={{
              fontSize: 36,
              fontWeight: 600,
              color: '#1f2937',
              lineHeight: 1.3,
            }}
          >
            "{share.query}"
          </div>

          {/* Answer excerpt */}
          <div
            style={{
              fontSize: 24,
              color: '#4b5563',
              lineHeight: 1.5,
              flex: 1,
            }}
          >
            {cleanAnswer}
          </div>

          {/* Footer with episode info */}
          {episodeInfo && (
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 8,
                fontSize: 20,
                color: '#6b7280',
                borderTop: '1px solid #e5e7eb',
                paddingTop: 20,
              }}
            >
              <span style={{ fontWeight: 500 }}>Source:</span>
              <span>{episodeInfo}</span>
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
}
