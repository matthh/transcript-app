'use client';

import { secondsToTimestamp } from '@/lib/timestamps';
import { AudioSyncState, AudioSyncControls } from '@/hooks/useAudioSync';

interface AudioPlayerProps {
  audioSrc: string;
  state: AudioSyncState;
  controls: AudioSyncControls;
  setAudioRef: (element: HTMLAudioElement | null) => void;
}

export default function AudioPlayer({
  audioSrc,
  state,
  controls,
  setAudioRef,
}: AudioPlayerProps) {
  const progressPercent = state.duration > 0
    ? (state.currentTime / state.duration) * 100
    : 0;

  const handleProgressClick = (e: React.MouseEvent<HTMLDivElement>) => {
    if (state.duration === 0) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const percent = (e.clientX - rect.left) / rect.width;
    controls.seekTo(percent * state.duration);
  };

  return (
    <div className="bg-gray-100 p-4 rounded-lg sticky top-0 z-10">
      <audio ref={setAudioRef} src={audioSrc} preload="metadata" />

      <div className="flex items-center gap-4">
        <button
          onClick={controls.toggle}
          className="w-12 h-12 flex items-center justify-center bg-blue-600 text-white rounded-full hover:bg-blue-700 transition-colors"
        >
          {state.isPlaying ? (
            <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 24 24">
              <rect x="6" y="4" width="4" height="16" />
              <rect x="14" y="4" width="4" height="16" />
            </svg>
          ) : (
            <svg className="w-5 h-5 ml-1" fill="currentColor" viewBox="0 0 24 24">
              <polygon points="5,3 19,12 5,21" />
            </svg>
          )}
        </button>

        <div className="flex-1">
          <div
            className="h-2 bg-gray-300 rounded-full cursor-pointer"
            onClick={handleProgressClick}
          >
            <div
              className="h-full bg-blue-600 rounded-full transition-all"
              style={{ width: `${progressPercent}%` }}
            />
          </div>
        </div>

        <div className="text-sm text-gray-600 font-mono min-w-[100px] text-right">
          {secondsToTimestamp(state.currentTime)} / {secondsToTimestamp(state.duration)}
        </div>
      </div>
    </div>
  );
}
