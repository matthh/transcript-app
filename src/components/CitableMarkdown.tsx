'use client';

import { useState, useRef, useEffect, useCallback } from 'react';
import { createPortal } from 'react-dom';
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

function normalizeTitle(t: string): string {
  return t
    .replace(/\s*\(\d{4}\)/g, '')
    .replace(/^EMERGENCY EP\s*-\s*/i, '')
    .replace(/^BONUS:\s*/i, '')
    .replace(/^Best of Escape Hatch:\s*/i, '')
    .trim()
    .toLowerCase();
}

function matchSourcesToTitle(
  boldText: string,
  sources: TranscriptSource[]
): TranscriptSource[] {
  const normalized = normalizeTitle(boldText);
  if (normalized.length < 3) return [];

  const matches = sources.filter((s) => {
    const sourceNorm = normalizeTitle(s.episodeTitle);
    return sourceNorm.includes(normalized) || normalized.includes(sourceNorm);
  });

  return matches.sort((a, b) => b.score - a.score);
}

function extractPlainText(children: React.ReactNode): string {
  if (typeof children === 'string') return children;
  if (Array.isArray(children)) return children.map(extractPlainText).join('');
  if (children && typeof children === 'object' && 'props' in children) {
    return extractPlainText((children as React.ReactElement<{ children?: React.ReactNode }>).props.children);
  }
  return '';
}

interface PopoverPosition {
  top: number;
  left: number;
  asBottomSheet: boolean;
}

function CitationPopover({
  sources,
  position,
  onClose,
}: {
  sources: TranscriptSource[];
  position: PopoverPosition;
  onClose: () => void;
}) {
  const popoverRef = useRef<HTMLDivElement>(null);
  const [expanded, setExpanded] = useState(false);
  const [showAllExcerpts, setShowAllExcerpts] = useState(false);

  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose();
    }
    function handleClickOutside(e: MouseEvent) {
      if (popoverRef.current && !popoverRef.current.contains(e.target as Node)) {
        onClose();
      }
    }
    document.addEventListener('keydown', handleKeyDown);
    document.addEventListener('mousedown', handleClickOutside);
    return () => {
      document.removeEventListener('keydown', handleKeyDown);
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [onClose]);

  // Clamp position to viewport
  useEffect(() => {
    if (!popoverRef.current || position.asBottomSheet) return;
    const rect = popoverRef.current.getBoundingClientRect();
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    if (rect.right > vw - 16) {
      popoverRef.current.style.left = `${Math.max(16, vw - rect.width - 16)}px`;
    }
    if (rect.bottom > vh - 16) {
      popoverRef.current.style.top = `${Math.max(16, position.top - rect.height - 8)}px`;
    }
  }, [position]);

  const best = sources[0];
  const rest = sources.slice(1);
  const textTruncated = best.text.length > 300 && !expanded;
  const displayText = textTruncated ? best.text.slice(0, 300) + '...' : best.text;

  if (position.asBottomSheet) {
    return createPortal(
      <>
        <div className="fixed inset-0 bg-black/30 z-40" onClick={onClose} />
        <div
          ref={popoverRef}
          className="fixed bottom-0 left-0 right-0 bg-white rounded-t-2xl shadow-xl border-t border-gray-200 p-5 z-50 max-h-[70vh] overflow-y-auto"
        >
          <PopoverContent
            best={best}
            rest={rest}
            displayText={displayText}
            textTruncated={textTruncated}
            expanded={expanded}
            setExpanded={setExpanded}
            showAllExcerpts={showAllExcerpts}
            setShowAllExcerpts={setShowAllExcerpts}
            onClose={onClose}
          />
        </div>
      </>,
      document.body
    );
  }

  return createPortal(
    <div
      ref={popoverRef}
      style={{ top: position.top, left: position.left }}
      className="fixed bg-white rounded-xl shadow-xl border border-gray-200 p-5 max-w-md z-50"
    >
      <PopoverContent
        best={best}
        rest={rest}
        displayText={displayText}
        textTruncated={textTruncated}
        expanded={expanded}
        setExpanded={setExpanded}
        showAllExcerpts={showAllExcerpts}
        setShowAllExcerpts={setShowAllExcerpts}
        onClose={onClose}
      />
    </div>,
    document.body
  );
}

function PopoverContent({
  best,
  rest,
  displayText,
  textTruncated,
  expanded,
  setExpanded,
  showAllExcerpts,
  setShowAllExcerpts,
  onClose,
}: {
  best: TranscriptSource;
  rest: TranscriptSource[];
  displayText: string;
  textTruncated: boolean;
  expanded: boolean;
  setExpanded: (v: boolean) => void;
  showAllExcerpts: boolean;
  setShowAllExcerpts: (v: boolean) => void;
  onClose: () => void;
}) {
  return (
    <>
      <div className="flex items-start justify-between gap-2 mb-2">
        <h4 className="font-semibold text-gray-900 text-sm leading-tight">
          {best.episodeTitle}
        </h4>
        <button
          onClick={onClose}
          className="text-gray-400 hover:text-gray-600 shrink-0 -mt-1 -mr-1 p-1"
          aria-label="Close"
        >
          <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
            <path d="M1 1L13 13M13 1L1 13" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
          </svg>
        </button>
      </div>
      <p className="text-xs text-gray-500 mb-3">
        {best.speakers} &middot; {best.startTimestamp}
      </p>
      <p className="text-sm text-gray-700 leading-relaxed whitespace-pre-line">
        {displayText}
        {textTruncated && (
          <button
            onClick={() => setExpanded(true)}
            className="text-brand-plum hover:underline ml-1 text-sm"
          >
            Show more
          </button>
        )}
        {expanded && best.text.length > 300 && (
          <button
            onClick={() => setExpanded(false)}
            className="text-brand-plum hover:underline ml-1 text-sm"
          >
            Show less
          </button>
        )}
      </p>
      {rest.length > 0 && (
        <div className="mt-3 pt-3 border-t border-gray-100">
          <button
            onClick={() => setShowAllExcerpts(!showAllExcerpts)}
            className="text-xs text-brand-plum hover:underline"
          >
            {showAllExcerpts ? 'Hide' : `${rest.length} more excerpt${rest.length > 1 ? 's' : ''}`}
          </button>
          {showAllExcerpts && (
            <div className="mt-2 space-y-3">
              {rest.map((s, i) => (
                <div key={i}>
                  <p className="text-xs text-gray-500 mb-1">
                    {s.speakers} &middot; {s.startTimestamp}
                  </p>
                  <p className="text-sm text-gray-700 leading-relaxed whitespace-pre-line">
                    {s.text.length > 300 ? s.text.slice(0, 300) + '...' : s.text}
                  </p>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </>
  );
}

function CitationButton({
  children,
  sources,
}: {
  children: React.ReactNode;
  sources: TranscriptSource[];
}) {
  const [open, setOpen] = useState(false);
  const [position, setPosition] = useState<PopoverPosition | null>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);

  const handleClose = useCallback(() => setOpen(false), []);

  const handleClick = () => {
    if (open) {
      setOpen(false);
      return;
    }
    if (!buttonRef.current) return;
    const rect = buttonRef.current.getBoundingClientRect();
    const asBottomSheet = window.innerWidth < 640;
    setPosition({
      top: rect.bottom + 8,
      left: rect.left,
      asBottomSheet,
    });
    setOpen(true);
  };

  return (
    <>
      <button
        ref={buttonRef}
        onClick={handleClick}
        className="font-bold underline decoration-brand-plum/40 decoration-2 underline-offset-2 text-brand-plum hover:decoration-brand-plum cursor-pointer transition-colors"
      >
        {children}
      </button>
      {open && position && (
        <CitationPopover
          sources={sources}
          position={position}
          onClose={handleClose}
        />
      )}
    </>
  );
}

export function CitableMarkdown({
  content,
  sources,
}: {
  content: string;
  sources: TranscriptSource[];
}) {
  return (
    <ReactMarkdown
      remarkPlugins={[remarkGfm]}
      components={{
        strong: ({ children }) => {
          const text = extractPlainText(children);
          const matched = matchSourcesToTitle(text, sources);
          if (matched.length === 0) {
            return <strong>{children}</strong>;
          }
          return (
            <CitationButton sources={matched}>
              {children}
            </CitationButton>
          );
        },
        em: ({ children }) => {
          const text = extractPlainText(children);
          const matched = matchSourcesToTitle(text, sources);
          if (matched.length === 0) {
            return <em>{children}</em>;
          }
          return (
            <CitationButton sources={matched}>
              {children}
            </CitationButton>
          );
        },
      }}
    >
      {content}
    </ReactMarkdown>
  );
}
