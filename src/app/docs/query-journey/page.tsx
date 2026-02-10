'use client';

import Link from 'next/link';

const timelineSteps = [
  'Intent check (fast metadata answers)',
  'Query classification (factual / interpretive / hybrid)',
  'Data source selection (metadata, transcripts, or both)',
  'Answer synthesis with citations + timestamps',
];

export default function QueryJourneyPage() {
  return (
    <main className="min-h-screen bg-white">
      <div className="max-w-4xl mx-auto px-6 py-10">
        <div className="flex items-center justify-between">
          <Link href="/" className="text-sm text-blue-600 hover:underline">
            Back to search
          </Link>
          <span className="text-xs text-gray-400">Docs</span>
        </div>

        <header className="mt-6">
          <h1 className="text-3xl font-semibold text-gray-900">How a Query Travels Through the Search System</h1>
          <p className="mt-3 text-lg text-gray-600">
            A plain‑English guide to how questions are classified, what data sources are
            consulted, and how the final answer is assembled.
          </p>
        </header>

        <section className="mt-10">
          <h2 className="text-xl font-semibold text-gray-900">The short version</h2>
          <ol className="mt-4 grid gap-3 text-gray-700">
            {timelineSteps.map((step, index) => (
              <li key={step} className="flex items-start gap-3">
                <span className="flex h-6 w-6 items-center justify-center rounded-full bg-blue-600 text-xs font-semibold text-white">
                  {index + 1}
                </span>
                <span>{step}</span>
              </li>
            ))}
          </ol>
        </section>

        <section className="mt-12">
          <h2 className="text-xl font-semibold text-gray-900">A simple diagram</h2>
          <p className="mt-2 text-gray-600">
            This shows the high‑level flow from question to answer.
          </p>
          <div className="mt-4 rounded-xl border border-gray-200 bg-gray-50 p-4 overflow-x-auto">
            <svg width="900" height="220" viewBox="0 0 900 220" className="min-w-[720px]">
              <defs>
                <marker id="arrow" markerWidth="10" markerHeight="10" refX="9" refY="3" orient="auto">
                  <path d="M0,0 L10,3 L0,6 Z" fill="#2563eb" />
                </marker>
              </defs>
              {[
                { x: 20, y: 20, w: 160, h: 50, label: 'User question' },
                { x: 220, y: 20, w: 200, h: 50, label: 'Intent check' },
                { x: 460, y: 20, w: 200, h: 50, label: 'Classify question' },
                { x: 700, y: 20, w: 180, h: 50, label: 'Pick data sources' },
                { x: 460, y: 130, w: 200, h: 50, label: 'Answer synthesis' },
              ].map((box) => (
                <g key={box.label}>
                  <rect x={box.x} y={box.y} width={box.w} height={box.h} rx="10" fill="#ffffff" stroke="#cbd5f5" />
                  <text x={box.x + box.w / 2} y={box.y + 30} textAnchor="middle" fontSize="12" fill="#1f2937">
                    {box.label}
                  </text>
                </g>
              ))}
              <line x1="180" y1="45" x2="220" y2="45" stroke="#2563eb" strokeWidth="2" markerEnd="url(#arrow)" />
              <line x1="420" y1="45" x2="460" y2="45" stroke="#2563eb" strokeWidth="2" markerEnd="url(#arrow)" />
              <line x1="660" y1="45" x2="700" y2="45" stroke="#2563eb" strokeWidth="2" markerEnd="url(#arrow)" />
              <line x1="560" y1="70" x2="560" y2="130" stroke="#2563eb" strokeWidth="2" markerEnd="url(#arrow)" />
              <text x="280" y="90" fontSize="10" fill="#6b7280">If metadata question → quick answer</text>
            </svg>
          </div>
        </section>

        <section className="mt-12 space-y-6">
          <div>
            <h2 className="text-xl font-semibold text-gray-900">1) Intent check (quick answers)</h2>
            <p className="mt-2 text-gray-700">
              Some questions are quick metadata lookups like “latest episode” or “how many episodes.”
              When that happens, we answer directly from the episode list without a full transcript search.
            </p>
          </div>
          <div>
            <h2 className="text-xl font-semibold text-gray-900">2) Classification</h2>
            <p className="mt-2 text-gray-700">
              We label the question as factual, interpretive, or hybrid, and extract filters
              like guest, film, director, genre, or season.
            </p>
          </div>
          <div>
            <h2 className="text-xl font-semibold text-gray-900">3) Data sources consulted</h2>
            <div className="mt-2 grid gap-4 md:grid-cols-2">
              <div className="rounded-lg border border-gray-200 p-4">
                <h3 className="font-semibold text-gray-900">Episode metadata</h3>
                <p className="mt-1 text-gray-700">
                  Titles, guests, release dates, and summary fields. Great for factual answers and filtering.
                </p>
              </div>
              <div className="rounded-lg border border-gray-200 p-4">
                <h3 className="font-semibold text-gray-900">Transcripts</h3>
                <p className="mt-1 text-gray-700">
                  Used for “what did they say?” questions. We run hybrid search (meaning + keywords).
                </p>
              </div>
            </div>
          </div>
          <div>
            <h2 className="text-xl font-semibold text-gray-900">4) Answer synthesis</h2>
            <p className="mt-2 text-gray-700">
              The final response is assembled from the best matches, with citations and timestamps
              so readers can jump to the source.
            </p>
          </div>
        </section>

        <section className="mt-12">
          <h2 className="text-xl font-semibold text-gray-900">Technical components (high level)</h2>
          <p className="mt-2 text-gray-600">
            This is a slightly more technical view of which systems are involved, without diving into code.
          </p>
          <div className="mt-4 rounded-xl border border-gray-200 bg-gray-50 p-4 overflow-x-auto">
            <svg width="980" height="260" viewBox="0 0 980 260" className="min-w-[760px]">
              <defs>
                <marker id="arrow2" markerWidth="10" markerHeight="10" refX="9" refY="3" orient="auto">
                  <path d="M0,0 L10,3 L0,6 Z" fill="#0f766e" />
                </marker>
              </defs>
              {[
                { x: 20, y: 20, w: 160, h: 50, label: 'Search UI' },
                { x: 220, y: 20, w: 160, h: 50, label: '/api/search' },
                { x: 420, y: 20, w: 180, h: 50, label: 'Intent + classification' },
                { x: 640, y: 20, w: 160, h: 50, label: 'Data selection' },
                { x: 220, y: 130, w: 170, h: 50, label: 'Metadata store' },
                { x: 430, y: 130, w: 170, h: 50, label: 'Vector store' },
                { x: 640, y: 130, w: 170, h: 50, label: 'BM25 index' },
                { x: 820, y: 130, w: 140, h: 50, label: 'Answer synthesis' },
              ].map((box) => (
                <g key={box.label}>
                  <rect x={box.x} y={box.y} width={box.w} height={box.h} rx="10" fill="#ffffff" stroke="#99f6e4" />
                  <text x={box.x + box.w / 2} y={box.y + 30} textAnchor="middle" fontSize="12" fill="#134e4a">
                    {box.label}
                  </text>
                </g>
              ))}
              <line x1="180" y1="45" x2="220" y2="45" stroke="#0f766e" strokeWidth="2" markerEnd="url(#arrow2)" />
              <line x1="380" y1="45" x2="420" y2="45" stroke="#0f766e" strokeWidth="2" markerEnd="url(#arrow2)" />
              <line x1="600" y1="45" x2="640" y2="45" stroke="#0f766e" strokeWidth="2" markerEnd="url(#arrow2)" />
              <line x1="640" y1="70" x2="640" y2="130" stroke="#0f766e" strokeWidth="2" markerEnd="url(#arrow2)" />
              <line x1="510" y1="70" x2="510" y2="130" stroke="#0f766e" strokeWidth="2" markerEnd="url(#arrow2)" />
              <line x1="305" y1="70" x2="305" y2="130" stroke="#0f766e" strokeWidth="2" markerEnd="url(#arrow2)" />
              <line x1="390" y1="155" x2="430" y2="155" stroke="#0f766e" strokeWidth="2" markerEnd="url(#arrow2)" />
              <line x1="600" y1="155" x2="640" y2="155" stroke="#0f766e" strokeWidth="2" markerEnd="url(#arrow2)" />
              <line x1="810" y1="155" x2="820" y2="155" stroke="#0f766e" strokeWidth="2" markerEnd="url(#arrow2)" />
            </svg>
          </div>
          <div className="mt-6 grid gap-3 text-gray-700 md:grid-cols-2">
            <div className="rounded-lg border border-gray-200 p-4">
              <h3 className="font-semibold text-gray-900">Search UI</h3>
              <p className="mt-1">Where someone types a question and starts a search.</p>
            </div>
            <div className="rounded-lg border border-gray-200 p-4">
              <h3 className="font-semibold text-gray-900">/api/search</h3>
              <p className="mt-1">The server endpoint that orchestrates the full search flow.</p>
            </div>
            <div className="rounded-lg border border-gray-200 p-4">
              <h3 className="font-semibold text-gray-900">Intent + classification</h3>
              <p className="mt-1">
                Detects quick metadata questions and labels the query as factual, interpretive, or hybrid.
              </p>
            </div>
            <div className="rounded-lg border border-gray-200 p-4">
              <h3 className="font-semibold text-gray-900">Data selection</h3>
              <p className="mt-1">Decides whether to use metadata, transcripts, or both.</p>
            </div>
            <div className="rounded-lg border border-gray-200 p-4">
              <h3 className="font-semibold text-gray-900">Metadata store</h3>
              <p className="mt-1">
                Structured episode data: titles, guests, release dates, and summaries.
              </p>
            </div>
            <div className="rounded-lg border border-gray-200 p-4">
              <h3 className="font-semibold text-gray-900">Vector store</h3>
              <p className="mt-1">Meaning‑based search across transcript chunks.</p>
            </div>
            <div className="rounded-lg border border-gray-200 p-4">
              <h3 className="font-semibold text-gray-900">BM25 index</h3>
              <p className="mt-1">Exact‑word search across transcript chunks.</p>
            </div>
            <div className="rounded-lg border border-gray-200 p-4">
              <h3 className="font-semibold text-gray-900">Answer synthesis</h3>
              <p className="mt-1">Builds the final response with citations and timestamps.</p>
            </div>
          </div>
        </section>

        <section className="mt-12">
          <h2 className="text-xl font-semibold text-gray-900">Quick example</h2>
          <div className="mt-3 rounded-lg border border-gray-200 bg-gray-50 p-4 text-gray-700">
            <p className="font-semibold">Question: “What did the hosts think about <em>Alien</em>?”</p>
            <ul className="mt-2 list-disc pl-5 space-y-1">
              <li>Intent check: not a simple metadata question</li>
              <li>Classification: interpretive</li>
              <li>Data sources: transcripts (hybrid search)</li>
              <li>Answer: summary + cited quotes + timestamps</li>
            </ul>
          </div>
        </section>
      </div>
    </main>
  );
}
