'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import TranscriptList from '@/components/TranscriptList';
import { TranscriptMetadata } from '@/types/transcript';

export default function ReviewPage() {
  const [transcripts, setTranscripts] = useState<TranscriptMetadata[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function fetchTranscripts() {
      try {
        const response = await fetch('/api/transcripts');
        if (!response.ok) throw new Error('Failed to fetch transcripts');
        const data = await response.json();
        setTranscripts(data);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Unknown error');
      } finally {
        setLoading(false);
      }
    }
    fetchTranscripts();
  }, []);

  return (
    <main className="min-h-screen p-8">
      <div className="max-w-6xl mx-auto">
        <div className="flex items-center justify-between mb-8">
          <h1 className="text-3xl font-bold">Transcript Review</h1>
          <div className="flex items-center gap-4">
            <Link
              href="/coverage"
              className="px-4 py-2 bg-gray-100 text-gray-700 rounded-md hover:bg-gray-200 font-medium"
            >
              Coverage
            </Link>
            <Link
              href="/review/new"
              className="px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 font-medium"
            >
              + Add New Episode
            </Link>
            <Link href="/" className="text-blue-600 hover:underline">
              Back to Search
            </Link>
          </div>
        </div>

        {loading && (
          <div className="flex justify-center py-12">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-gray-900"></div>
          </div>
        )}

        {error && (
          <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded">
            {error}
          </div>
        )}

        {!loading && !error && <TranscriptList transcripts={transcripts} />}
      </div>
    </main>
  );
}
