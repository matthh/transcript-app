'use client';

import Link from 'next/link';

const timelineSteps = [
  'Intent check (fast metadata answers)',
  'Query classification (factual / interpretive / hybrid)',
  'Data source selection (metadata, transcripts, or both)',
  'Quick answer (fast model, top results)',
  'Deeper analysis (full model, all results \u2014 on demand)',
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
            <svg width="900" height="260" viewBox="0 0 900 260" className="min-w-[720px]">
              <defs>
                <marker id="arrow" markerWidth="10" markerHeight="10" refX="9" refY="3" orient="auto">
                  <path d="M0,0 L10,3 L0,6 Z" fill="#2563eb" />
                </marker>
                <marker id="arrow-dashed" markerWidth="10" markerHeight="10" refX="9" refY="3" orient="auto">
                  <path d="M0,0 L10,3 L0,6 Z" fill="#7c3aed" />
                </marker>
              </defs>
              {[
                { x: 20, y: 20, w: 160, h: 50, label: 'User question', stroke: '#cbd5f5' },
                { x: 220, y: 20, w: 200, h: 50, label: 'Intent check', stroke: '#cbd5f5' },
                { x: 460, y: 20, w: 200, h: 50, label: 'Classify question', stroke: '#cbd5f5' },
                { x: 700, y: 20, w: 180, h: 50, label: 'Pick data sources', stroke: '#cbd5f5' },
                { x: 380, y: 120, w: 220, h: 50, label: 'Quick answer (Haiku)', stroke: '#93c5fd' },
                { x: 380, y: 200, w: 220, h: 50, label: 'Deeper analysis (Sonnet)', stroke: '#c4b5fd' },
              ].map((box) => (
                <g key={box.label}>
                  <rect x={box.x} y={box.y} width={box.w} height={box.h} rx="10" fill="#ffffff" stroke={box.stroke} />
                  <text x={box.x + box.w / 2} y={box.y + 30} textAnchor="middle" fontSize="12" fill="#1f2937">
                    {box.label}
                  </text>
                </g>
              ))}
              <line x1="180" y1="45" x2="220" y2="45" stroke="#2563eb" strokeWidth="2" markerEnd="url(#arrow)" />
              <line x1="420" y1="45" x2="460" y2="45" stroke="#2563eb" strokeWidth="2" markerEnd="url(#arrow)" />
              <line x1="660" y1="45" x2="700" y2="45" stroke="#2563eb" strokeWidth="2" markerEnd="url(#arrow)" />
              <line x1="490" y1="70" x2="490" y2="120" stroke="#2563eb" strokeWidth="2" markerEnd="url(#arrow)" />
              <line x1="490" y1="170" x2="490" y2="200" stroke="#7c3aed" strokeWidth="2" strokeDasharray="6 3" markerEnd="url(#arrow-dashed)" />
              <text x="280" y="100" fontSize="10" fill="#6b7280">If metadata question, answer immediately</text>
              <text x="510" y="190" fontSize="10" fill="#7c3aed">User clicks &quot;Show deeper analysis&quot;</text>
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
            <h2 className="text-xl font-semibold text-gray-900">4) Quick answer</h2>
            <p className="mt-2 text-gray-700">
              A fast answer is generated using a lightweight model (Haiku) and the top 4 transcript
              passages. This typically arrives in 5-10 seconds. All retrieved sources are still
              shown below the answer so you can browse what was found.
            </p>
          </div>
          <div>
            <h2 className="text-xl font-semibold text-gray-900">5) Deeper analysis (on demand)</h2>
            <p className="mt-2 text-gray-700">
              If more transcript passages were found than the quick answer used, a
              &ldquo;Show deeper analysis&rdquo; button appears. Clicking it runs a second pass
              with a more powerful model (Sonnet) and all retrieved passages, producing a richer,
              more comprehensive answer. This takes longer (15-30 seconds) but draws on more evidence.
            </p>
          </div>
        </section>

        <section className="mt-12">
          <h2 className="text-xl font-semibold text-gray-900">Technical components (high level)</h2>
          <p className="mt-2 text-gray-600">
            This is a slightly more technical view of which systems are involved, without diving into code.
          </p>
          <div className="mt-4 rounded-xl border border-gray-200 bg-gray-50 p-4 overflow-x-auto">
            <svg width="980" height="300" viewBox="0 0 980 300" className="min-w-[760px]">
              <defs>
                <marker id="arrow2" markerWidth="10" markerHeight="10" refX="9" refY="3" orient="auto">
                  <path d="M0,0 L10,3 L0,6 Z" fill="#0f766e" />
                </marker>
                <marker id="arrow3" markerWidth="10" markerHeight="10" refX="9" refY="3" orient="auto">
                  <path d="M0,0 L10,3 L0,6 Z" fill="#7c3aed" />
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
                { x: 820, y: 100, w: 140, h: 50, label: 'Quick (Haiku)' },
                { x: 820, y: 210, w: 140, h: 50, label: 'Deep (Sonnet)' },
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
              <line x1="810" y1="140" x2="820" y2="135" stroke="#0f766e" strokeWidth="2" markerEnd="url(#arrow2)" />
              <line x1="890" y1="150" x2="890" y2="210" stroke="#7c3aed" strokeWidth="2" strokeDasharray="6 3" markerEnd="url(#arrow3)" />
              <text x="900" y="185" fontSize="10" fill="#7c3aed">on demand</text>
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
              <h3 className="font-semibold text-gray-900">Quick synthesis (Haiku)</h3>
              <p className="mt-1">Builds a fast answer from the top 4 passages using a lightweight model.</p>
            </div>
            <div className="rounded-lg border border-gray-200 p-4">
              <h3 className="font-semibold text-gray-900">Deep synthesis (Sonnet)</h3>
              <p className="mt-1">On demand: re-synthesizes using all passages with a more powerful model.</p>
            </div>
          </div>
        </section>

        <section className="mt-12">
          <h2 className="text-xl font-semibold text-gray-900">Quick example</h2>
          <div className="mt-3 rounded-lg border border-gray-200 bg-gray-50 p-4 text-gray-700">
            <p className="font-semibold">Question: &ldquo;What did the hosts think about <em>Alien</em>?&rdquo;</p>
            <ul className="mt-2 list-disc pl-5 space-y-1">
              <li>Intent check: not a simple metadata question</li>
              <li>Classification: interpretive</li>
              <li>Data sources: transcripts (hybrid search) &mdash; finds 12 relevant passages</li>
              <li>Quick answer (~8s): Haiku summarizes the top 4 passages with quotes</li>
              <li>Deeper analysis (on demand, ~25s): Sonnet uses all 12 passages for a richer answer</li>
            </ul>
          </div>
        </section>

        <section className="mt-12">
          <h2 className="text-xl font-semibold text-gray-900">How we test this</h2>
          <p className="mt-2 text-gray-600">
            Search quality is tricky to test because answers are generated by an LLM. We use a
            combination of automated eval and manual spot-checks.
          </p>
          <div className="mt-4 space-y-4">
            <div className="rounded-lg border border-gray-200 p-4">
              <h3 className="font-semibold text-gray-900">Eval suite (37 cases)</h3>
              <p className="mt-1 text-gray-700">
                A dataset of representative queries with assertions: expected text in the answer,
                text that should <em>not</em> appear, expected source episodes, classification type,
                and minimum source counts. The suite runs end-to-end against the live SSE endpoint,
                so it tests the full pipeline from classification through retrieval and synthesis.
              </p>
              <p className="mt-2 text-gray-700">
                Cases are tagged (e.g. <code className="text-sm bg-gray-100 px-1 rounded">interpretive</code>,
                {' '}<code className="text-sm bg-gray-100 px-1 rounded">voicemail</code>,
                {' '}<code className="text-sm bg-gray-100 px-1 rounded">factual</code>) so we
                can run targeted subsets when changing a specific area.
              </p>
            </div>
            <div className="rounded-lg border border-gray-200 p-4">
              <h3 className="font-semibold text-gray-900">A/B comparison mode</h3>
              <p className="mt-1 text-gray-700">
                The eval harness supports <code className="text-sm bg-gray-100 px-1 rounded">--baseline</code> and
                {' '}<code className="text-sm bg-gray-100 px-1 rounded">--candidate</code> flags to run the same
                queries against two different deployments and compare pass rates, latencies, and
                answer quality side by side.
              </p>
            </div>
            <div className="rounded-lg border border-gray-200 p-4">
              <h3 className="font-semibold text-gray-900">Feedback loop</h3>
              <p className="mt-1 text-gray-700">
                Users can rate answers as good or bad. Bad-rated queries are logged, and a script
                converts them into eval case skeletons so the dataset grows from real usage patterns.
              </p>
            </div>
            <div className="rounded-lg border border-gray-200 p-4">
              <h3 className="font-semibold text-gray-900">Quick vs deep validation</h3>
              <p className="mt-1 text-gray-700">
                The eval suite defaults to quick mode (the user-facing default). We verify that
                quick answers still pass the same quality assertions. The 2 cases that currently
                fail in quick mode are niche retrieval queries where 4 passages aren&apos;t enough
                &mdash; exactly the scenario where &ldquo;Show deeper analysis&rdquo; exists.
              </p>
            </div>
          </div>
        </section>
      </div>
    </main>
  );
}
