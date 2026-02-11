'use client';

import { useState } from 'react';
import { MarkdownContent } from './markdown-content';

export function DeepenShare({ query }: { query: string }) {
  const [deepening, setDeepening] = useState(false);
  const [deepAnswer, setDeepAnswer] = useState('');
  const [error, setError] = useState<string | null>(null);

  const handleDeepen = async () => {
    if (!query.trim() || deepening) return;

    setDeepening(true);
    setDeepAnswer('');
    setError(null);

    try {
      const response = await fetch('/api/search/stream', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query, depth: 'deep' }),
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || 'Deep analysis failed');
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
                setDeepAnswer((prev) => prev + data.text);
              } else if (eventType === 'complete') {
                setDeepAnswer(data.answer);
              } else if (eventType === 'error') {
                throw new Error(data.message);
              }
            } catch (parseErr) {
              if (parseErr instanceof Error && parseErr.message.startsWith('Deep analysis failed')) {
                throw parseErr;
              }
              console.error('Failed to parse SSE data:', line, parseErr);
            }
          }
        }
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Deep analysis failed');
    } finally {
      setDeepening(false);
    }
  };

  return (
    <div className="mt-4 pt-4 border-t border-gray-100">
      {deepAnswer ? (
        <div className="bg-brand-plum-lighter/40 border border-brand-plum/20 rounded-lg p-4">
          <p className="text-xs font-medium text-gray-500 mb-2">Deeper analysis (transcripts):</p>
          <MarkdownContent content={deepAnswer} />
          {deepening && (
            <span className="inline-block w-2 h-4 bg-brand-plum animate-pulse ml-1" />
          )}
        </div>
      ) : deepening ? (
        <span className="text-sm text-gray-500 flex items-center gap-2">
          <span className="inline-block w-3 h-3 border-2 border-brand-plum border-t-transparent rounded-full animate-spin" />
          Generating deeper analysis...
        </span>
      ) : (
        <button
          onClick={handleDeepen}
          className="text-sm text-brand-plum hover:text-brand-plum-light font-medium transition-colors"
        >
          Show deeper analysis
        </button>
      )}
      {error && (
        <p className="text-xs text-red-600 mt-2">{error}</p>
      )}
    </div>
  );
}
