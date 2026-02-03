'use client';

import { useState, useEffect, useMemo } from 'react';
import type { DialogueEntry } from '@/types/transcript';

interface SpeakerMapperProps {
  dialogues: DialogueEntry[];
  onMappingComplete: (mapping: Map<string, string>) => void;
  onCancel: () => void;
}

interface KnownSpeaker {
  name: string;
  count: number;
}

export default function SpeakerMapper({
  dialogues,
  onMappingComplete,
  onCancel,
}: SpeakerMapperProps) {
  const [knownSpeakers, setKnownSpeakers] = useState<KnownSpeaker[]>([]);
  const [mapping, setMapping] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);

  // Extract unique speakers and sample quotes from dialogues
  const speakerData = useMemo(() => {
    const speakers = new Map<string, { quotes: string[]; count: number }>();

    for (const dialogue of dialogues) {
      const speaker = dialogue.name;
      if (!speakers.has(speaker)) {
        speakers.set(speaker, { quotes: [], count: 0 });
      }
      const data = speakers.get(speaker)!;
      data.count++;
      // Keep up to 3 sample quotes per speaker
      if (data.quotes.length < 3) {
        const quote = dialogue.text.slice(0, 100) + (dialogue.text.length > 100 ? '...' : '');
        data.quotes.push(quote);
      }
    }

    return Array.from(speakers.entries())
      .sort((a, b) => b[1].count - a[1].count)
      .map(([speaker, data]) => ({
        speaker,
        quotes: data.quotes,
        count: data.count,
      }));
  }, [dialogues]);

  // Initialize mapping with empty values
  useEffect(() => {
    const initialMapping: Record<string, string> = {};
    for (const { speaker } of speakerData) {
      initialMapping[speaker] = '';
    }
    setMapping(initialMapping);
  }, [speakerData]);

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

  const handleMappingChange = (speaker: string, value: string) => {
    setMapping(prev => ({ ...prev, [speaker]: value }));
  };

  const handleSubmit = () => {
    const resultMapping = new Map<string, string>();
    for (const { speaker } of speakerData) {
      const mappedName = mapping[speaker]?.trim() || speaker;
      resultMapping.set(speaker, mappedName);
    }
    onMappingComplete(resultMapping);
  };

  const allMapped = speakerData.every(({ speaker }) => mapping[speaker]?.trim());

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
      <div className="p-6 border-b">
        <h2 className="text-xl font-semibold text-gray-900">Map Speakers</h2>
        <p className="mt-1 text-sm text-gray-600">
          AssemblyAI detected {speakerData.length} speaker(s). Map each to their actual name.
        </p>
      </div>

      <div className="p-6 space-y-6">
        {speakerData.map(({ speaker, quotes, count }) => (
          <div key={speaker} className="border rounded-lg p-4">
            <div className="flex items-center justify-between mb-3">
              <div>
                <span className="font-medium text-gray-900">{speaker}</span>
                <span className="ml-2 text-sm text-gray-500">({count} utterances)</span>
              </div>
            </div>

            {/* Sample quotes */}
            <div className="mb-3 space-y-1">
              {quotes.map((quote, idx) => (
                <p key={idx} className="text-sm text-gray-600 italic">
                  &quot;{quote}&quot;
                </p>
              ))}
            </div>

            {/* Mapping input with autocomplete */}
            <div className="flex items-center gap-2">
              <span className="text-gray-500">Map to:</span>
              <input
                type="text"
                list={`speakers-${speaker}`}
                value={mapping[speaker] || ''}
                onChange={(e) => handleMappingChange(speaker, e.target.value)}
                placeholder="Enter speaker name..."
                className="flex-1 px-3 py-2 border rounded-md focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
              />
              <datalist id={`speakers-${speaker}`}>
                {knownSpeakers.map(({ name }) => (
                  <option key={name} value={name} />
                ))}
              </datalist>
            </div>

            {/* Quick select buttons for common speakers */}
            {knownSpeakers.length > 0 && (
              <div className="mt-2 flex flex-wrap gap-1">
                {knownSpeakers.slice(0, 8).map(({ name }) => (
                  <button
                    key={name}
                    type="button"
                    onClick={() => handleMappingChange(speaker, name)}
                    className={`px-2 py-1 text-xs rounded ${
                      mapping[speaker] === name
                        ? 'bg-blue-600 text-white'
                        : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                    }`}
                  >
                    {name}
                  </button>
                ))}
              </div>
            )}
          </div>
        ))}
      </div>

      <div className="p-6 border-t bg-gray-50 flex justify-end gap-3">
        <button
          type="button"
          onClick={onCancel}
          className="px-4 py-2 text-gray-700 bg-white border rounded-md hover:bg-gray-50"
        >
          Cancel
        </button>
        <button
          type="button"
          onClick={handleSubmit}
          disabled={!allMapped}
          className={`px-4 py-2 rounded-md text-white ${
            allMapped
              ? 'bg-blue-600 hover:bg-blue-700'
              : 'bg-gray-400 cursor-not-allowed'
          }`}
        >
          Apply Mapping
        </button>
      </div>
    </div>
  );
}
