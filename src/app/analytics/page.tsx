'use client';

import { useEffect, useState, useCallback } from 'react';

// --- Types ---

interface UseCaseRow {
  code: string;
  label: string;
  count: number;
  percentage: number;
  rated: number;
  good: number;
  bad: number;
}

interface QueryRow {
  query: string;
  timestamp: string;
  rating?: 'good' | 'bad';
  routingPath?: string;
}

// --- Helpers ---

function getWeekStart(date: Date): string {
  const d = new Date(date);
  const day = d.getDay();
  const diff = d.getDate() - day + (day === 0 ? -6 : 1); // Monday
  d.setDate(diff);
  return d.toISOString().slice(0, 10);
}

function formatWeekLabel(weekStart: string): string {
  const start = new Date(weekStart + 'T00:00:00');
  const end = new Date(start);
  end.setDate(end.getDate() + 6);

  const opts: Intl.DateTimeFormatOptions = { month: 'short', day: 'numeric' };
  const startStr = start.toLocaleDateString('en-US', opts);
  const endStr = end.toLocaleDateString('en-US', {
    ...opts,
    year: 'numeric',
  });

  return `${startStr} \u2013 ${endStr}`;
}

function formatTimestamp(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

// --- Component ---

export default function AnalyticsPage() {
  const [weekStart, setWeekStart] = useState(() => getWeekStart(new Date()));
  const [allTime, setAllTime] = useState(false);
  const [distribution, setDistribution] = useState<UseCaseRow[] | null>(null);
  const [feedbackTotals, setFeedbackTotals] = useState<{ rated: number; good: number; bad: number }>({ rated: 0, good: 0, bad: 0 });
  const [drilldown, setDrilldown] = useState<{
    code: string;
    label: string;
    queries: QueryRow[];
  } | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const weekParam = allTime ? 'all' : weekStart;

  // Fetch distribution
  const fetchDistribution = useCallback(async () => {
    setLoading(true);
    setError(null);
    setDrilldown(null);
    try {
      const res = await fetch(
        `/api/analytics/use-cases?week=${weekParam}`
      );
      if (!res.ok) throw new Error('Failed to fetch analytics data');
      const data = await res.json();
      setDistribution(
        (data.distribution ?? []).map((d: { useCase: string; label: string; count: number; percent: number; rated: number; good: number; bad: number }) => ({
          code: d.useCase,
          label: d.label,
          count: d.count,
          percentage: d.percent,
          rated: d.rated ?? 0,
          good: d.good ?? 0,
          bad: d.bad ?? 0,
        }))
      );
      setFeedbackTotals({
        rated: data.totalRated ?? 0,
        good: data.totalGood ?? 0,
        bad: data.totalBad ?? 0,
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error');
    } finally {
      setLoading(false);
    }
  }, [weekParam]);

  useEffect(() => {
    fetchDistribution();
  }, [fetchDistribution]);

  // Fetch drilldown
  async function handleRowClick(row: UseCaseRow) {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(
        `/api/analytics/use-cases?week=${weekParam}&useCase=${encodeURIComponent(row.code)}`
      );
      if (!res.ok) throw new Error('Failed to fetch query details');
      const data = await res.json();
      setDrilldown({ code: row.code, label: row.label, queries: data.queries ?? [] });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error');
    } finally {
      setLoading(false);
    }
  }

  function shiftWeek(delta: number) {
    const d = new Date(weekStart + 'T00:00:00');
    d.setDate(d.getDate() + delta * 7);
    setWeekStart(getWeekStart(d));
    setAllTime(false);
  }

  function toggleAllTime() {
    setAllTime((prev) => !prev);
  }

  // --- Render ---

  return (
    <main className="min-h-screen bg-gray-50">
      {/* Header */}
      <div className="bg-gradient-to-br from-brand-dark to-brand-plum text-white py-8">
        <div className="max-w-4xl mx-auto px-4">
          <h1 className="text-2xl font-bold">Query Analytics</h1>
          <p className="text-brand-plum-lighter mt-1 text-sm">
            Use case distribution across search queries
          </p>
        </div>
      </div>

      <div className="max-w-4xl mx-auto px-4 py-6">
        {/* Week selector */}
        <div className="flex items-center gap-3 mb-6 flex-wrap">
          <button
            onClick={() => shiftWeek(-1)}
            disabled={allTime}
            className="px-3 py-1.5 bg-white border border-gray-300 rounded-lg text-sm hover:bg-gray-50 disabled:opacity-40"
            aria-label="Previous week"
          >
            &larr;
          </button>
          <span className="text-sm font-medium text-gray-700 min-w-[180px] text-center">
            {allTime ? 'All Time' : formatWeekLabel(weekStart)}
          </span>
          <button
            onClick={() => shiftWeek(1)}
            disabled={allTime}
            className="px-3 py-1.5 bg-white border border-gray-300 rounded-lg text-sm hover:bg-gray-50 disabled:opacity-40"
            aria-label="Next week"
          >
            &rarr;
          </button>
          <button
            onClick={toggleAllTime}
            className={`ml-2 px-3 py-1.5 rounded-lg text-sm border ${
              allTime
                ? 'bg-brand-plum text-white border-brand-plum'
                : 'bg-white text-gray-700 border-gray-300 hover:bg-gray-50'
            }`}
          >
            All Time
          </button>
        </div>

        {/* Loading */}
        {loading && (
          <div className="flex justify-center py-16">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-brand-plum"></div>
          </div>
        )}

        {/* Error */}
        {error && !loading && (
          <div className="bg-red-50 border border-red-200 rounded-lg p-4 text-red-700 text-sm">
            {error}
          </div>
        )}

        {/* Feedback summary */}
        {!loading && !error && !drilldown && feedbackTotals.rated > 0 && (
          <div className="flex items-center gap-4 mb-4 text-sm">
            <span className="text-gray-500">{feedbackTotals.rated} rated:</span>
            <span className="text-green-700 font-medium">{feedbackTotals.good} good</span>
            <span className="text-red-700 font-medium">{feedbackTotals.bad} bad</span>
            {feedbackTotals.rated > 0 && (
              <span className="text-gray-400">
                ({Math.round((feedbackTotals.good / feedbackTotals.rated) * 100)}% positive)
              </span>
            )}
          </div>
        )}

        {/* Distribution table */}
        {!loading && !error && !drilldown && distribution && (
          <>
            {distribution.length === 0 ? (
              <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-8 text-center text-gray-500">
                No query data for this period.
              </div>
            ) : (
              <div className="bg-white rounded-lg shadow-sm border border-gray-200 overflow-hidden">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-gray-200 bg-gray-50 text-left text-gray-600">
                      <th className="px-4 py-3 font-medium w-20">Code</th>
                      <th className="px-4 py-3 font-medium">Label</th>
                      <th className="px-4 py-3 font-medium w-16 text-right">Count</th>
                      <th className="px-4 py-3 font-medium w-16 text-right">%</th>
                      <th className="px-4 py-3 font-medium w-24 text-right">Feedback</th>
                      <th className="px-4 py-3 font-medium w-40">Distribution</th>
                    </tr>
                  </thead>
                  <tbody>
                    {distribution.map((row) => (
                      <tr
                        key={row.code}
                        onClick={() => handleRowClick(row)}
                        className="border-b border-gray-100 cursor-pointer hover:bg-brand-plum-lighter transition-colors"
                      >
                        <td className="px-4 py-3 font-mono text-xs text-brand-plum-muted">
                          {row.code}
                        </td>
                        <td className="px-4 py-3 text-gray-800">{row.label}</td>
                        <td className="px-4 py-3 text-right text-gray-700 font-medium">
                          {row.count}
                        </td>
                        <td className="px-4 py-3 text-right text-gray-500">
                          {row.percentage.toFixed(1)}%
                        </td>
                        <td className="px-4 py-3 text-right text-xs">
                          {row.rated > 0 ? (
                            <span className="text-gray-500">
                              <span className="text-green-600">{row.good}</span>
                              {' / '}
                              <span className="text-red-600">{row.bad}</span>
                            </span>
                          ) : (
                            <span className="text-gray-300">&mdash;</span>
                          )}
                        </td>
                        <td className="px-4 py-3">
                          <div className="w-full bg-gray-100 rounded-full h-2">
                            <div
                              className="bg-brand-plum rounded-full h-2"
                              style={{ width: `${Math.min(row.percentage, 100)}%` }}
                            />
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </>
        )}

        {/* Drilldown view */}
        {!loading && !error && drilldown && (
          <div>
            <button
              onClick={() => setDrilldown(null)}
              className="mb-4 text-sm text-brand-plum-muted hover:text-brand-plum flex items-center gap-1"
            >
              &larr; Back to distribution
            </button>
            <h2 className="text-lg font-semibold text-gray-800 mb-1">
              {drilldown.code}: {drilldown.label}
            </h2>
            <p className="text-sm text-gray-500 mb-4">
              {drilldown.queries.length} {drilldown.queries.length === 1 ? 'query' : 'queries'}
            </p>

            {drilldown.queries.length === 0 ? (
              <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-8 text-center text-gray-500">
                No queries found for this use case.
              </div>
            ) : (
              <div className="space-y-2">
                {drilldown.queries.map((q, i) => (
                  <div
                    key={i}
                    className="bg-white rounded-lg shadow-sm border border-gray-200 px-4 py-3"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <p className="text-sm text-gray-800 flex-1 break-words">
                        {q.query.length > 200
                          ? q.query.slice(0, 200) + '...'
                          : q.query}
                      </p>
                      <div className="flex items-center gap-2 shrink-0">
                        {q.rating && (
                          <span
                            className={`text-xs px-2 py-0.5 rounded-full font-medium ${
                              q.rating === 'good'
                                ? 'bg-green-100 text-green-700'
                                : 'bg-red-100 text-red-700'
                            }`}
                          >
                            {q.rating}
                          </span>
                        )}
                        {q.routingPath && (
                          <span className="text-xs px-2 py-0.5 rounded-full bg-gray-100 text-gray-600">
                            {q.routingPath}
                          </span>
                        )}
                      </div>
                    </div>
                    <p className="text-xs text-gray-400 mt-1">
                      {formatTimestamp(q.timestamp)}
                    </p>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </main>
  );
}
