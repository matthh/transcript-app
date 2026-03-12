'use client';

import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { CitableMarkdown } from '@/components/CitableMarkdown';

interface TranscriptSource {
  episodeTitle: string;
  episodeNumber?: number;
  speakers: string;
  startTimestamp: string;
  endTimestamp: string;
  text: string;
  score: number;
}

export function MarkdownContent({ content, sources }: { content: string; sources?: TranscriptSource[] }) {
  return (
    <article className="prose prose-slate prose-headings:text-gray-900 max-w-none">
      {sources && sources.length > 0 ? (
        <CitableMarkdown content={content} sources={sources} />
      ) : (
        <ReactMarkdown remarkPlugins={[remarkGfm]}>{content}</ReactMarkdown>
      )}
    </article>
  );
}
