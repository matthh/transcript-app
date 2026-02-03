'use client';

import { useRef, useEffect } from 'react';
import { DialogueEntry } from '@/types/transcript';
import SpeakerSelector from './SpeakerSelector';

interface DialogueSegmentProps {
  dialogue: DialogueEntry;
  index: number;
  isActive: boolean;
  speakers: string[];
  onTimestampClick: (timestamp: string) => void;
  onSpeakerChange: (index: number, speaker: string) => void;
  onTextChange: (index: number, text: string) => void;
}

export default function DialogueSegment({
  dialogue,
  index,
  isActive,
  speakers,
  onTimestampClick,
  onSpeakerChange,
  onTextChange,
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

  return (
    <div
      ref={ref}
      className={`p-4 border rounded-lg transition-colors ${
        isActive ? 'bg-blue-50 border-blue-300' : 'bg-white border-gray-200'
      }`}
    >
      <div className="flex items-center gap-3 mb-2">
        <button
          onClick={() => onTimestampClick(dialogue.timestamp)}
          className="font-mono text-sm text-blue-600 hover:text-blue-800 hover:underline"
        >
          {dialogue.timestamp}
        </button>
        <SpeakerSelector
          value={dialogue.name}
          speakers={speakers}
          onChange={(speaker) => onSpeakerChange(index, speaker)}
        />
      </div>
      <textarea
        value={dialogue.text}
        onChange={(e) => onTextChange(index, e.target.value)}
        className="w-full p-2 border rounded resize-y min-h-[80px] text-sm"
        rows={3}
      />
    </div>
  );
}
