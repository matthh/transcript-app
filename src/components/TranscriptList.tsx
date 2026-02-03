'use client';

import Link from 'next/link';
import { TranscriptMetadata } from '@/types/transcript';

interface TranscriptListProps {
  transcripts: TranscriptMetadata[];
}

export default function TranscriptList({ transcripts }: TranscriptListProps) {
  return (
    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
      {transcripts.map((transcript) => (
        <Link
          key={transcript.filename}
          href={`/review/${transcript.filename}`}
          className="block p-4 border rounded-lg hover:bg-gray-50 transition-colors"
        >
          <div className="flex items-start justify-between">
            <div className="flex-1 min-w-0">
              <h3 className="font-semibold text-lg truncate">
                {transcript.episode_name}
              </h3>
              <p className="text-sm text-gray-500">
                Episode {transcript.episode_number}
              </p>
            </div>
            {transcript.hasAudio && (
              <span className="ml-2 px-2 py-1 bg-green-100 text-green-800 text-xs rounded-full">
                Audio
              </span>
            )}
          </div>
          <p className="mt-2 text-sm text-gray-600">
            {transcript.dialogueCount} dialogue segments
          </p>
        </Link>
      ))}
    </div>
  );
}
