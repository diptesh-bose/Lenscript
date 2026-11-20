export type InputSource = 'mic' | 'file';

export type OutputLayout = 'split' | 'insights' | 'transcript';

export interface AlignedSegment {
  id: string;
  timestamp: string;
  seconds: number;
  speech: string;
  meaning: string;
  isInterpreting?: boolean;
}

export interface DirectivePreset {
  id: string;
  label: string;
  instruction: string;
  description: string;
}

export interface SavedSession {
  id: string;
  title: string;
  source: InputSource;
  directive: string;
  segments?: AlignedSegment[];
  verbatimTranscript: string;
  insightMarkdown: string;
  durationSeconds: number;
  wordCount: number;
  createdAt: string;
}

export interface SampleTopic {
  id: 'physics' | 'biology' | 'economics';
  title: string;
  subtitle: string;
  suggestedDirective: string;
}
