export interface DialogueEntry {
  name: string;
  timestamp: string;
  text: string;
}

export interface Transcript {
  episode_number: number;
  episode_name: string;
  dialogues: DialogueEntry[];
}

export interface TranscriptMetadata {
  filename: string;
  episode_number: number | string;
  episode_name: string;
  dialogueCount: number;
  hasAudio: boolean;
}

export interface TranscriptChunk {
  id: string;
  text: string;
  episodeTitle: string;
  speakers: string[];
  startTimestamp: string;
  endTimestamp: string;
}

export interface SearchResult {
  chunk: TranscriptChunk;
  score: number;
}

export interface SearchResponse {
  answer: string;
  sources: SearchResult[];
}
