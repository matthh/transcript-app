import { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { loadShare, ShareableResult } from '@/lib/share-storage';
import Link from 'next/link';
import { MarkdownContent } from './markdown-content';

interface PageProps {
  params: Promise<{ id: string }>;
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { id } = await params;
  const share = await loadShare(id);

  if (!share) {
    return {
      title: 'Share Not Found',
    };
  }

  // Truncate answer for description
  const description =
    share.answer.length > 200
      ? share.answer.slice(0, 200).trim() + '...'
      : share.answer;

  const ogImageUrl = `/api/og/${id}`;

  return {
    title: `"${share.query}" - Escape Hatch Podcast Search`,
    description,
    openGraph: {
      title: share.query,
      description,
      type: 'article',
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
