'use client';

import { useRef, useState, useCallback, useEffect } from 'react';
import { DialogueEntry } from '@/types/transcript';
import { timestampToSeconds } from '@/lib/timestamps';

export interface AudioSyncState {
  currentTime: number;
  duration: number;
  isPlaying: boolean;
  activeSegmentIndex: number;
}

export interface AudioSyncControls {
  play: () => Promise<void>;
  pause: () => void;
  toggle: () => void;
  seekTo: (time: number) => void;
  seekToTimestamp: (timestamp: string) => void;
}

export function useAudioSync(dialogues: DialogueEntry[]) {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [state, setState] = useState<AudioSyncState>({
    currentTime: 0,
    duration: 0,
    isPlaying: false,
    activeSegmentIndex: -1,
  });

  const findActiveSegment = useCallback(
    (time: number): number => {
      if (!dialogues.length) return -1;

      for (let i = dialogues.length - 1; i >= 0; i--) {
        const segmentTime = timestampToSeconds(dialogues[i].timestamp);
        if (time >= segmentTime) {
          return i;
        }
      }
      return 0;
    },
    [dialogues]
  );

  const handleTimeUpdate = useCallback(() => {
    if (!audioRef.current) return;
    const currentTime = audioRef.current.currentTime;
    const activeSegmentIndex = findActiveSegment(currentTime);
    setState((prev) => ({
      ...prev,
      currentTime,
      activeSegmentIndex,
    }));
  }, [findActiveSegment]);

  const handleLoadedMetadata = useCallback(() => {
    if (!audioRef.current) return;
    setState((prev) => ({
      ...prev,
      duration: audioRef.current!.duration,
    }));
  }, []);

  const handlePlay = useCallback(() => {
    setState((prev) => ({ ...prev, isPlaying: true }));
  }, []);

  const handlePause = useCallback(() => {
    setState((prev) => ({ ...prev, isPlaying: false }));
  }, []);

  const setAudioRef = useCallback(
    (element: HTMLAudioElement | null) => {
      if (audioRef.current) {
        audioRef.current.removeEventListener('timeupdate', handleTimeUpdate);
        audioRef.current.removeEventListener('loadedmetadata', handleLoadedMetadata);
        audioRef.current.removeEventListener('play', handlePlay);
        audioRef.current.removeEventListener('pause', handlePause);
      }

      audioRef.current = element;

      if (element) {
        element.addEventListener('timeupdate', handleTimeUpdate);
        element.addEventListener('loadedmetadata', handleLoadedMetadata);
        element.addEventListener('play', handlePlay);
        element.addEventListener('pause', handlePause);
      }
    },
    [handleTimeUpdate, handleLoadedMetadata, handlePlay, handlePause]
  );

  useEffect(() => {
    return () => {
      if (audioRef.current) {
        audioRef.current.removeEventListener('timeupdate', handleTimeUpdate);
        audioRef.current.removeEventListener('loadedmetadata', handleLoadedMetadata);
        audioRef.current.removeEventListener('play', handlePlay);
        audioRef.current.removeEventListener('pause', handlePause);
      }
    };
  }, [handleTimeUpdate, handleLoadedMetadata, handlePlay, handlePause]);

  const controls: AudioSyncControls = {
    play: () => audioRef.current?.play() ?? Promise.resolve(),
    pause: () => audioRef.current?.pause(),
    toggle: () => {
      if (audioRef.current?.paused) {
        audioRef.current.play();
      } else {
        audioRef.current?.pause();
      }
    },
    seekTo: (time: number) => {
      if (audioRef.current) {
        audioRef.current.currentTime = time;
      }
    },
    seekToTimestamp: (timestamp: string) => {
      if (audioRef.current) {
        audioRef.current.currentTime = timestampToSeconds(timestamp);
      }
    },
  };

  return { state, controls, setAudioRef, audioRef };
}
