'use client';

import { useState, useEffect, useMemo, useCallback } from 'react';
import type { DialogueEntry } from '@/types/transcript';
import { useAudioSync } from '@/hooks/useAudioSync';
import AudioPlayer from '@/components/AudioPlayer';

interface SpeakerMapperProps {
  dialogues: DialogueEntry[];
  audioUrl: string | null;
  onMappingComplete: (mappedDialogues: DialogueEntry[]) => void;
  onCancel: () => void;
}

interface KnownSpeaker {
  name: string;
  count: number;
}

const PAGE_SIZE = 50;

export default function SpeakerMapper({
  dialogues: initialDialogues,
  audioUrl,
  onMappingComplete,
  onCancel,
}: SpeakerMapperProps) {
  // State
  const [dialogues, setDialogues] = useState<DialogueEntry[]>(initialDialogues);
  const [currentPage, setCurrentPage] = useState(1);
  const [knownSpeakers, setKnownSpeakers] = useState<KnownSpeaker[]>([]);
  const [loading, setLoading] = useState(true);

  // Mapping mode state
  const [activeMappingLabel, setActiveMappingLabel] = useState<string | null>(null);
  const [excludedIndices, setExcludedIndices] = useState<Set<number>>(new Set());
  const [customSpeaker, setCustomSpeaker] = useState('');

  // Audio sync
  const { state: audioState, controls, setAudioRef } = useAudioSync(dialogues);

  // Derived values
  const totalPages = Math.ceil(dialogues.length / PAGE_SIZE);
  const startIndex = (currentPage - 1) * PAGE_SIZE;
  const endIndex = Math.min(startIndex + PAGE_SIZE, dialogues.length);
  const pageDialogues = dialogues.slice(startIndex, endIndex);

  // Count unique speakers detected
  const detectedSpeakers = useMemo(() => {
    const speakers = new Set<string>();
    for (const d of dialogues) {
      speakers.add(d.name);
    }
    return speakers.size;
  }, [dialogues]);

  // Get unique speaker labels for quick buttons
  const uniqueSpeakerLabels = useMemo(() => {
    const labelCounts = new Map<string, number>();
    for (const d of dialogues) {
      labelCounts.set(d.name, (labelCounts.get(d.name) || 0) + 1);
    }
    return Array.from(labelCounts.entries())
      .sort((a, b) => b[1] - a[1])
      .map(([name, count]) => ({ name, count }));
  }, [dialogues]);

  // Segments in scope for mapping (matching label, not excluded)
  const segmentsInScope = useMemo(() => {
    if (!activeMappingLabel) return new Set<number>();
    const indices = new Set<number>();
    dialogues.forEach((d, i) => {
      if (d.name === activeMappingLabel && !excludedIndices.has(i)) {
        indices.add(i);
      }
    });
    return indices;
  }, [dialogues, activeMappingLabel, excludedIndices]);

  // Total segments matching the active label
  const totalMatchingSegments = useMemo(() => {
    if (!activeMappingLabel) return 0;
    return dialogues.filter(d => d.name === activeMappingLabel).length;
  }, [dialogues, activeMappingLabel]);

  // Fetch known speakers
  useEffect(() => {
    async function fetchSpeakers() {
      try {
        const response = await fetch('/api/speakers');
        if (response.ok) {
          const data = await response.json();
          setKnownSpeakers(data.speakers || []);
        }
      } catch {
        // Failed to fetch speakers, continue without suggestions
      } finally {
        setLoading(false);
      }
    }
    fetchSpeakers();
  }, []);

  // Enter mapping mode for a label
  const enterMappingMode = useCallback((label: string) => {
    setActiveMappingLabel(label);
    setExcludedIndices(new Set()); // Start with all included
    setCustomSpeaker('');
  }, []);

  // Exit mapping mode
  const exitMappingMode = useCallback(() => {
    setActiveMappingLabel(null);
    setExcludedIndices(new Set());
    setCustomSpeaker('');
  }, []);

  // Toggle segment exclusion
  const toggleSegmentExclusion = useCallback((globalIndex: number) => {
    setExcludedIndices(prev => {
      const next = new Set(prev);
      if (next.has(globalIndex)) {
        next.delete(globalIndex);
      } else {
        next.add(globalIndex);
      }
      return next;
    });
  }, []);

  // Apply mapping to selected segments
  const applyMapping = useCallback((newSpeakerName: string) => {
    if (!newSpeakerName.trim() || segmentsInScope.size === 0) return;

    setDialogues(prev => prev.map((d, i) =>
      segmentsInScope.has(i) ? { ...d, name: newSpeakerName.trim() } : d
    ));
    exitMappingMode();
  }, [segmentsInScope, exitMappingMode]);

  // Audio seek on timestamp click
  const handleTimestampClick = useCallback(async (timestamp: string, e: React.MouseEvent) => {
    e.stopPropagation();
    if (!audioUrl) return;

    controls.seekToTimestamp(timestamp);
    try {
      await controls.play();
    } catch (err) {
      console.error('Audio play failed:', err);
    }
  }, [audioUrl, controls]);

  // Handle speaker label click
  const handleSpeakerLabelClick = useCallback((label: string, e: React.MouseEvent) => {
    e.stopPropagation();
    if (activeMappingLabel === label) {
      exitMappingMode();
    } else {
      enterMappingMode(label);
    }
  }, [activeMappingLabel, enterMappingMode, exitMappingMode]);

  // Page navigation
  const goToPage = useCallback((page: number) => {
    setCurrentPage(Math.max(1, Math.min(page, totalPages)));
  }, [totalPages]);

  // Submit handler
  const handleSubmit = useCallback(() => {
    onMappingComplete(dialogues);
  }, [dialogues, onMappingComplete]);

  // Check if a speaker label looks like a placeholder (e.g., "Speaker A")
  const isPlaceholderLabel = (name: string) => {
    return /^(Speaker\s*)?[A-Z]$/i.test(name);
  };

  if (loading) {
    return (
      <div className="p-6 bg-white rounded-lg shadow">
        <div className="animate-pulse">
          <div className="h-6 bg-gray-200 rounded w-1/3 mb-4"></div>
          <div className="space-y-3">
            <div className="h-20 bg-gray-200 rounded"></div>
            <div className="h-20 bg-gray-200 rounded"></div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="bg-white rounded-lg shadow">
      {/* Header */}
      <div className="p-6 border-b">
        <h2 className="text-xl font-semibold text-gray-900">Map Speakers</h2>
        <p className="mt-1 text-sm text-gray-600">
          Detected {detectedSpeakers} speaker(s) · {dialogues.length} segments · Page {currentPage} of {totalPages}
        </p>
        <p className="mt-2 text-xs text-gray-500">
          Click a speaker label to map all segments with that name
        </p>
      </div>

      {/* Audio Player */}
      {audioUrl && (
        <div className="border-b">
          <AudioPlayer
            audioSrc={audioUrl}
            state={audioState}
            controls={controls}
            setAudioRef={setAudioRef}
          />
        </div>
      )}

      {/* Mapping Mode Panel */}
      {activeMappingLabel && (
        <div className="p-4 border-b bg-blue-50 border-l-4 border-blue-500">
          <div className="flex items-center justify-between mb-3">
            <div>
              <span className="font-medium text-blue-900">
                Mapping: {activeMappingLabel}
              </span>
              <span className="ml-2 text-sm text-blue-700">
                {segmentsInScope.size} of {totalMatchingSegments} segments selected
              </span>
            </div>
            <button
              type="button"
              onClick={exitMappingMode}
              className="text-blue-700 hover:text-blue-900 text-sm"
            >
              Cancel
            </button>
          </div>

          <div className="flex items-center gap-3 flex-wrap">
            {/* Quick assign buttons from known speakers */}
            {knownSpeakers.slice(0, 6).map(({ name }) => (
              <button
                key={name}
                type="button"
                onClick={() => applyMapping(name)}
                disabled={segmentsInScope.size === 0}
                className={`px-3 py-1.5 text-sm rounded-md transition-colors ${
                  segmentsInScope.size === 0
                    ? 'bg-gray-200 text-gray-400 cursor-not-allowed'
                    : 'bg-blue-600 text-white hover:bg-blue-700'
                }`}
              >
                {name}
              </button>
            ))}

            {/* Custom speaker input */}
            <div className="flex items-center gap-1">
              <input
                type="text"
                value={customSpeaker}
                onChange={(e) => setCustomSpeaker(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    applyMapping(customSpeaker);
                  }
                }}
                placeholder="Custom name..."
                className="px-2 py-1.5 text-sm border rounded-md w-40 focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                list="known-speakers-mapping"
                autoFocus
              />
              <datalist id="known-speakers-mapping">
                {knownSpeakers.map(({ name }) => (
                  <option key={name} value={name} />
                ))}
              </datalist>
              <button
                type="button"
                onClick={() => applyMapping(customSpeaker)}
                disabled={segmentsInScope.size === 0 || !customSpeaker.trim()}
                className={`px-4 py-1.5 text-sm rounded-md transition-colors ${
                  segmentsInScope.size === 0 || !customSpeaker.trim()
                    ? 'bg-gray-200 text-gray-400 cursor-not-allowed'
                    : 'bg-blue-600 text-white hover:bg-blue-700'
                }`}
              >
                Apply Mapping
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Dialogue List */}
      <div className="divide-y max-h-[50vh] overflow-y-auto">
        {pageDialogues.map((dialogue, pageIndex) => {
          const globalIndex = startIndex + pageIndex;
          const isActiveSegment = audioState.activeSegmentIndex === globalIndex;
          const matchesActiveLabel = activeMappingLabel === dialogue.name;
          const isExcluded = excludedIndices.has(globalIndex);
          const isInScope = matchesActiveLabel && !isExcluded;
          const isDimmed = activeMappingLabel && !matchesActiveLabel;

          return (
            <div
              key={globalIndex}
              className={`flex items-start gap-3 p-3 transition-colors ${
                isInScope
                  ? 'bg-blue-50 border-l-4 border-blue-500'
                  : isExcluded && matchesActiveLabel
                    ? 'bg-gray-100 border-l-4 border-gray-300'
                    : isActiveSegment
                      ? 'bg-yellow-50'
                      : isDimmed
                        ? 'bg-gray-50 opacity-50'
                        : 'hover:bg-gray-50'
              }`}
            >
              {/* Checkbox - only for segments matching active label */}
              <div className="pt-0.5 w-5">
                {matchesActiveLabel && (
                  <input
                    type="checkbox"
                    checked={!isExcluded}
                    onChange={() => toggleSegmentExclusion(globalIndex)}
                    className="h-4 w-4 text-blue-600 rounded border-gray-300 focus:ring-blue-500 cursor-pointer"
                  />
                )}
              </div>

              {/* Timestamp */}
              <button
                type="button"
                onClick={(e) => handleTimestampClick(dialogue.timestamp, e)}
                className={`text-sm font-mono min-w-[60px] text-left ${
                  audioUrl
                    ? 'text-blue-600 hover:text-blue-800 hover:underline'
                    : 'text-gray-400'
                }`}
                disabled={!audioUrl}
                title={audioUrl ? 'Click to play from here' : 'No audio available'}
              >
                {dialogue.timestamp}
              </button>

              {/* Speaker Label - clickable to enter mapping mode */}
              <button
                type="button"
                onClick={(e) => handleSpeakerLabelClick(dialogue.name, e)}
                className={`text-sm font-medium min-w-[100px] text-left px-2 py-0.5 rounded transition-colors ${
                  activeMappingLabel === dialogue.name
                    ? 'bg-blue-600 text-white'
                    : isPlaceholderLabel(dialogue.name)
                      ? 'text-orange-600 hover:bg-orange-100 border border-orange-300'
                      : 'text-gray-900 hover:bg-gray-200 border border-gray-300'
                }`}
                title="Click to map all segments with this speaker"
              >
                {dialogue.name}
              </button>

              {/* Text */}
              <p className={`text-sm flex-1 line-clamp-2 ${
                isDimmed ? 'text-gray-400' : 'text-gray-700'
              }`}>
                {dialogue.text}
              </p>
            </div>
          );
        })}
      </div>

      {/* Pagination */}
      <div className="p-4 border-t bg-gray-50 flex items-center justify-center gap-4">
        <button
          type="button"
          onClick={() => goToPage(currentPage - 1)}
          disabled={currentPage === 1}
          className={`px-4 py-2 text-sm rounded-md transition-colors ${
            currentPage === 1
              ? 'bg-gray-100 text-gray-400 cursor-not-allowed'
              : 'bg-white border text-gray-700 hover:bg-gray-50'
          }`}
        >
          Prev
        </button>

        <span className="text-sm text-gray-600">
          Page {currentPage} of {totalPages}
        </span>

        <button
          type="button"
          onClick={() => goToPage(currentPage + 1)}
          disabled={currentPage === totalPages}
          className={`px-4 py-2 text-sm rounded-md transition-colors ${
            currentPage === totalPages
              ? 'bg-gray-100 text-gray-400 cursor-not-allowed'
              : 'bg-white border text-gray-700 hover:bg-gray-50'
          }`}
        >
          Next
        </button>
      </div>

      {/* Footer Actions */}
      <div className="p-6 border-t bg-gray-50 flex justify-between">
        <button
          type="button"
          onClick={onCancel}
          className="px-4 py-2 text-gray-700 bg-white border rounded-md hover:bg-gray-50"
        >
          Skip Mapping
        </button>
        <button
          type="button"
          onClick={handleSubmit}
          className="px-6 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700"
        >
          Apply & Continue
        </button>
      </div>
    </div>
  );
}
