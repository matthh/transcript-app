'use client';

import { useEffect, useState, useCallback, useMemo } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import { Transcript, DialogueEntry } from '@/types/transcript';
import { useAudioSync } from '@/hooks/useAudioSync';
import { useUndoRedo } from '@/hooks/useUndoRedo';
import AudioPlayer from '@/components/AudioPlayer';
import TranscriptEditor from '@/components/TranscriptEditor';
import SpeakerMapper from '@/components/SpeakerMapper';

export default function EditorPage() {
  const { episode } = useParams<{ episode: string }>();
  const router = useRouter();
  const [transcriptMeta, setTranscriptMeta] = useState<Omit<Transcript, 'dialogues'> | null>(null);
  const {
    state: dialogues,
    set: setDialogues,
    undo,
    redo,
    reset: resetDialogues,
    canUndo,
    canRedo,
  } = useUndoRedo<DialogueEntry[]>([]);
  const [hasUnsavedChanges, setHasUnsavedChanges] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [publishing, setPublishing] = useState(false);
  const [publishStatus, setPublishStatus] = useState<'idle' | 'success' | 'error'>('idle');
  const [error, setError] = useState<string | null>(null);
  const [hasAudio, setHasAudio] = useState(false);
  const [audioUrl, setAudioUrl] = useState<string | null>(null);
  const [rebuildConfigured, setRebuildConfigured] = useState(false);
  const [resetting, setResetting] = useState(false);
  const [mappingMode, setMappingMode] = useState(false);
  const [guestName, setGuestName] = useState<string | null>(null);

  const { state: audioState, controls: audioControls, setAudioRef } = useAudioSync(dialogues);

  // Check if there are unmapped speakers (placeholder labels like "Speaker A", "Speaker B", etc.)
  const unmappedSpeakerCount = useMemo(() => {
    const placeholderPattern = /^(Speaker\s*)?[A-Z]$/i;
    return dialogues.filter(d => placeholderPattern.test(d.name)).length;
  }, [dialogues]);

  const hasUnmappedSpeakers = unmappedSpeakerCount > 0;

  // Handle mapping complete - update dialogues and exit mapping mode
  const handleMappingComplete = useCallback((mappedDialogues: DialogueEntry[]) => {
    setDialogues(() => mappedDialogues);
    setHasUnsavedChanges(true);
    setMappingMode(false);
  }, [setDialogues]);

  // Handle mapping cancel - just exit mapping mode
  const handleMappingCancel = useCallback(() => {
    setMappingMode(false);
  }, []);

  useEffect(() => {
    async function fetchTranscript() {
      try {
        const response = await fetch(`/api/transcripts/${episode}`);
        if (!response.ok) throw new Error('Failed to fetch transcript');
        const data: Transcript = await response.json();
        const { dialogues: loadedDialogues, ...meta } = data;
        setTranscriptMeta(meta);
        resetDialogues(loadedDialogues);

        // Check if audio exists
        const audioResponse = await fetch(`/api/audio/${episode}`, {
          method: 'HEAD',
        });
        if (audioResponse.ok) {
          setHasAudio(true);
          setAudioUrl(`/api/audio/${episode}`);
        }

        // Check if rebuild is configured
        const rebuildResponse = await fetch('/api/rebuild');
        if (rebuildResponse.ok) {
          const rebuildData = await rebuildResponse.json();
          setRebuildConfigured(rebuildData.configured);
        }

        // Fetch guest name for speaker shortcuts
        try {
          const coverageResponse = await fetch('/api/coverage');
          if (coverageResponse.ok) {
            const coverageData = await coverageResponse.json();
            const episodeNum = data.episode_number;
            const epInfo = coverageData.episodes?.find((ep: { episode: number }) => ep.episode === episodeNum);
            if (epInfo?.guest) {
              setGuestName(epInfo.guest);
            }
          }
        } catch {
          // Failed to fetch guest, continue without it
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Unknown error');
      } finally {
        setLoading(false);
      }
    }
    fetchTranscript();
  }, [episode]);

  const handleSpeakerChange = useCallback((index: number, speaker: string) => {
    setDialogues((prev) => {
      const newDialogues = [...prev];
      newDialogues[index] = { ...newDialogues[index], name: speaker };
      return newDialogues;
    });
    setHasUnsavedChanges(true);
  }, [setDialogues]);

  const handleTextChange = useCallback((index: number, text: string) => {
    setDialogues((prev) => {
      const newDialogues = [...prev];
      newDialogues[index] = { ...newDialogues[index], text };
      return newDialogues;
    });
    setHasUnsavedChanges(true);
  }, [setDialogues]);

  const handleBulkSpeakerChange = useCallback((indices: number[], speaker: string) => {
    setDialogues((prev) => {
      const newDialogues = [...prev];
      indices.forEach(index => {
        newDialogues[index] = { ...newDialogues[index], name: speaker };
      });
      return newDialogues;
    });
    setHasUnsavedChanges(true);
  }, [setDialogues]);

  const handleUndo = useCallback(() => {
    undo();
    setHasUnsavedChanges(true);
  }, [undo]);

  const handleRedo = useCallback(() => {
    redo();
    setHasUnsavedChanges(true);
  }, [redo]);

  const handleSave = async () => {
    if (!transcriptMeta) return;
    setSaving(true);
    try {
      const transcript: Transcript = { ...transcriptMeta, dialogues };
      const response = await fetch(`/api/transcripts/${episode}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(transcript),
      });
      if (!response.ok) throw new Error('Failed to save');
      setHasUnsavedChanges(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save');
    } finally {
      setSaving(false);
    }
  };

  const handlePublish = async () => {
    if (hasUnsavedChanges) {
      setError('Please save your changes before publishing');
      return;
    }
    setPublishing(true);
    setPublishStatus('idle');
    try {
      const response = await fetch('/api/rebuild', {
        method: 'POST',
      });
      if (!response.ok) throw new Error('Failed to trigger rebuild');
      setPublishStatus('success');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to publish');
      setPublishStatus('error');
    } finally {
      setPublishing(false);
    }
  };

  const handleReset = async () => {
    const confirmed = window.confirm(
      `Reset Episode ${transcriptMeta?.episode_number}?\n\nThis will delete the transcript and return you to the review list. You'll need to re-transcribe this episode.`
    );
    if (!confirmed) return;

    setResetting(true);
    try {
      const response = await fetch(`/api/transcripts/${episode}`, {
        method: 'DELETE',
      });
      if (!response.ok) throw new Error('Failed to reset episode');
      router.push('/review');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to reset');
      setResetting(false);
    }
  };

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 's') {
        e.preventDefault();
        if (hasUnsavedChanges && !saving) {
          handleSave();
        }
      }
      if (e.key === ' ' && e.target === document.body) {
        e.preventDefault();
        audioControls.toggle();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [hasUnsavedChanges, saving, audioControls]);

  if (loading) {
    return (
      <main className="min-h-screen p-8 flex justify-center items-center">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-gray-900"></div>
      </main>
    );
  }

  if (error || !transcriptMeta) {
    return (
      <main className="min-h-screen p-8">
        <div className="max-w-4xl mx-auto">
          <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded">
            {error || 'Transcript not found'}
          </div>
          <div className="mt-4 flex items-center gap-4">
            <Link href="/review" className="text-blue-600 hover:underline">
              Back to Review List
            </Link>
            <button
              onClick={handleReset}
              disabled={resetting}
              className="px-3 py-1.5 text-sm text-red-600 hover:text-red-700 hover:bg-red-50 border border-red-200 rounded transition-colors disabled:opacity-50"
            >
              {resetting ? 'Resetting...' : 'Reset Episode'}
            </button>
          </div>
        </div>
      </main>
    );
  }

  return (
    <main className="min-h-screen pb-24">
      <div className="max-w-4xl mx-auto p-8">
        <div className="flex items-center justify-between mb-6">
          <div>
            <Link href="/review" className="text-blue-600 hover:underline text-sm">
              Back to Review List
            </Link>
            <h1 className="text-2xl font-bold mt-1">{transcriptMeta.episode_name}</h1>
            <p className="text-sm text-gray-500">Episode {transcriptMeta.episode_number}</p>
          </div>
          <button
            onClick={handleReset}
            disabled={resetting}
            className="px-3 py-1.5 text-sm text-red-600 hover:text-red-700 hover:bg-red-50 border border-red-200 rounded transition-colors disabled:opacity-50"
            title="Delete transcript and return to review list"
          >
            {resetting ? 'Resetting...' : 'Reset Episode'}
          </button>
        </div>

        {hasAudio && !mappingMode && (
          <div className="mb-6">
            <AudioPlayer
              audioSrc={`/api/audio/${episode}`}
              state={audioState}
              controls={audioControls}
              setAudioRef={setAudioRef}
            />
          </div>
        )}

        {!hasAudio && (
          <div className="mb-6 p-4 bg-yellow-50 border border-yellow-200 text-yellow-800 rounded">
            No audio file available for this episode.
          </div>
        )}

        {/* Show Re-map Speakers button when there are unmapped speakers and not in mapping mode */}
        {hasUnmappedSpeakers && !mappingMode && (
          <div className="mb-6 p-4 bg-orange-50 border border-orange-200 rounded flex items-center justify-between">
            <div>
              <span className="text-orange-800 font-medium">
                {unmappedSpeakerCount} segment{unmappedSpeakerCount > 1 ? 's' : ''} with unmapped speakers
              </span>
              <p className="text-sm text-orange-600 mt-1">
                Use the Speaker Mapper for easier bulk assignment
              </p>
            </div>
            <button
              onClick={() => setMappingMode(true)}
              className="px-4 py-2 bg-orange-600 text-white rounded hover:bg-orange-700 transition-colors"
            >
              Re-map Speakers
            </button>
          </div>
        )}

        {/* Show SpeakerMapper when in mapping mode, otherwise show TranscriptEditor */}
        {mappingMode ? (
          <SpeakerMapper
            dialogues={dialogues}
            audioUrl={audioUrl}
            onMappingComplete={handleMappingComplete}
            onCancel={handleMappingCancel}
            guestName={guestName}
          />
        ) : (
          <TranscriptEditor
            dialogues={dialogues}
            activeSegmentIndex={audioState.activeSegmentIndex}
            onTimestampClick={audioControls.seekToTimestamp}
            onSpeakerChange={handleSpeakerChange}
            onTextChange={handleTextChange}
            onBulkSpeakerChange={handleBulkSpeakerChange}
            onUndo={handleUndo}
            onRedo={handleRedo}
            canUndo={canUndo}
            canRedo={canRedo}
          />
        )}
      </div>

      {!mappingMode && (
        <div className="fixed bottom-0 left-0 right-0 bg-white border-t p-4 shadow-lg">
          <div className="max-w-4xl mx-auto flex items-center justify-between">
            <span className="text-sm text-gray-600">
              {hasUnsavedChanges ? (
                <span className="text-orange-600 font-medium">Unsaved changes</span>
              ) : publishStatus === 'success' ? (
                <span className="text-green-600 font-medium">Rebuild triggered! Changes will be searchable after deploy.</span>
              ) : (
                'All changes saved'
              )}
            </span>
            <div className="flex items-center gap-3">
              {rebuildConfigured && (
                <button
                  onClick={handlePublish}
                  disabled={hasUnsavedChanges || publishing}
                  className={`px-4 py-2 rounded font-medium transition-colors ${
                    !hasUnsavedChanges && !publishing
                      ? 'bg-green-600 text-white hover:bg-green-700'
                      : 'bg-gray-200 text-gray-500 cursor-not-allowed'
                  }`}
                >
                  {publishing ? 'Publishing...' : 'Publish to Search'}
                </button>
              )}
              <button
                onClick={handleSave}
                disabled={!hasUnsavedChanges || saving}
                className={`px-6 py-2 rounded font-medium transition-colors ${
                  hasUnsavedChanges && !saving
                    ? 'bg-blue-600 text-white hover:bg-blue-700'
                    : 'bg-gray-200 text-gray-500 cursor-not-allowed'
                }`}
              >
                {saving ? 'Saving...' : 'Save (Ctrl+S)'}
              </button>
            </div>
          </div>
        </div>
      )}
    </main>
  );
}
