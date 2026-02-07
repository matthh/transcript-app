'use client';

import { useState, useEffect } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

interface TranscriptSource {
  episodeTitle: string;
  episodeNumber?: number;
  speakers: string;
  startTimestamp: string;
  endTimestamp: string;
  text: string;
  score: number;
}

interface MetadataSource {
  film: string;
  season: number;
  episode: number;
  releaseDate: string;
  guest: string | null;
  reviewer: string;
  relevantFields: Record<string, string>;
}

type QueryType = 'factual' | 'interpretive' | 'hybrid';

interface SearchResponse {
  answer: string;
  queryType: QueryType;
  sources: {
    transcripts?: TranscriptSource[];
    metadata?: MetadataSource[];
  };
}

interface ProgressState {
  stage: string;
  message: string;
  queryType?: QueryType;
}

export default function Home() {
  const [query, setQuery] = useState('');
  const [searchedQuery, setSearchedQuery] = useState('');
  const [loading, setLoading] = useState(false);
  const [progress, setProgress] = useState<ProgressState | null>(null);
  const [streamingText, setStreamingText] = useState('');
  const [result, setResult] = useState<SearchResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  const handleSearch = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!query.trim()) return;

    setLoading(true);
    setError(null);
    setResult(null);
    setStreamingText('');
    setSearchedQuery(query);
    setProgress({ stage: 'starting', message: 'Starting search...' });

    try {
      const response = await fetch('/api/search/stream', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query }),
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

              if (eventType === 'progress') {
                setProgress(data);
              } else if (eventType === 'chunk') {
                setStreamingText((prev) => prev + data.text);
              } else if (eventType === 'complete') {
                setResult(data);
                setProgress(null);
                setStreamingText('');
              } else if (eventType === 'error') {
                throw new Error(data.message);
              }
            } catch (parseErr) {
              console.error('Failed to parse SSE data:', line, parseErr);
            }
          }
        }
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'An error occurred');
      setProgress(null);
    } finally {
      setLoading(false);
    }
  };

  return (
    <main className="min-h-screen bg-gray-50">
      <div className="max-w-4xl mx-auto px-4 py-12">
        <header className="text-center mb-12">
          <h1 className="text-4xl font-bold text-gray-900 mb-2">
            Escape Hatch Podcast Search
          </h1>
          <p className="text-gray-600">
            Ask questions about podcast episodes and get answers with quotes
          </p>
        </header>

        <form onSubmit={handleSearch} className="mb-8">
          <div className="flex gap-3">
            <input
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="What have you said about Steven Spielberg?"
              className="flex-1 px-4 py-3 rounded-lg border border-gray-300 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent text-gray-900 placeholder-gray-400"
              disabled={loading}
            />
            <button
              type="submit"
              disabled={loading || !query.trim()}
              className="px-6 py-3 bg-blue-600 text-white rounded-lg font-medium hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              {loading ? 'Searching...' : 'Search'}
            </button>
          </div>
        </form>

        {error && (
          <div className="bg-red-50 border border-red-200 rounded-lg p-4 mb-8">
            <p className="text-red-700">{error}</p>
          </div>
        )}

        {loading && progress && <SearchProgress progress={progress} streamingText={streamingText} />}

        {result && (
          <div className="space-y-8">
            <AnswerCard result={result} query={searchedQuery} />

            {result.sources.metadata && result.sources.metadata.length > 0 && (
              <div>
                <h2 className="text-lg font-semibold text-gray-900 mb-4">
                  Episode Data ({result.sources.metadata.length})
                </h2>
                <div className="grid gap-3 sm:grid-cols-2">
                  {result.sources.metadata.map((source, index) => (
                    <MetadataCard key={index} source={source} />
                  ))}
                </div>
              </div>
            )}

            {result.sources.transcripts && result.sources.transcripts.length > 0 && (
              <div>
                <h2 className="text-lg font-semibold text-gray-900 mb-4">
                  Transcript Sources ({result.sources.transcripts.length})
                </h2>
                <div className="space-y-4">
                  {result.sources.transcripts.map((source, index) => (
                    <TranscriptCard key={index} source={source} />
                  ))}
                </div>
              </div>
            )}

            <FeedbackForm query={searchedQuery} answer={result.answer} queryType={result.queryType} />
          </div>
        )}

        {!result && !loading && !error && (
          <div className="text-center text-gray-500 py-12">
            <p>Try asking questions like:</p>
            <ul className="mt-4 space-y-2 text-left max-w-md mx-auto">
              <li className="flex items-start gap-2">
                <span className="text-blue-500 text-xs font-medium bg-blue-50 px-1.5 py-0.5 rounded mt-0.5">factual</span>
                <span>&ldquo;How many episodes feature Proto as a guest?&rdquo;</span>
              </li>
              <li className="flex items-start gap-2">
                <span className="text-purple-500 text-xs font-medium bg-purple-50 px-1.5 py-0.5 rounded mt-0.5">interpretive</span>
                <span>&ldquo;What did Jason say about Denis Villeneuve?&rdquo;</span>
              </li>
              <li className="flex items-start gap-2">
                <span className="text-green-500 text-xs font-medium bg-green-50 px-1.5 py-0.5 rounded mt-0.5">hybrid</span>
                <span>&ldquo;Which 80s movies did they enjoy most?&rdquo;</span>
              </li>
            </ul>
          </div>
        )}
      </div>
    </main>
  );
}

function QueryTypeBadge({ type }: { type: QueryType }) {
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

function AnswerCard({ result, query }: { result: SearchResponse; query: string }) {
  const [showErrorModal, setShowErrorModal] = useState(false);
  const [selectedText, setSelectedText] = useState('');
  const [shareStatus, setShareStatus] = useState<'idle' | 'sharing' | 'copied' | 'error'>('idle');

  const handleShare = async () => {
    setShareStatus('sharing');
    try {
      const response = await fetch('/api/share', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query, result }),
      });

      if (!response.ok) {
        throw new Error('Failed to create share');
      }

      const { url } = await response.json();
      const fullUrl = `${window.location.origin}${url}`;
      await navigator.clipboard.writeText(fullUrl);
      setShareStatus('copied');

      // Reset after 3 seconds
      setTimeout(() => setShareStatus('idle'), 3000);
    } catch (err) {
      console.error('Share error:', err);
      setShareStatus('error');
      setTimeout(() => setShareStatus('idle'), 3000);
    }
  };

  const handleReportError = () => {
    const selection = window.getSelection();
    const selected = selection?.toString().trim() || '';
    setSelectedText(selected);
    setShowErrorModal(true);
  };

  // Build a combined source for the error modal from all transcript sources
  const combinedSource: TranscriptSource | null = result.sources.transcripts && result.sources.transcripts.length > 0
    ? {
        episodeTitle: result.sources.transcripts.map(t => t.episodeTitle).join(', '),
        speakers: [...new Set(result.sources.transcripts.flatMap(t => t.speakers.split(', ')))].join(', '),
        startTimestamp: result.sources.transcripts[0].startTimestamp,
        endTimestamp: result.sources.transcripts[result.sources.transcripts.length - 1].endTimestamp,
        text: result.answer,
        score: 1,
      }
    : null;

  return (
    <>
      <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-3">
            <h2 className="text-lg font-semibold text-gray-900">Answer</h2>
            <QueryTypeBadge type={result.queryType} />
          </div>
          <button
            onClick={handleShare}
            disabled={shareStatus === 'sharing'}
            className={`px-3 py-1.5 text-sm font-medium rounded-lg transition-colors ${
              shareStatus === 'copied'
                ? 'bg-green-100 text-green-700'
                : shareStatus === 'error'
                ? 'bg-red-100 text-red-700'
                : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
            }`}
          >
            {shareStatus === 'sharing' ? 'Sharing...' :
             shareStatus === 'copied' ? 'Copied!' :
             shareStatus === 'error' ? 'Error' :
             'Share'}
          </button>
        </div>
        <article className="prose prose-slate prose-headings:text-gray-900 max-w-none">
          <ReactMarkdown remarkPlugins={[remarkGfm]}>
            {result.answer}
          </ReactMarkdown>
        </article>
        {combinedSource && (
          <div className="mt-4 pt-4 border-t border-gray-100">
            <button
              onClick={handleReportError}
              className="text-xs text-gray-400 hover:text-red-500 transition-colors"
            >
              Bad transcription?
            </button>
          </div>
        )}
      </div>

      {showErrorModal && combinedSource && (
        <AnswerErrorModal
          result={result}
          initialSelectedText={selectedText}
          onClose={() => setShowErrorModal(false)}
        />
      )}
    </>
  );
}

function MetadataCard({ source }: { source: MetadataSource }) {
  return (
    <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-4">
      <div className="flex items-start justify-between mb-2">
        <div>
          <h3 className="font-medium text-gray-900">{source.film}</h3>
          <p className="text-sm text-gray-500">
            S{source.season}E{source.episode} &bull; {source.releaseDate}
          </p>
        </div>
      </div>
      <div className="text-sm text-gray-600 space-y-1">
        <p>
          <span className="text-gray-400">Reviewer:</span> {source.reviewer}
        </p>
        {source.guest && (
          <p>
            <span className="text-gray-400">Guest:</span> {source.guest}
          </p>
        )}
        {Object.entries(source.relevantFields).length > 0 && (
          <div className="mt-2 pt-2 border-t border-gray-100">
            {Object.entries(source.relevantFields)
              .slice(0, 2)
              .map(([key, value]) => (
                <p key={key} className="text-xs text-gray-500 truncate">
                  <span className="font-medium">{key}:</span> {value}
                </p>
              ))}
          </div>
        )}
      </div>
    </div>
  );
}

function TranscriptCard({ source }: { source: TranscriptSource }) {
  const [showErrorModal, setShowErrorModal] = useState(false);
  const [selectedText, setSelectedText] = useState('');

  const handleReportError = () => {
    // Get any text the user has selected
    const selection = window.getSelection();
    const selected = selection?.toString().trim() || '';
    setSelectedText(selected);
    setShowErrorModal(true);
  };

  return (
    <>
      <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-4">
        <div className="flex items-start justify-between mb-2">
          <div>
            <h3 className="font-medium text-gray-900">{source.episodeTitle}</h3>
            <p className="text-sm text-gray-500">
              {source.speakers} &bull; {source.startTimestamp} -{' '}
              {source.endTimestamp}
            </p>
          </div>
          <span className="text-xs text-gray-400">
            {(source.score * 100).toFixed(0)}% match
          </span>
        </div>
        <p className="text-gray-600 text-sm whitespace-pre-wrap select-text">
          {source.text.length > 500
            ? source.text.slice(0, 500) + '...'
            : source.text}
        </p>
        <div className="mt-2 pt-2 border-t border-gray-100">
          <button
            onClick={handleReportError}
            className="text-xs text-gray-400 hover:text-red-500 transition-colors"
          >
            Bad transcription?
          </button>
        </div>
      </div>

      {showErrorModal && (
        <TranscriptionErrorModal
          source={source}
          initialSelectedText={selectedText}
          onClose={() => setShowErrorModal(false)}
        />
      )}
    </>
  );
}

function TranscriptionErrorModal({
  source,
  initialSelectedText,
  onClose,
}: {
  source: TranscriptSource;
  initialSelectedText: string;
  onClose: () => void;
}) {
  const [selectedText, setSelectedText] = useState(initialSelectedText);
  const [correctedText, setCorrectedText] = useState(initialSelectedText);
  const [reporterName, setReporterName] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedText.trim() || !correctedText.trim()) return;

    setSubmitting(true);
    setError(null);

    try {
      const response = await fetch('/api/transcription-error', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          episodeTitle: source.episodeTitle,
          episodeNumber: source.episodeNumber,
          startTimestamp: source.startTimestamp,
          endTimestamp: source.endTimestamp,
          speakers: source.speakers,
          originalText: source.text,
          selectedText: selectedText.trim(),
          correctedText: correctedText.trim(),
          reporterName: reporterName.trim() || undefined,
        }),
      });

      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error || 'Failed to submit report');
      }

      setSubmitted(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to submit report');
    } finally {
      setSubmitting(false);
    }
  };

  // Close on escape key
  useEffect(() => {
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handleEscape);
    return () => window.removeEventListener('keydown', handleEscape);
  }, [onClose]);

  if (submitted) {
    return (
      <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4" onClick={onClose}>
        <div className="bg-white rounded-lg shadow-xl max-w-lg w-full p-6" onClick={(e) => e.stopPropagation()}>
          <div className="text-center">
            <div className="text-4xl mb-4">✅</div>
            <h3 className="text-lg font-semibold text-gray-900 mb-2">Thank you!</h3>
            <p className="text-gray-600 mb-4">
              Your transcription correction has been submitted and will be reviewed.
            </p>
            <button
              onClick={onClose}
              className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700"
            >
              Close
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4" onClick={onClose}>
      <div
        className="bg-white rounded-lg shadow-xl max-w-2xl w-full max-h-[90vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="p-6 border-b border-gray-200">
          <div className="flex items-start justify-between">
            <div>
              <h3 className="text-lg font-semibold text-gray-900">Report Transcription Error</h3>
              <p className="text-sm text-gray-500 mt-1">{source.episodeTitle}</p>
            </div>
            <button
              onClick={onClose}
              className="text-gray-400 hover:text-gray-600 text-xl leading-none"
            >
              ×
            </button>
          </div>
        </div>

        <form onSubmit={handleSubmit} className="p-6 space-y-4">
          <div className="bg-gray-50 rounded-lg p-3 text-sm text-gray-600">
            <p className="font-medium text-gray-700 mb-1">Tip:</p>
            <p>
              Before clicking &ldquo;Bad transcription?&rdquo;, highlight the incorrect text in the
              transcript to auto-fill the field below.
            </p>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Incorrect Text <span className="text-red-500">*</span>
            </label>
            <textarea
              value={selectedText}
              onChange={(e) => setSelectedText(e.target.value)}
              placeholder="Paste or type the incorrectly transcribed text here"
              rows={3}
              className="w-full px-3 py-2 rounded-lg border border-gray-300 focus:outline-none focus:ring-2 focus:ring-red-500 focus:border-transparent text-gray-900 resize-none"
              required
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Corrected Text <span className="text-red-500">*</span>
            </label>
            <textarea
              value={correctedText}
              onChange={(e) => setCorrectedText(e.target.value)}
              placeholder="Enter the correct transcription"
              rows={3}
              className="w-full px-3 py-2 rounded-lg border border-gray-300 focus:outline-none focus:ring-2 focus:ring-green-500 focus:border-transparent text-gray-900 resize-none"
              required
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Your Name (optional)
            </label>
            <input
              type="text"
              value={reporterName}
              onChange={(e) => setReporterName(e.target.value)}
              placeholder="Enter your name"
              className="w-full px-3 py-2 rounded-lg border border-gray-300 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent text-gray-900"
            />
          </div>

          <div className="bg-blue-50 rounded-lg p-3 text-sm">
            <p className="text-blue-800">
              <span className="font-medium">Context info that will be included:</span>
            </p>
            <ul className="mt-1 text-blue-700 text-xs space-y-0.5">
              <li>• Episode: {source.episodeTitle}</li>
              <li>• Timestamp: {source.startTimestamp} - {source.endTimestamp}</li>
              <li>• Speakers: {source.speakers}</li>
            </ul>
          </div>

          {error && (
            <div className="text-red-600 text-sm bg-red-50 p-3 rounded-lg">{error}</div>
          )}

          <div className="flex gap-3 pt-2">
            <button
              type="button"
              onClick={onClose}
              className="flex-1 py-2 px-4 border border-gray-300 text-gray-700 rounded-lg hover:bg-gray-50"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={!selectedText.trim() || !correctedText.trim() || submitting}
              className="flex-1 py-2 px-4 bg-red-600 text-white rounded-lg font-medium hover:bg-red-700 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {submitting ? 'Submitting...' : 'Submit Correction'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

function AnswerErrorModal({
  result,
  initialSelectedText,
  onClose,
}: {
  result: SearchResponse;
  initialSelectedText: string;
  onClose: () => void;
}) {
  const [selectedText, setSelectedText] = useState(initialSelectedText);
  const [correctedText, setCorrectedText] = useState(initialSelectedText);
  const [reporterName, setReporterName] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Get episode info from transcript sources
  const transcripts = result.sources.transcripts || [];
  const episodeTitle = transcripts.length > 0
    ? transcripts.map(t => t.episodeTitle).filter((v, i, a) => a.indexOf(v) === i).join(', ')
    : 'Multiple episodes';
  const episodeNumbers = transcripts
    .map(t => t.episodeNumber)
    .filter((n): n is number => n !== undefined);
  const episodeNumber = episodeNumbers.length > 0 ? episodeNumbers[0] : undefined;
  const speakers = transcripts.length > 0
    ? [...new Set(transcripts.flatMap(t => t.speakers.split(', ')))].join(', ')
    : 'Unknown';
  const startTimestamp = transcripts.length > 0 ? transcripts[0].startTimestamp : 'unknown';
  const endTimestamp = transcripts.length > 0 ? transcripts[transcripts.length - 1].endTimestamp : 'unknown';

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedText.trim() || !correctedText.trim()) return;

    setSubmitting(true);
    setError(null);

    try {
      const response = await fetch('/api/transcription-error', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          episodeTitle,
          episodeNumber,
          startTimestamp,
          endTimestamp,
          speakers,
          originalText: result.answer,
          selectedText: selectedText.trim(),
          correctedText: correctedText.trim(),
          reporterName: reporterName.trim() || undefined,
        }),
      });

      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error || 'Failed to submit report');
      }

      setSubmitted(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to submit report');
    } finally {
      setSubmitting(false);
    }
  };

  useEffect(() => {
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handleEscape);
    return () => window.removeEventListener('keydown', handleEscape);
  }, [onClose]);

  if (submitted) {
    return (
      <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4" onClick={onClose}>
        <div className="bg-white rounded-lg shadow-xl max-w-lg w-full p-6" onClick={(e) => e.stopPropagation()}>
          <div className="text-center">
            <div className="text-4xl mb-4">✅</div>
            <h3 className="text-lg font-semibold text-gray-900 mb-2">Thank you!</h3>
            <p className="text-gray-600 mb-4">
              Your transcription correction has been submitted and will be reviewed.
            </p>
            <button
              onClick={onClose}
              className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700"
            >
              Close
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4" onClick={onClose}>
      <div
        className="bg-white rounded-lg shadow-xl max-w-2xl w-full max-h-[90vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="p-6 border-b border-gray-200">
          <div className="flex items-start justify-between">
            <div>
              <h3 className="text-lg font-semibold text-gray-900">Report Transcription Error</h3>
              <p className="text-sm text-gray-500 mt-1">{episodeTitle}</p>
            </div>
            <button
              onClick={onClose}
              className="text-gray-400 hover:text-gray-600 text-xl leading-none"
            >
              ×
            </button>
          </div>
        </div>

        <form onSubmit={handleSubmit} className="p-6 space-y-4">
          <div className="bg-gray-50 rounded-lg p-3 text-sm text-gray-600">
            <p className="font-medium text-gray-700 mb-1">Tip:</p>
            <p>
              Before clicking &ldquo;Bad transcription?&rdquo;, highlight the incorrect text in the
              answer to auto-fill the field below.
            </p>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Incorrect Text <span className="text-red-500">*</span>
            </label>
            <textarea
              value={selectedText}
              onChange={(e) => setSelectedText(e.target.value)}
              placeholder="Paste or type the incorrectly transcribed text here"
              rows={3}
              className="w-full px-3 py-2 rounded-lg border border-gray-300 focus:outline-none focus:ring-2 focus:ring-red-500 focus:border-transparent text-gray-900 resize-none"
              required
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Corrected Text <span className="text-red-500">*</span>
            </label>
            <textarea
              value={correctedText}
              onChange={(e) => setCorrectedText(e.target.value)}
              placeholder="Enter the correct transcription"
              rows={3}
              className="w-full px-3 py-2 rounded-lg border border-gray-300 focus:outline-none focus:ring-2 focus:ring-green-500 focus:border-transparent text-gray-900 resize-none"
              required
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Your Name (optional)
            </label>
            <input
              type="text"
              value={reporterName}
              onChange={(e) => setReporterName(e.target.value)}
              placeholder="Enter your name"
              className="w-full px-3 py-2 rounded-lg border border-gray-300 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent text-gray-900"
            />
          </div>

          <div className="bg-blue-50 rounded-lg p-3 text-sm">
            <p className="text-blue-800">
              <span className="font-medium">Context info that will be included:</span>
            </p>
            <ul className="mt-1 text-blue-700 text-xs space-y-0.5">
              <li>• Episode(s): {episodeTitle}</li>
              <li>• Speakers: {speakers}</li>
            </ul>
          </div>

          {error && (
            <div className="text-red-600 text-sm bg-red-50 p-3 rounded-lg">{error}</div>
          )}

          <div className="flex gap-3 pt-2">
            <button
              type="button"
              onClick={onClose}
              className="flex-1 py-2 px-4 border border-gray-300 text-gray-700 rounded-lg hover:bg-gray-50"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={!selectedText.trim() || !correctedText.trim() || submitting}
              className="flex-1 py-2 px-4 bg-red-600 text-white rounded-lg font-medium hover:bg-red-700 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {submitting ? 'Submitting...' : 'Submit Correction'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

const STAGE_CONFIG: Record<string, { icon: string; step: number }> = {
  starting: { icon: '🚀', step: 0 },
  classifying: { icon: '🔍', step: 0 },
  classified: { icon: '🔍', step: 1 },
  metadata: { icon: '📊', step: 1 },
  metadata_done: { icon: '📊', step: 2 },
  transcripts: { icon: '📜', step: 1 },
  embedding: { icon: '🧮', step: 2 },
  searching: { icon: '🔎', step: 2 },
  transcripts_done: { icon: '📜', step: 3 },
  synthesizing: { icon: '✨', step: 3 },
  streaming: { icon: '✍️', step: 3 },
};

const PROGRESS_STEPS = [
  'Analyze',
  'Search',
  'Process',
  'Generate',
];

function SearchProgress({ progress, streamingText }: { progress: ProgressState; streamingText: string }) {
  const [dots, setDots] = useState('');

  useEffect(() => {
    const dotsInterval = setInterval(() => {
      setDots((prev) => (prev.length >= 3 ? '' : prev + '.'));
    }, 400);

    return () => clearInterval(dotsInterval);
  }, []);

  const config = STAGE_CONFIG[progress.stage] || { icon: '⏳', step: 0 };
  const currentStep = config.step;

  return (
    <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-8 mb-8">
      <div className="flex flex-col items-center">
        {/* Spinner */}
        <div className="relative mb-6">
          <div className="w-12 h-12 rounded-full border-4 border-gray-200"></div>
          <div className="absolute top-0 left-0 w-12 h-12 rounded-full border-4 border-blue-500 border-t-transparent animate-spin"></div>
        </div>

        {/* Current stage */}
        <div className="text-center mb-6">
          <span className="text-2xl mb-2 block">{config.icon}</span>
          <p className="text-gray-700 font-medium">
            {progress.message}
            <span className="inline-block w-6 text-left">{dots}</span>
          </p>
          {progress.queryType && (
            <span className="inline-block mt-2 text-xs text-gray-500">
              Query type: <span className="font-medium">{progress.queryType}</span>
            </span>
          )}
        </div>

        {/* Progress steps */}
        <div className="flex items-center gap-2">
          {PROGRESS_STEPS.map((step, index) => (
            <div
              key={step}
              className={`flex items-center ${index < PROGRESS_STEPS.length - 1 ? 'gap-2' : ''}`}
            >
              <div
                className={`w-2.5 h-2.5 rounded-full transition-all duration-300 ${
                  index <= currentStep
                    ? 'bg-blue-500 scale-110'
                    : 'bg-gray-200'
                }`}
              />
              {index < PROGRESS_STEPS.length - 1 && (
                <div
                  className={`w-8 h-0.5 transition-colors duration-300 ${
                    index < currentStep ? 'bg-blue-500' : 'bg-gray-200'
                  }`}
                />
              )}
            </div>
          ))}
        </div>

        {/* Stage labels */}
        <div className="flex gap-2 mt-2 text-xs text-gray-400">
          {PROGRESS_STEPS.map((step, index) => (
            <span
              key={step}
              className={`w-12 text-center ${
                index === currentStep ? 'text-blue-500 font-medium' : ''
              }`}
            >
              {step}
            </span>
          ))}
        </div>

        {/* Streaming text preview */}
        {streamingText && (
          <div className="mt-6 w-full border-t border-gray-200 pt-4">
            <article className="prose prose-sm prose-slate prose-headings:text-gray-900 max-w-none max-h-64 overflow-y-auto">
              <ReactMarkdown remarkPlugins={[remarkGfm]}>
                {streamingText}
              </ReactMarkdown>
              <span className="inline-block w-2 h-4 bg-blue-500 animate-pulse ml-1" />
            </article>
          </div>
        )}
      </div>
    </div>
  );
}

function FeedbackForm({ query, answer, queryType }: { query: string; answer: string; queryType: QueryType }) {
  const [name, setName] = useState('');
  const [rating, setRating] = useState<'good' | 'bad' | null>(null);
  const [comment, setComment] = useState('');
  const [submitted, setSubmitted] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim() || !rating) return;

    setSubmitting(true);
    setError(null);

    try {
      const response = await fetch('/api/feedback', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: name.trim(),
          query,
          answer,
          rating,
          comment: comment.trim() || undefined,
          queryType,
        }),
      });

      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error || 'Failed to submit feedback');
      }

      setSubmitted(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to submit feedback');
    } finally {
      setSubmitting(false);
    }
  };

  if (submitted) {
    return (
      <div className="bg-green-50 border border-green-200 rounded-lg p-6 text-center">
        <div className="text-2xl mb-2">Thank you!</div>
        <p className="text-green-700">Your feedback has been recorded.</p>
      </div>
    );
  }

  return (
    <div className="bg-blue-50 border border-blue-200 rounded-lg p-6">
      <h3 className="text-lg font-semibold text-gray-900 mb-4">Was this answer helpful?</h3>

      <form onSubmit={handleSubmit} className="space-y-4">
        <div className="flex gap-3">
          <button
            type="button"
            onClick={() => setRating('good')}
            className={`flex-1 py-3 px-4 rounded-lg border-2 font-medium transition-all ${
              rating === 'good'
                ? 'border-green-500 bg-green-100 text-green-700'
                : 'border-gray-200 bg-white text-gray-600 hover:border-green-300'
            }`}
          >
            <span className="text-xl mr-2">+</span> Good Answer
          </button>
          <button
            type="button"
            onClick={() => setRating('bad')}
            className={`flex-1 py-3 px-4 rounded-lg border-2 font-medium transition-all ${
              rating === 'bad'
                ? 'border-red-500 bg-red-100 text-red-700'
                : 'border-gray-200 bg-white text-gray-600 hover:border-red-300'
            }`}
          >
            <span className="text-xl mr-2">-</span> Needs Work
          </button>
        </div>

        <div>
          <label htmlFor="feedback-name" className="block text-sm font-medium text-gray-700 mb-1">
            Your Name <span className="text-red-500">*</span>
          </label>
          <input
            id="feedback-name"
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Enter your name"
            className="w-full px-3 py-2 rounded-lg border border-gray-300 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent text-gray-900"
            required
          />
        </div>

        <div>
          <label htmlFor="feedback-comment" className="block text-sm font-medium text-gray-700 mb-1">
            Comments (optional)
          </label>
          <textarea
            id="feedback-comment"
            value={comment}
            onChange={(e) => setComment(e.target.value)}
            placeholder="What could be improved? Was something missing or incorrect?"
            rows={3}
            className="w-full px-3 py-2 rounded-lg border border-gray-300 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent text-gray-900 resize-none"
          />
        </div>

        {error && (
          <div className="text-red-600 text-sm">{error}</div>
        )}

        <button
          type="submit"
          disabled={!name.trim() || !rating || submitting}
          className="w-full py-3 px-4 bg-blue-600 text-white rounded-lg font-medium hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
        >
          {submitting ? 'Submitting...' : 'Submit Feedback'}
        </button>
      </form>
    </div>
  );
}
