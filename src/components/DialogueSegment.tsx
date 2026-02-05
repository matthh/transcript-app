'use client';

import { useRef, useEffect } from 'react';
import { DialogueEntry } from '@/types/transcript';
import SpeakerSelector from './SpeakerSelector';

interface DialogueSegmentProps {
  dialogue: DialogueEntry;
  index: number;
  isActive: boolean;
  isSelected?: boolean;
  speakers: string[];
  onTimestampClick: (timestamp: string) => void;
  onSpeakerChange: (index: number, speaker: string) => void;
  onTextChange: (index: number, text: string) => void;
  onSelect?: (index: number, event: React.MouseEvent) => void;
}

export default function DialogueSegment({
  dialogue,
  index,
  isActive,
  isSelected = false,
  speakers,
  onTimestampClick,
  onSpeakerChange,
  onTextChange,
  onSelect,
}: DialogueSegmentProps) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (isActive && ref.current) {
      ref.current.scrollIntoView({
        behavior: 'smooth',
        block: 'center',
      });
    }
  }, [isActive]);

  const handleClick = (e: React.MouseEvent) => {
    // Don't trigger selection when clicking on interactive elements
    if (
      e.target instanceof HTMLButtonElement ||
      e.target instanceof HTMLSelectElement ||
      e.target instanceof HTMLTextAreaElement ||
      e.target instanceof HTMLInputElement
    ) {
      return;
    }
    onSelect?.(index, e);
  };

  const isUnassigned = dialogue.name.match(/^Speaker [A-Z]$/);

  return (
    <div
      ref={ref}
      onClick={handleClick}
      className={`p-4 border rounded-lg transition-colors cursor-pointer ${
        isSelected
          ? 'bg-blue-100 border-blue-400 ring-2 ring-blue-300'
          : isActive
          ? 'bg-blue-50 border-blue-300'
          : isUnassigned
          ? 'bg-yellow-50 border-yellow-200 hover:border-yellow-300'
          : 'bg-white border-gray-200 hover:border-gray-300'
      }`}
    >
      <div className="flex items-center gap-3 mb-2">
        {onSelect && (
          <input
            type="checkbox"
            checked={isSelected}
            onChange={() => {}} // Handled by parent click
            onClick={(e) => {
              e.stopPropagation();
              onSelect(index, e as unknown as React.MouseEvent);
            }}
            className="w-4 h-4 text-blue-600 rounded border-gray-300 focus:ring-blue-500"
          />
        )}
        <button
          onClick={(e) => {
            e.stopPropagation();
            onTimestampClick(dialogue.timestamp);
          }}
          className="font-mono text-sm text-blue-600 hover:text-blue-800 hover:underline"
        >
          {dialogue.timestamp}
        </button>
        <SpeakerSelector
          value={dialogue.name}
          speakers={speakers}
          onChange={(speaker) => onSpeakerChange(index, speaker)}
        />
        {isUnassigned && (
          <span className="text-xs px-1.5 py-0.5 bg-yellow-200 text-yellow-800 rounded">
            Unassigned
          </span>
        )}
      </div>
      <textarea
        value={dialogue.text}
        onChange={(e) => onTextChange(index, e.target.value)}
        onClick={(e) => e.stopPropagation()}
        className="w-full p-2 border rounded resize-y min-h-[80px] text-sm"
        rows={3}
      />
    </div>
  );
}
