'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';

interface CoverageEpisode {
  episode: number;
  film: string;
  season: number;
  releaseDate: string;
  reviewer: string;
  guest: string | null;
  hasTranscript: boolean;
  transcriptSource?: 'filesystem' | 'blob';
}

interface CoverageData {
  total: number;
  withTranscripts: number;
  withoutTranscripts: number;
  coveragePercent: number;
  episodes: CoverageEpisode[];
  bySeason: Record<number, { total: number; transcribed: number }>;
}

type FilterMode = 'all' | 'missing' | 'complete';

export default function CoveragePage() {
  const [data, setData] = useState<CoverageData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<FilterMode>('missing');
  const [selectedSeason, setSelectedSeason] = useState<number | 'all'>('all');

  useEffect(() => {
    async function fetchCoverage() {
      try {
        const response = await fetch('/api/coverage');
        if (!response.ok) throw new Error('Failed to fetch coverage data');
        const coverageData = await response.json();
        setData(coverageData);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Unknown error');
      } finally {
        setLoading(false);
      }
    }
    fetchCoverage();
  }, []);

  if (loading) {
    return (
      <main className="min-h-screen p-8 flex justify-center items-center">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-gray-900"></div>
      </main>
    );
  }

  if (error || !data) {
    return (
      <main className="min-h-screen p-8">
        <div className="max-w-6xl mx-auto">
          <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded">
            {error || 'Failed to load coverage data'}
          </div>
        </div>
      </main>
    );
  }

  // Filter episodes
  let filteredEpisodes = data.episodes;
  if (filter === 'missing') {
    filteredEpisodes = filteredEpisodes.filter(e => !e.hasTranscript);
  } else if (filter === 'complete') {
    filteredEpisodes = filteredEpisodes.filter(e => e.hasTranscript);
  }
  if (selectedSeason !== 'all') {
    filteredEpisodes = filteredEpisodes.filter(e => e.season === selectedSeason);
  }

  const seasons = Object.keys(data.bySeason)
    .map(Number)
    .sort((a, b) => a - b);

  return (
    <main className="min-h-screen p-8">
      <div className="max-w-6xl mx-auto">
        <div className="flex items-center justify-between mb-8">
          <div>
            <h1 className="text-3xl font-bold">Transcript Coverage</h1>
            <p className="text-gray-600 mt-1">
              Track which episodes have transcripts available
            </p>
          </div>
          <div className="flex items-center gap-4">
            <Link
              href="/review/new"
              className="px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 font-medium"
            >
              + Add Transcript
            </Link>
            <Link href="/" className="text-blue-600 hover:underline">
              Back to Search
            </Link>
          </div>
        </div>

        {/* Stats Cards */}
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-8">
          <div className="bg-white rounded-lg shadow p-6">
            <div className="text-3xl font-bold text-gray-900">{data.total}</div>
            <div className="text-sm text-gray-600">Total Episodes</div>
          </div>
          <div className="bg-white rounded-lg shadow p-6">
            <div className="text-3xl font-bold text-green-600">{data.withTranscripts}</div>
            <div className="text-sm text-gray-600">With Transcripts</div>
          </div>
          <div className="bg-white rounded-lg shadow p-6">
            <div className="text-3xl font-bold text-orange-600">{data.withoutTranscripts}</div>
            <div className="text-sm text-gray-600">Missing Transcripts</div>
          </div>
          <div className="bg-white rounded-lg shadow p-6">
            <div className="text-3xl font-bold text-blue-600">{data.coveragePercent}%</div>
            <div className="text-sm text-gray-600">Coverage</div>
          </div>
        </div>

        {/* Progress Bar */}
        <div className="bg-white rounded-lg shadow p-6 mb-8">
          <div className="flex justify-between text-sm mb-2">
            <span className="font-medium">Overall Progress</span>
            <span className="text-gray-600">
              {data.withTranscripts} / {data.total} episodes
            </span>
          </div>
          <div className="w-full bg-gray-200 rounded-full h-4">
            <div
              className="bg-green-500 h-4 rounded-full transition-all duration-500"
              style={{ width: `${data.coveragePercent}%` }}
            />
          </div>
        </div>

        {/* Season Breakdown */}
        <div className="bg-white rounded-lg shadow p-6 mb-8">
          <h2 className="text-lg font-semibold mb-4">Coverage by Season</h2>
          <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-3">
            {seasons.map(season => {
              const seasonData = data.bySeason[season];
              const percent = Math.round((seasonData.transcribed / seasonData.total) * 100);
              return (
                <button
                  key={season}
                  onClick={() => setSelectedSeason(selectedSeason === season ? 'all' : season)}
                  className={`p-3 rounded-lg border transition-colors ${
                    selectedSeason === season
                      ? 'border-blue-500 bg-blue-50'
                      : 'border-gray-200 hover:border-gray-300'
                  }`}
                >
                  <div className="text-sm font-medium">Season {season}</div>
                  <div className="text-xs text-gray-600">
                    {seasonData.transcribed}/{seasonData.total}
                  </div>
                  <div className="w-full bg-gray-200 rounded-full h-1.5 mt-2">
                    <div
                      className={`h-1.5 rounded-full ${
                        percent === 100 ? 'bg-green-500' : percent > 0 ? 'bg-yellow-500' : 'bg-gray-300'
                      }`}
                      style={{ width: `${percent}%` }}
                    />
                  </div>
                </button>
              );
            })}
          </div>
        </div>

        {/* Filters */}
        <div className="flex items-center gap-4 mb-4">
          <span className="text-sm font-medium text-gray-700">Show:</span>
          <div className="flex gap-2">
            {(['missing', 'complete', 'all'] as FilterMode[]).map(mode => (
              <button
                key={mode}
                onClick={() => setFilter(mode)}
                className={`px-3 py-1.5 text-sm rounded-md transition-colors ${
                  filter === mode
                    ? 'bg-gray-900 text-white'
                    : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                }`}
              >
                {mode === 'missing' ? 'Missing Only' : mode === 'complete' ? 'Complete Only' : 'All Episodes'}
              </button>
            ))}
          </div>
          {selectedSeason !== 'all' && (
            <button
              onClick={() => setSelectedSeason('all')}
              className="text-sm text-blue-600 hover:underline"
            >
              Clear season filter
            </button>
          )}
          <span className="ml-auto text-sm text-gray-600">
            Showing {filteredEpisodes.length} episode{filteredEpisodes.length !== 1 ? 's' : ''}
          </span>
        </div>

        {/* Episodes List */}
        <div className="bg-white rounded-lg shadow overflow-hidden">
          <table className="min-w-full divide-y divide-gray-200">
            <thead className="bg-gray-50">
              <tr>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Ep #
                </th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Film
                </th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Season
                </th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Reviewer
                </th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Guest
                </th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Status
                </th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Action
                </th>
              </tr>
            </thead>
            <tbody className="bg-white divide-y divide-gray-200">
              {filteredEpisodes.map(episode => (
                <tr key={episode.episode} className="hover:bg-gray-50">
                  <td className="px-4 py-3 text-sm font-medium text-gray-900">
                    {episode.episode}
                  </td>
                  <td className="px-4 py-3 text-sm text-gray-900">
                    {episode.film}
                  </td>
                  <td className="px-4 py-3 text-sm text-gray-600">
                    {episode.season}
                  </td>
                  <td className="px-4 py-3 text-sm text-gray-600">
                    {episode.reviewer}
                  </td>
                  <td className="px-4 py-3 text-sm text-gray-600">
                    {episode.guest || '-'}
                  </td>
                  <td className="px-4 py-3">
                    {episode.hasTranscript ? (
                      <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-green-100 text-green-800">
                        Complete
                        {episode.transcriptSource === 'blob' && (
                          <span className="ml-1 text-green-600">(new)</span>
                        )}
                      </span>
                    ) : (
                      <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-orange-100 text-orange-800">
                        Missing
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-sm">
                    {episode.hasTranscript ? (
                      <Link
                        href={`/review/episode_${episode.episode}`}
                        className="text-blue-600 hover:underline"
                      >
                        Review
                      </Link>
                    ) : (
                      <Link
                        href={`/review/new?episode=${episode.episode}&film=${encodeURIComponent(episode.film)}`}
                        className="text-blue-600 hover:underline"
                      >
                        Add
                      </Link>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>

          {filteredEpisodes.length === 0 && (
            <div className="p-8 text-center text-gray-500">
              {filter === 'missing'
                ? 'All episodes have transcripts!'
                : filter === 'complete'
                ? 'No transcripts found yet.'
                : 'No episodes found.'}
            </div>
          )}
        </div>
      </div>
    </main>
  );
}
