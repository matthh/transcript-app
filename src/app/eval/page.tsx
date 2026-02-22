'use client';

import { useState, useCallback } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

interface TranscriptSource {
  episodeTitle: string;
  speakers: string;
  startTimestamp: string;
  endTimestamp: string;
  text: string;
  score: number;
}

interface SearchResult {
  answer: string;
  queryType: string;
  sources: {
    transcripts?: TranscriptSource[];
  };
}

interface GeneratedQuestion {
  question: string;
  type: string;
  seedEpisode: string;
}

type EvalPhase = 'idle' | 'generating' | 'ready' | 'searching' | 'reviewing' | 'submitted';

export default function EvalPage() {
  const [phase, setPhase] = useState<EvalPhase>('idle');
  const [question, setQuestion] = useState<GeneratedQuestion | null>(null);
  const [result, setResult] = useState<SearchResult | null>(null);
  const [streamingText, setStreamingText] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [rating, setRating] = useState<'good' | 'bad' | null>(null);
  const [comment, setComment] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [searchLatency, setSearchLatency] = useState(0);
  const [evalCount, setEvalCount] = useState(0);

  const generateQuestion = useCallback(async () => {
    setPhase('generating');
    setError(null);
    setResult(null);
    setStreamingText('');
    setRating(null);
    setComment('');

    try {
      const response = await fetch('/api/eval/generate', { method: 'POST' });
      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error || 'Failed to generate question');
      }
      const data = await response.json();
      setQuestion(data);
      setPhase('ready');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to generate question');
      setPhase('idle');
    }
  }, []);

  const runSearch = useCallback(async () => {
    if (!question) return;

    setPhase('searching');
    setError(null);
    setResult(null);
    setStreamingText('');
    const startTime = Date.now();

    try {
      const response = await fetch('/api/search/stream', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query: question.question, depth: 'quick' }),
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || 'Search failed');
      }

      const reader = response.body?.getReader();
      if (!reader) throw new Error('No response body');

      const decoder = new TextDecoder();
      let buffer = '';
      let eventType = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          if (line.startsWith('event: ')) {
            eventType = line.slice(7).trim();
          } else if (line.startsWith('data: ')) {
            try {
              const data = JSON.parse(line.slice(6));
              if (eventType === 'chunk') {
                setStreamingText((prev) => prev + data.text);
              } else if (eventType === 'complete') {
                setResult(data);
                setStreamingText('');
                setSearchLatency(Date.now() - startTime);
                setPhase('reviewing');
              } else if (eventType === 'error') {
                throw new Error(data.message);
              }
            } catch (parseErr) {
              if (parseErr instanceof Error && parseErr.message !== 'Search failed') {
                console.error('Failed to parse SSE data:', line, parseErr);
              } else {
                throw parseErr;
              }
            }
          }
        }
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Search failed');
      setPhase('ready');
    }
  }, [question]);

  const submitFeedback = useCallback(async () => {
    if (!question || !result || !rating) return;

    setSubmitting(true);
    setError(null);

    const transcriptEpisodes = [
      ...new Set(
        (result.sources.transcripts || []).map((t) => t.episodeTitle)
      ),
    ];

    try {
      const response = await fetch('/api/eval/feedback', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          question: question.question,
          questionType: question.type,
          seedEpisode: question.seedEpisode,
          answer: result.answer,
          sourceCount: (result.sources.transcripts || []).length,
          transcriptEpisodes,
          rating,
          comment: comment.trim() || null,
          latencyMs: searchLatency,
        }),
      });

      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error || 'Failed to submit feedback');
      }

      setPhase('submitted');
      setEvalCount((c) => c + 1);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to submit feedback');
    } finally {
      setSubmitting(false);
    }
  }, [question, result, rating, comment, searchLatency]);

  return (
    <main className="min-h-screen bg-gray-50">
      <div className="bg-gradient-to-br from-brand-dark to-brand-plum">
        <div className="max-w-3xl mx-auto px-4 pt-8 pb-6">
          <header className="text-center">
            <h1 className="text-3xl font-bold text-white mb-2">Search Eval</h1>
            <p className="text-gray-300 text-sm">
              Rate AI-generated search questions to help improve results.
              {evalCount > 0 && (
                <span className="ml-2 text-brand-plum-light">
                  {evalCount} rated this session
                </span>
              )}
            </p>
          </header>
        </div>
      </div>

      <div className="max-w-3xl mx-auto px-4 py-8 space-y-6">
        {error && (
          <div className="bg-red-50 border border-red-200 rounded-lg p-4">
            <p className="text-red-700 text-sm">{error}</p>
          </div>
        )}

        {/* Idle state — start button */}
        {phase === 'idle' && (
          <div className="text-center py-12">
            <p className="text-gray-500 mb-6">
              Generate a random search question, review the answer, and rate the quality.
            </p>
            <button
              onClick={generateQuestion}
              className="px-6 py-3 bg-brand-plum text-white rounded-lg font-medium hover:bg-brand-plum-light transition-colors"
            >
              Generate Question
            </button>
          </div>
        )}

        {/* Generating spinner */}
        {phase === 'generating' && (
          <div className="text-center py-12">
            <div className="inline-block w-8 h-8 border-4 border-gray-200 border-t-brand-plum rounded-full animate-spin mb-4" />
            <p className="text-gray-500">Generating question...</p>
          </div>
        )}

        {/* Question ready — show question + search button */}
        {phase === 'ready' && question && (
          <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6">
            <div className="flex items-start justify-between gap-4 mb-4">
              <div>
                <span className="text-xs font-medium text-gray-400 uppercase tracking-wide">
                  {question.type}
                </span>
                <p className="text-xs text-gray-400 mt-0.5">
                  Seed: {question.seedEpisode}
                </p>
              </div>
            </div>
            <p className="text-lg text-gray-900 font-medium mb-6">
              {question.question}
            </p>
            <div className="flex gap-3">
              <button
                onClick={runSearch}
                className="px-5 py-2.5 bg-brand-plum text-white rounded-lg font-medium hover:bg-brand-plum-light transition-colors"
              >
                Search
              </button>
              <button
                onClick={generateQuestion}
                className="px-5 py-2.5 border border-gray-300 text-gray-600 rounded-lg font-medium hover:bg-gray-50 transition-colors"
              >
                Skip
              </button>
            </div>
          </div>
        )}

        {/* Searching — streaming preview */}
        {phase === 'searching' && (
          <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6">
            <div className="mb-4">
              <span className="text-xs font-medium text-gray-400 uppercase tracking-wide">
                {question?.type}
              </span>
              <p className="text-lg text-gray-900 font-medium mt-1">
                {question?.question}
              </p>
            </div>
            <div className="border-t border-gray-200 pt-4">
              <div className="flex items-center gap-2 mb-3">
                <div className="w-4 h-4 border-2 border-brand-plum border-t-transparent rounded-full animate-spin" />
                <span className="text-sm text-gray-500">Searching...</span>
              </div>
              {streamingText && (
                <article className="prose prose-sm prose-slate max-w-none max-h-64 overflow-y-auto">
                  <ReactMarkdown remarkPlugins={[remarkGfm]}>
                    {streamingText}
                  </ReactMarkdown>
                  <span className="inline-block w-2 h-4 bg-brand-plum animate-pulse ml-1" />
                </article>
              )}
            </div>
          </div>
        )}

        {/* Reviewing — show result + feedback */}
        {phase === 'reviewing' && result && question && (
          <div className="space-y-6">
            {/* Question + Answer */}
            <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6">
              <div className="mb-4">
                <span className="text-xs font-medium text-gray-400 uppercase tracking-wide">
                  {question.type}
                </span>
                <p className="text-lg text-gray-900 font-medium mt-1">
                  {question.question}
                </p>
              </div>
              <div className="border-t border-gray-200 pt-4">
                <article className="prose prose-sm prose-slate prose-headings:text-gray-900 max-w-none">
                  <ReactMarkdown remarkPlugins={[remarkGfm]}>
                    {result.answer}
                  </ReactMarkdown>
                </article>
                <div className="mt-4 flex items-center gap-4 text-xs text-gray-400">
                  <span>
                    {(result.sources.transcripts || []).length} sources
                  </span>
                  <span>
                    {[
                      ...new Set(
                        (result.sources.transcripts || []).map(
                          (t) => t.episodeTitle
                        )
                      ),
                    ].length}{' '}
                    episodes
                  </span>
                  <span>{(searchLatency / 1000).toFixed(1)}s</span>
                </div>
              </div>
            </div>

            {/* Feedback */}
            <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6">
              <h3 className="text-sm font-semibold text-gray-900 mb-3">
                Rate this answer
              </h3>
              <div className="flex gap-3 mb-4">
                <button
                  onClick={() => setRating('good')}
                  className={`flex-1 py-3 px-4 rounded-lg border-2 font-medium transition-all ${
                    rating === 'good'
                      ? 'border-green-500 bg-green-50 text-green-700'
                      : 'border-gray-200 bg-white text-gray-600 hover:border-green-300'
                  }`}
                >
                  + Good
                </button>
                <button
                  onClick={() => setRating('bad')}
                  className={`flex-1 py-3 px-4 rounded-lg border-2 font-medium transition-all ${
                    rating === 'bad'
                      ? 'border-red-500 bg-red-50 text-red-700'
                      : 'border-gray-200 bg-white text-gray-600 hover:border-red-300'
                  }`}
                >
                  - Bad
                </button>
              </div>
              <textarea
                value={comment}
                onChange={(e) => setComment(e.target.value)}
                placeholder="Optional: what was wrong or could be better?"
                rows={2}
                className="w-full px-3 py-2 rounded-lg border border-gray-300 focus:outline-none focus:ring-2 focus:ring-brand-plum focus:border-transparent text-gray-900 resize-none text-sm mb-4"
              />
              <button
                onClick={submitFeedback}
                disabled={!rating || submitting}
                className="w-full py-2.5 px-4 bg-brand-plum text-white rounded-lg font-medium hover:bg-brand-plum-light disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
              >
                {submitting ? 'Submitting...' : 'Submit Rating'}
              </button>
            </div>
          </div>
        )}

        {/* Submitted — confirmation + next */}
        {phase === 'submitted' && (
          <div className="bg-green-50 border border-green-200 rounded-lg p-6 text-center">
            <p className="text-green-700 font-medium mb-4">
              Feedback recorded. Thank you!
            </p>
            <button
              onClick={generateQuestion}
              className="px-6 py-3 bg-brand-plum text-white rounded-lg font-medium hover:bg-brand-plum-light transition-colors"
            >
              Next Question
            </button>
          </div>
        )}
      </div>
    </main>
  );
}
