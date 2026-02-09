import { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { loadShare, ShareableResult } from '@/lib/share-storage';
import { formatEpisodeLabel } from '@/lib/episode-format';
import Link from 'next/link';
import { MarkdownContent } from './markdown-content';

interface PageProps {
  params: Promise<{ id: string }>;
}

const DESCRIPTION_MAX_CHARS = 500;

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

function formatEpisodeLine(share: ShareableResult): string | null {
  const metadata = share.sources.metadata?.[0];
  if (metadata) {
    return `${formatEpisodeLabel(metadata.season, metadata.episode)} - ${metadata.film}`;
  }

  if (share.primaryEpisode) {
    const { film, season, episode } = share.primaryEpisode;
    if (season && episode) {
      return `${formatEpisodeLabel(season, episode)} - ${film}`;
    }
    if (episode) {
      return `Episode ${episode} - ${film}`;
    }
    return film;
  }

  return null;
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { id } = await params;
  const share = await loadShare(id);

  if (!share) {
    return {
      title: 'Share Not Found',
    };
  }

  const baseUrl = process.env.NEXT_PUBLIC_BASE_URL
    || (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : 'http://localhost:3000');
  const episodeLine = formatEpisodeLine(share);
  const description = truncateText(
    share.summary || (episodeLine ? `Source: ${episodeLine}.` : 'Escape Hatch Podcast Search.'),
    DESCRIPTION_MAX_CHARS
  );

  const ogImageUrl = new URL(`/api/og/${id}`, baseUrl).toString();
  const shareUrl = new URL(`/share/${id}`, baseUrl).toString();

  return {
    title: `"${share.query}" - Escape Hatch Podcast Search`,
    description,
    metadataBase: new URL(baseUrl),
    openGraph: {
      title: share.query,
      description,
      type: 'article',
      url: shareUrl,
      images: [
        {
          url: ogImageUrl,
          width: 1200,
          height: 630,
          alt: `Answer to: ${share.query}`,
        },
      ],
    },
    twitter: {
      card: 'summary_large_image',
      title: share.query,
      description,
      images: [ogImageUrl],
    },
  };
}

function QueryTypeBadge({ type }: { type: ShareableResult['queryType'] }) {
  const styles = {
    factual: 'bg-blue-50 text-blue-600 border-blue-200',
    interpretive: 'bg-purple-50 text-purple-600 border-purple-200',
    hybrid: 'bg-green-50 text-green-600 border-green-200',
  };

  const labels = {
    factual: 'Factual Query',
    interpretive: 'Interpretive Query',
    hybrid: 'Hybrid Query',
  };

  return (
    <span
      className={`text-xs font-medium px-2 py-1 rounded-full border ${styles[type]}`}
    >
      {labels[type]}
    </span>
  );
}

export default async function SharePage({ params }: PageProps) {
  const { id } = await params;
  const share = await loadShare(id);

  if (!share) {
    notFound();
  }

  return (
    <main className="min-h-screen bg-gray-50">
      <div className="max-w-4xl mx-auto px-4 py-12">
        <header className="text-center mb-8">
          <Link href="/" className="text-blue-600 hover:text-blue-700 text-sm">
            Escape Hatch Podcast Search
          </Link>
        </header>

        <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6 mb-8">
          <div className="flex items-center gap-3 mb-4">
            <QueryTypeBadge type={share.queryType} />
            <span className="text-sm text-gray-400">
              {new Date(share.createdAt).toLocaleDateString()}
            </span>
          </div>

          <h1 className="text-2xl font-bold text-gray-900 mb-6">
            "{share.query}"
          </h1>

          <MarkdownContent content={share.answer} />
        </div>

        <div className="text-center">
          <Link
            href="/"
            className="inline-flex items-center gap-2 px-6 py-3 bg-blue-600 text-white rounded-lg font-medium hover:bg-blue-700 transition-colors"
          >
            Try Your Own Search
          </Link>
        </div>
      </div>
    </main>
  );
}
