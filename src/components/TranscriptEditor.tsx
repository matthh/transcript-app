'use client';

import { useMemo } from 'react';
import { DialogueEntry } from '@/types/transcript';
import DialogueSegment from './DialogueSegment';

interface TranscriptEditorProps {
  dialogues: DialogueEntry[];
  activeSegmentIndex: number;
  onTimestampClick: (timestamp: string) => void;
  onSpeakerChange: (index: number, speaker: string) => void;
  onTextChange: (index: number, text: string) => void;
}

export default function TranscriptEditor({
  dialogues,
  activeSegmentIndex,
  onTimestampClick,
  onSpeakerChange,
  onTextChange,
}: TranscriptEditorProps) {
  const speakers = useMemo(() => {
    const speakerSet = new Set<string>();
    dialogues.forEach((d) => speakerSet.add(d.name));
    return Array.from(speakerSet).sort();
  }, [dialogues]);

  return (
    <div className="space-y-3">
      {dialogues.map((dialogue, index) => (
        <DialogueSegment
          key={index}
          dialogue={dialogue}
          index={index}
          isActive={index === activeSegmentIndex}
          speakers={speakers}
          onTimestampClick={onTimestampClick}
          onSpeakerChange={onSpeakerChange}
          onTextChange={onTextChange}
        />
      ))}
    </div>
  );
}
