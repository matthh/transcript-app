'use client';

import { Suspense, useState, useRef, useCallback, useEffect } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { upload } from '@vercel/blob/client';
import SpeakerMapper from '@/components/SpeakerMapper';
import type { Transcript, DialogueEntry } from '@/types/transcript';

type WorkflowStep = 'upload' | 'transcribing' | 'mapping' | 'preview' | 'saving';

function NewEpisodeContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Form state - initialize from URL params if available
  const [episodeNumber, setEpisodeNumber] = useState('');
  const [episodeName, setEpisodeName] = useState('');

  const [selectedFile, setSelectedFile] = useState<File | null>(null);

  // Workflow state
  const [step, setStep] = useState<WorkflowStep>('upload');
  const [error, setError] = useState<string | null>(null);
  const [jobId, setJobId] = useState<string | null>(null);
  const [transcriptionStatus, setTranscriptionStatus] = useState<string>('');
  const [rawTranscript, setRawTranscript] = useState<Transcript | null>(null);
  const [finalTranscript, setFinalTranscript] = useState<Transcript | null>(null);
  const [audioUrl, setAudioUrl] = useState<string | null>(null);

  // Progress tracking
  const [startTime, setStartTime] = useState<number | null>(null);
  const [elapsedTime, setElapsedTime] = useState<number>(0);
  const [uploadProgress, setUploadProgress] = useState<number>(0);
  const [audioDuration, setAudioDuration] = useState<number | null>(null);

  // Initialize from URL params on mount
  useEffect(() => {
    const epParam = searchParams.get('episode');
    const filmParam = searchParams.get('film');
    if (epParam) {
      setEpisodeNumber(epParam);
    }
    if (filmParam) {
      setEpisodeName(filmParam);
    }
  }, [searchParams]);

  // Track elapsed time during transcription
  useEffect(() => {
    if (step === 'transcribing' && startTime) {
      const interval = setInterval(() => {
        setElapsedTime(Math.floor((Date.now() - startTime) / 1000));
      }, 1000);
      return () => clearInterval(interval);
    }
  }, [step, startTime]);

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      setSelectedFile(file);
      setError(null);

      // Try to extract episode info from filename
      const match = file.name.match(/(\d+)/);
      if (match && !episodeNumber) {
        setEpisodeNumber(match[1]);
      }
      if (!episodeName) {
        const nameFromFile = file.name
          .replace(/\.[^/.]+$/, '')
          .replace(/[-_]/g, ' ')
          .replace(/\s+/g, ' ')
          .trim();
        setEpisodeName(nameFromFile);
      }
    }
  };

  const startTranscription = async () => {
    if (!selectedFile || !episodeNumber || !episodeName) {
      setError('Please fill in all fields and select a file');
      return;
    }

    setStep('transcribing');
    setError(null);
    setStartTime(Date.now());
    setElapsedTime(0);
    setUploadProgress(0);
    setAudioDuration(null);
    setTranscriptionStatus('Uploading audio to storage...');

    try {
      // Step 1: Upload file directly to Vercel Blob (bypasses serverless size limit)
      let blob;
      try {
        const timestamp = Date.now();
        blob = await upload(`audio/episode_${episodeNumber}_${timestamp}.mp3`, selectedFile, {
          access: 'public',
          handleUploadUrl: '/api/blob-upload',
          onUploadProgress: (progress) => {
            const pct = Math.round((progress.loaded / progress.total) * 100);
            setUploadProgress(pct);
            setTranscriptionStatus(`Uploading audio... ${pct}%`);
          },
        });
        setUploadProgress(100);
        setAudioUrl(blob.url); // Store audio URL for speaker mapping
      } catch (uploadErr) {
        throw new Error(`Upload failed: ${uploadErr instanceof Error ? uploadErr.message : 'Unknown error'}`);
      }

      setTranscriptionStatus('Starting transcription...');

      // Step 2: Start transcription with the blob URL
      const response = await fetch('/api/transcribe', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          audioUrl: blob.url,
          episodeNumber,
          episodeName,
        }),
      });

      if (!response.ok) {
        // Try to parse as JSON, fall back to text
        const contentType = response.headers.get('content-type');
        if (contentType?.includes('application/json')) {
          const data = await response.json();
          throw new Error(data.error || 'Failed to start transcription');
        } else {
          const text = await response.text();
          throw new Error(`Transcription failed: ${text.slice(0, 100)}`);
        }
      }

      const { jobId: newJobId } = await response.json();
      setJobId(newJobId);
      setTranscriptionStatus('Transcription started...');

      // Start polling for status
      pollTranscriptionStatus(newJobId);
    } catch (err) {
      console.error('Transcription error:', err);
      setError(err instanceof Error ? err.message : 'Failed to start transcription');
      setStep('upload');
    }
  };

  const pollTranscriptionStatus = useCallback(async (id: string) => {
    const poll = async () => {
      try {
        const response = await fetch(`/api/transcribe/status/${id}`);
        const data = await response.json();

        if (data.status === 'completed' && data.transcript) {
          setRawTranscript(data.transcript);
          setStep('mapping');
          return;
        }

        if (data.status === 'failed') {
          setError(data.error || 'Transcription failed');
          setStep('upload');
          return;
        }

        // Still processing - update status with more detail
        if (data.audioDuration) {
          setAudioDuration(data.audioDuration);
        }

        let statusMessage = 'Transcribing...';
        if (data.assemblyAiStatus === 'queued') {
          statusMessage = 'Waiting in queue...';
        } else if (data.assemblyAiStatus === 'processing') {
          statusMessage = 'Processing audio...';
        }
        setTranscriptionStatus(statusMessage);

        // Poll again in 5 seconds
        setTimeout(poll, 5000);
      } catch {
        // Retry on network error
        setTimeout(poll, 5000);
      }
    };

    poll();
  }, []);

  const handleMappingComplete = (mappedDialogues: DialogueEntry[]) => {
    if (!rawTranscript) return;

    const mapped: Transcript = {
      ...rawTranscript,
      dialogues: mappedDialogues,
    };

    setFinalTranscript(mapped);
    setStep('preview');
  };

  const handleMappingCancel = () => {
    // Use raw transcript without mapping (skip button)
    if (rawTranscript) {
      setFinalTranscript(rawTranscript);
      setStep('preview');
    }
  };

  const saveTranscript = async () => {
    if (!finalTranscript) return;

    setStep('saving');
    setError(null);

    try {
      const response = await fetch(`/api/transcripts/${finalTranscript.episode_number}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(finalTranscript),
      });

      if (!response.ok) {
        throw new Error('Failed to save transcript');
      }

      // Verify the save worked by fetching it back (handles blob storage eventual consistency)
      let verified = false;
      for (let attempt = 0; attempt < 5; attempt++) {
        await new Promise(resolve => setTimeout(resolve, 500)); // Wait 500ms between attempts
        const verifyResponse = await fetch(`/api/transcripts/episode_${finalTranscript.episode_number}`);
        if (verifyResponse.ok) {
          verified = true;
          break;
        }
      }

      if (!verified) {
        console.warn('Could not verify transcript save, redirecting anyway');
      }

      // Redirect to the review page for this episode
      router.push(`/review/episode_${finalTranscript.episode_number}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save transcript');
      setStep('preview');
    }
  };

  return (
    <>
      <div className="mb-6">
        <Link href="/review" className="text-blue-600 hover:underline text-sm">
          Back to Review List
        </Link>
        <h1 className="text-2xl font-bold mt-1">Add New Episode</h1>
      </div>

      {error && (
        <div className="mb-6 p-4 bg-red-50 border border-red-200 text-red-700 rounded">
          {error}
        </div>
      )}

      {/* Step 1: Upload */}
      {step === 'upload' && (
        <div className="bg-white rounded-lg shadow p-6 space-y-6">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Episode Number
            </label>
            <input
              type="number"
              value={episodeNumber}
              onChange={(e) => setEpisodeNumber(e.target.value)}
              className="w-full px-3 py-2 border rounded-md focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
              placeholder="e.g., 305"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Episode Name
            </label>
            <input
              type="text"
              value={episodeName}
              onChange={(e) => setEpisodeName(e.target.value)}
              className="w-full px-3 py-2 border rounded-md focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
              placeholder="e.g., The Godfather Part II"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              MP3 File
            </label>
            <input
              ref={fileInputRef}
              type="file"
              accept="audio/mp3,audio/mpeg"
              onChange={handleFileSelect}
              className="hidden"
            />
            <div
              onClick={() => fileInputRef.current?.click()}
              className="border-2 border-dashed border-gray-300 rounded-lg p-8 text-center cursor-pointer hover:border-gray-400 transition-colors"
            >
              {selectedFile ? (
                <div>
                  <p className="font-medium text-gray-900">{selectedFile.name}</p>
                  <p className="text-sm text-gray-500 mt-1">
                    {(selectedFile.size / (1024 * 1024)).toFixed(2)} MB
                  </p>
                  <p className="text-sm text-blue-600 mt-2">Click to change file</p>
                </div>
              ) : (
                <div>
                  <p className="text-gray-500">Click to select an MP3 file</p>
                  <p className="text-sm text-gray-400 mt-1">or drag and drop</p>
                </div>
              )}
            </div>
          </div>

          <button
            onClick={startTranscription}
            disabled={!selectedFile || !episodeNumber || !episodeName}
            className={`w-full py-3 rounded-md font-medium transition-colors ${
              selectedFile && episodeNumber && episodeName
                ? 'bg-blue-600 text-white hover:bg-blue-700'
                : 'bg-gray-200 text-gray-500 cursor-not-allowed'
            }`}
          >
            Start Transcription
          </button>
        </div>
      )}

      {/* Step 2: Transcribing */}
      {step === 'transcribing' && (
        <div className="bg-white rounded-lg shadow p-8">
          {/* Progress Steps */}
          <div className="flex items-center justify-center mb-8">
            <div className="flex items-center">
              <div className={`flex items-center justify-center w-8 h-8 rounded-full ${
                uploadProgress >= 100 ? 'bg-green-500' : 'bg-blue-600'
              } text-white text-sm font-medium`}>
                {uploadProgress >= 100 ? '✓' : '1'}
              </div>
              <span className="ml-2 text-sm font-medium text-gray-900">Upload</span>
            </div>
            <div className={`w-12 h-0.5 mx-2 ${uploadProgress >= 100 ? 'bg-green-500' : 'bg-gray-300'}`}></div>
            <div className="flex items-center">
              <div className={`flex items-center justify-center w-8 h-8 rounded-full ${
                uploadProgress >= 100
                  ? transcriptionStatus.includes('Processing') || transcriptionStatus.includes('Transcribing')
                    ? 'bg-blue-600'
                    : 'bg-gray-300'
                  : 'bg-gray-300'
              } text-white text-sm font-medium`}>
                2
              </div>
              <span className="ml-2 text-sm font-medium text-gray-600">Transcribe</span>
            </div>
            <div className="w-12 h-0.5 mx-2 bg-gray-300"></div>
            <div className="flex items-center">
              <div className="flex items-center justify-center w-8 h-8 rounded-full bg-gray-300 text-white text-sm font-medium">
                3
              </div>
              <span className="ml-2 text-sm font-medium text-gray-600">Map Speakers</span>
            </div>
          </div>

          {/* Spinner and Status */}
          <div className="text-center">
            <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mx-auto mb-4"></div>
            <h2 className="text-xl font-semibold text-gray-900">
              {transcriptionStatus.includes('Uploading') ? 'Uploading Audio' : 'Transcribing Audio'}
            </h2>
            <p className="text-gray-600 mt-2">{transcriptionStatus}</p>
          </div>

          {/* Progress Info Cards */}
          <div className="grid grid-cols-2 gap-4 mt-6">
            <div className="bg-gray-50 rounded-lg p-4">
              <p className="text-xs text-gray-500 uppercase tracking-wide">Elapsed Time</p>
              <p className="text-2xl font-semibold text-gray-900 mt-1">
                {Math.floor(elapsedTime / 60)}:{(elapsedTime % 60).toString().padStart(2, '0')}
              </p>
            </div>
            <div className="bg-gray-50 rounded-lg p-4">
              <p className="text-xs text-gray-500 uppercase tracking-wide">Audio Duration</p>
              <p className="text-2xl font-semibold text-gray-900 mt-1">
                {audioDuration
                  ? `${Math.floor(audioDuration / 60)}:${Math.floor(audioDuration % 60).toString().padStart(2, '0')}`
                  : '—'}
              </p>
            </div>
          </div>

          {/* File Info */}
          {selectedFile && (
            <div className="mt-4 p-3 bg-blue-50 rounded-lg">
              <div className="flex items-center justify-between text-sm">
                <span className="text-blue-800 font-medium">{selectedFile.name}</span>
                <span className="text-blue-600">{(selectedFile.size / (1024 * 1024)).toFixed(1)} MB</span>
              </div>
            </div>
          )}

          {/* Job ID */}
          {jobId && (
            <p className="text-xs text-gray-400 mt-4 text-center">Job ID: {jobId}</p>
          )}
        </div>
      )}

      {/* Step 3: Speaker Mapping */}
      {step === 'mapping' && rawTranscript && (
        <SpeakerMapper
          dialogues={rawTranscript.dialogues}
          audioUrl={audioUrl}
          onMappingComplete={handleMappingComplete}
          onCancel={handleMappingCancel}
        />
      )}

      {/* Step 4: Preview */}
      {step === 'preview' && finalTranscript && (
        <div className="bg-white rounded-lg shadow">
          <div className="p-6 border-b">
            <h2 className="text-xl font-semibold text-gray-900">Preview Transcript</h2>
            <p className="mt-1 text-sm text-gray-600">
              Episode {finalTranscript.episode_number}: {finalTranscript.episode_name}
            </p>
          </div>

          <div className="p-6 max-h-96 overflow-y-auto">
            {finalTranscript.dialogues.slice(0, 20).map((dialogue, idx) => (
              <div key={idx} className="mb-3 pb-3 border-b last:border-0">
                <div className="flex items-center gap-2 mb-1">
                  <span className="font-medium text-gray-900">{dialogue.name}</span>
                  <span className="text-xs text-gray-500">{dialogue.timestamp}</span>
                </div>
                <p className="text-gray-700">{dialogue.text}</p>
              </div>
            ))}
            {finalTranscript.dialogues.length > 20 && (
              <p className="text-gray-500 text-center py-2">
                ... and {finalTranscript.dialogues.length - 20} more segments
              </p>
            )}
          </div>

          <div className="p-6 border-t bg-gray-50 flex justify-between">
            <button
              onClick={() => setStep('mapping')}
              className="px-4 py-2 text-gray-700 bg-white border rounded-md hover:bg-gray-50"
            >
              Re-map Speakers
            </button>
            <button
              onClick={saveTranscript}
              className="px-6 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700"
            >
              Save & Continue to Editor
            </button>
          </div>
        </div>
      )}

      {/* Step 5: Saving */}
      {step === 'saving' && (
        <div className="bg-white rounded-lg shadow p-8 text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mx-auto mb-4"></div>
          <h2 className="text-xl font-semibold text-gray-900">Saving Transcript</h2>
          <p className="text-gray-600 mt-2">Please wait...</p>
        </div>
      )}
    </>
  );
}

function LoadingFallback() {
  return (
    <>
      <div className="mb-6">
        <div className="h-4 w-24 bg-gray-200 rounded animate-pulse"></div>
        <div className="h-8 w-48 bg-gray-200 rounded animate-pulse mt-2"></div>
      </div>
      <div className="bg-white rounded-lg shadow p-6">
        <div className="space-y-4">
          <div className="h-10 bg-gray-200 rounded animate-pulse"></div>
          <div className="h-10 bg-gray-200 rounded animate-pulse"></div>
          <div className="h-32 bg-gray-200 rounded animate-pulse"></div>
        </div>
      </div>
    </>
  );
}

export default function NewEpisodePage() {
  return (
    <main className="min-h-screen p-8">
      <div className="max-w-3xl mx-auto">
        <Suspense fallback={<LoadingFallback />}>
          <NewEpisodeContent />
        </Suspense>
      </div>
    </main>
  );
}
