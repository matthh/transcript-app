import { promises as fs } from 'fs';
import path from 'path';
import Link from 'next/link';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

export const dynamic = 'force-static';

async function loadDoc(): Promise<string> {
  const filePath = path.join(process.cwd(), 'docs', 'query-failure-modes.md');
  return fs.readFile(filePath, 'utf8');
}

export default async function QueryFailureModesPage() {
  const content = await loadDoc();

  return (
    <main className="min-h-screen bg-white">
      <div className="max-w-4xl mx-auto px-6 py-10">
        <div className="flex items-center justify-between gap-4">
          <Link href="/" className="text-sm text-blue-600 hover:underline">
            Back to search
          </Link>
          <div className="flex items-center gap-4 text-sm">
            <Link href="/docs/query-journey" className="text-blue-600 hover:underline">
              Query Journey
            </Link>
            <span className="text-xs text-gray-400">Docs</span>
          </div>
        </div>

        <article className="prose prose-gray max-w-none mt-6">
          <ReactMarkdown remarkPlugins={[remarkGfm]}>{content}</ReactMarkdown>
        </article>
      </div>
    </main>
  );
}
