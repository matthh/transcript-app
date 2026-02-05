'use client';

import { useMemo, useState, useCallback, useEffect } from 'react';
import { DialogueEntry } from '@/types/transcript';
import DialogueSegment from './DialogueSegment';

interface TranscriptEditorProps {
  dialogues: DialogueEntry[];
  activeSegmentIndex: number;
  onTimestampClick: (timestamp: string) => void;
  onSpeakerChange: (index: number, speaker: string) => void;
  onTextChange: (index: number, text: string) => void;
  onBulkSpeakerChange?: (indices: number[], speaker: string) => void;
  onUndo?: () => void;
  onRedo?: () => void;
  canUndo?: boolean;
  canRedo?: boolean;
}

export default function TranscriptEditor({
  dialogues,
  activeSegmentIndex,
  onTimestampClick,
  onSpeakerChange,
  onTextChange,
  onBulkSpeakerChange,
  onUndo,
  onRedo,
  canUndo = false,
  canRedo = false,
}: TranscriptEditorProps) {
  const [selectedIndices, setSelectedIndices] = useState<Set<number>>(new Set());
  const [lastSelectedIndex, setLastSelectedIndex] = useState<number | null>(null);

  const speakers = useMemo(() => {
    const speakerSet = new Set<string>();
    dialogues.forEach((d) => speakerSet.add(d.name));
    return Array.from(speakerSet).sort();
  }, [dialogues]);

  // Known speakers (non-diarized labels like "Speaker A")
  const knownSpeakers = useMemo(() => {
    return speakers.filter(s => !s.match(/^Speaker [A-Z]$/));
  }, [speakers]);

  // Find unassigned segments (still have diarized labels)
  const unassignedIndices = useMemo(() => {
    return dialogues
      .map((d, i) => ({ index: i, name: d.name }))
      .filter(({ name }) => name.match(/^Speaker [A-Z]$/))
      .map(({ index }) => index);
  }, [dialogues]);

  const handleSegmentClick = useCallback((index: number, event: React.MouseEvent) => {
    if (event.shiftKey && lastSelectedIndex !== null) {
      // Range select
      const start = Math.min(lastSelectedIndex, index);
      const end = Math.max(lastSelectedIndex, index);
      const newSelection = new Set(selectedIndices);
      for (let i = start; i <= end; i++) {
        newSelection.add(i);
      }
      setSelectedIndices(newSelection);
    } else if (event.ctrlKey || event.metaKey) {
      // Toggle select
      const newSelection = new Set(selectedIndices);
      if (newSelection.has(index)) {
        newSelection.delete(index);
      } else {
        newSelection.add(index);
      }
      setSelectedIndices(newSelection);
      setLastSelectedIndex(index);
    } else {
      // Single select (or deselect if clicking same)
      if (selectedIndices.size === 1 && selectedIndices.has(index)) {
        setSelectedIndices(new Set());
        setLastSelectedIndex(null);
      } else {
        setSelectedIndices(new Set([index]));
        setLastSelectedIndex(index);
      }
    }
  }, [selectedIndices, lastSelectedIndex]);

  const handleBulkAssign = useCallback((speaker: string) => {
    if (selectedIndices.size === 0) return;

    if (onBulkSpeakerChange) {
      onBulkSpeakerChange(Array.from(selectedIndices), speaker);
    } else {
      // Fall back to individual changes
      selectedIndices.forEach(index => {
        onSpeakerChange(index, speaker);
      });
    }
    setSelectedIndices(new Set());
  }, [selectedIndices, onBulkSpeakerChange, onSpeakerChange]);

  const handleSelectAll = useCallback(() => {
    setSelectedIndices(new Set(dialogues.map((_, i) => i)));
  }, [dialogues]);

  const handleSelectNone = useCallback(() => {
    setSelectedIndices(new Set());
    setLastSelectedIndex(null);
  }, []);

  const handleSelectSameSpeaker = useCallback((speaker: string) => {
    const indices = dialogues
      .map((d, i) => ({ index: i, name: d.name }))
      .filter(({ name }) => name === speaker)
      .map(({ index }) => index);
    setSelectedIndices(new Set(indices));
  }, [dialogues]);

  const goToNextUnassigned = useCallback(() => {
    if (unassignedIndices.length === 0) return;

    // Find next unassigned after current position
    const currentPos = activeSegmentIndex >= 0 ? activeSegmentIndex : -1;
    const nextIndex = unassignedIndices.find(i => i > currentPos) ?? unassignedIndices[0];

    // Select it and scroll to it
    setSelectedIndices(new Set([nextIndex]));
    setLastSelectedIndex(nextIndex);

    // Trigger timestamp click to scroll/seek
    onTimestampClick(dialogues[nextIndex].timestamp);
  }, [unassignedIndices, activeSegmentIndex, dialogues, onTimestampClick]);

  // Keyboard shortcuts
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Don't handle if typing in an input
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) {
        return;
      }

      // Undo: Ctrl+Z
      if ((e.ctrlKey || e.metaKey) && e.key === 'z' && !e.shiftKey) {
        e.preventDefault();
        onUndo?.();
        return;
      }

      // Redo: Ctrl+Y or Ctrl+Shift+Z
      if ((e.ctrlKey || e.metaKey) && (e.key === 'y' || (e.key === 'z' && e.shiftKey))) {
        e.preventDefault();
        onRedo?.();
        return;
      }

      // Number keys 1-9 for quick speaker assign
      if (selectedIndices.size > 0 && e.key >= '1' && e.key <= '9') {
        const speakerIndex = parseInt(e.key) - 1;
        if (speakerIndex < knownSpeakers.length) {
          e.preventDefault();
          handleBulkAssign(knownSpeakers[speakerIndex]);
        }
        return;
      }

      // 'n' for next unassigned
      if (e.key === 'n' && !e.ctrlKey && !e.metaKey) {
        e.preventDefault();
        goToNextUnassigned();
        return;
      }

      // Escape to deselect
      if (e.key === 'Escape') {
        handleSelectNone();
        return;
      }

      // Ctrl+A to select all
      if ((e.ctrlKey || e.metaKey) && e.key === 'a') {
        e.preventDefault();
        handleSelectAll();
        return;
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [selectedIndices, knownSpeakers, handleBulkAssign, goToNextUnassigned, handleSelectAll, handleSelectNone, onUndo, onRedo]);

  return (
    <div>
      {/* Toolbar */}
      <div className="sticky top-0 z-10 bg-white border-b mb-4 p-3 rounded-lg shadow-sm">
        <div className="flex items-center justify-between gap-4 flex-wrap">
          <div className="flex items-center gap-2">
            <span className="text-sm text-gray-600">
              {selectedIndices.size > 0
                ? `${selectedIndices.size} selected`
                : `${dialogues.length} segments`}
            </span>
            {selectedIndices.size > 0 && (
              <button
                onClick={handleSelectNone}
                className="text-sm text-blue-600 hover:underline"
              >
                Clear
              </button>
            )}
            {unassignedIndices.length > 0 && (
              <button
                onClick={goToNextUnassigned}
                className="text-sm px-2 py-1 bg-yellow-100 text-yellow-800 rounded hover:bg-yellow-200"
                title="Press 'n' to go to next unassigned"
              >
                {unassignedIndices.length} unassigned →
              </button>
            )}
          </div>

          <div className="flex items-center gap-2">
            {(canUndo || canRedo) && (
              <div className="flex items-center gap-1 mr-2">
                <button
                  onClick={onUndo}
                  disabled={!canUndo}
                  className="p-1.5 rounded hover:bg-gray-100 disabled:opacity-30 disabled:cursor-not-allowed"
                  title="Undo (Ctrl+Z)"
                >
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 10h10a8 8 0 018 8v2M3 10l6 6m-6-6l6-6" />
                  </svg>
                </button>
                <button
                  onClick={onRedo}
                  disabled={!canRedo}
                  className="p-1.5 rounded hover:bg-gray-100 disabled:opacity-30 disabled:cursor-not-allowed"
                  title="Redo (Ctrl+Y)"
                >
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 10h-10a8 8 0 00-8 8v2M21 10l-6 6m6-6l-6-6" />
                  </svg>
                </button>
              </div>
            )}

            {selectedIndices.size > 0 && (
              <>
                <span className="text-sm text-gray-500">Assign to:</span>
                {knownSpeakers.slice(0, 5).map((speaker, i) => (
                  <button
                    key={speaker}
                    onClick={() => handleBulkAssign(speaker)}
                    className="px-2 py-1 text-sm bg-blue-100 text-blue-800 rounded hover:bg-blue-200"
                    title={`Press ${i + 1} to assign`}
                  >
                    <span className="text-xs text-blue-500 mr-1">{i + 1}</span>
                    {speaker}
                  </button>
                ))}
                <select
                  onChange={(e) => {
                    if (e.target.value) {
                      handleBulkAssign(e.target.value);
                      e.target.value = '';
                    }
                  }}
                  className="text-sm border rounded px-2 py-1"
                  defaultValue=""
                >
                  <option value="">More...</option>
                  {speakers.map(speaker => (
                    <option key={speaker} value={speaker}>{speaker}</option>
                  ))}
                </select>
              </>
            )}
          </div>
        </div>

        {/* Speaker legend with click-to-select */}
        <div className="flex items-center gap-2 mt-2 text-xs text-gray-500 flex-wrap">
          <span>Click speaker to select all:</span>
          {speakers.map(speaker => {
            const count = dialogues.filter(d => d.name === speaker).length;
            const isUnassigned = speaker.match(/^Speaker [A-Z]$/);
            return (
              <button
                key={speaker}
                onClick={() => handleSelectSameSpeaker(speaker)}
                className={`px-2 py-0.5 rounded ${
                  isUnassigned
                    ? 'bg-yellow-100 text-yellow-800 hover:bg-yellow-200'
                    : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                }`}
              >
                {speaker} ({count})
              </button>
            );
          })}
        </div>
      </div>

      {/* Segments */}
      <div className="space-y-3">
        {dialogues.map((dialogue, index) => (
          <DialogueSegment
            key={index}
            dialogue={dialogue}
            index={index}
            isActive={index === activeSegmentIndex}
            isSelected={selectedIndices.has(index)}
            speakers={speakers}
            onTimestampClick={onTimestampClick}
            onSpeakerChange={onSpeakerChange}
            onTextChange={onTextChange}
            onSelect={handleSegmentClick}
          />
        ))}
      </div>

      {/* Keyboard shortcuts help */}
      <div className="mt-6 p-4 bg-gray-50 rounded-lg text-sm text-gray-600">
        <div className="font-medium mb-2">Keyboard Shortcuts</div>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-2 text-xs">
          <div><kbd className="px-1 bg-gray-200 rounded">Click</kbd> Select segment</div>
          <div><kbd className="px-1 bg-gray-200 rounded">Shift+Click</kbd> Range select</div>
          <div><kbd className="px-1 bg-gray-200 rounded">Ctrl+Click</kbd> Toggle select</div>
          <div><kbd className="px-1 bg-gray-200 rounded">Ctrl+A</kbd> Select all</div>
          <div><kbd className="px-1 bg-gray-200 rounded">1-9</kbd> Assign speaker</div>
          <div><kbd className="px-1 bg-gray-200 rounded">n</kbd> Next unassigned</div>
          <div><kbd className="px-1 bg-gray-200 rounded">Ctrl+Z</kbd> Undo</div>
          <div><kbd className="px-1 bg-gray-200 rounded">Ctrl+Y</kbd> Redo</div>
        </div>
      </div>
    </div>
  );
}
