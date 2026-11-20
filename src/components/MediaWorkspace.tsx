import { useRef, useState } from 'react';
import type { ChangeEvent, DragEvent, RefObject } from 'react';
import { Mic, Square, Upload, Play, Trash2, Volume2, Loader2, RefreshCw } from 'lucide-react';
import type { InputSource, SampleTopic } from '../types';
import { formatSeconds } from '../utils/audio';
import { AudioMeterCanvas } from './AudioMeterCanvas';

const SAMPLE_TOPICS: SampleTopic[] = [
  {
    id: 'physics',
    title: 'Quantum Entanglement',
    subtitle: 'Physics lecture',
    suggestedDirective: 'Help me understand the meaning as if I am a 10 year old kid',
  },
  {
    id: 'biology',
    title: 'CRISPR Gene Editing',
    subtitle: 'Molecular biology',
    suggestedDirective: 'Help me understand the meaning as if I am a 10 year old kid',
  },
  {
    id: 'economics',
    title: 'Yield Curve Dynamics',
    subtitle: 'Macroeconomics brief',
    suggestedDirective: 'Extract the 4 sharpest takeaways in plain, practical language',
  },
];

interface MediaWorkspaceProps {
  source: InputSource;
  onSourceChange: (source: InputSource) => void;
  // Live microphone props
  isListening: boolean;
  isConnectingMic: boolean;
  elapsedSeconds: number;
  analyser: AnalyserNode | null;
  interimTranscript: string;
  onStartMic: () => void;
  onStopMic: () => void;
  onClearSession: () => void;
  // File upload & playback props
  selectedFile: File | null;
  mediaUrl: string | null;
  mediaRef: RefObject<HTMLVideoElement | HTMLAudioElement | null>;
  isProcessingFile: boolean;
  processingPhase: string;
  isGeneratingSample: string | null;
  onFileSelected: (file: File) => void;
  onClearFile: () => void;
  onStartFileTranscription: () => void;
  onCancelProcessing: () => void;
  onGenerateSample: (topicId: SampleTopic['id']) => void;
  onTimeUpdate: (currentTime: number) => void;
  hasTranscript: boolean;
}

export function MediaWorkspace({
  source,
  onSourceChange,
  isListening,
  isConnectingMic,
  elapsedSeconds,
  analyser,
  interimTranscript,
  onStartMic,
  onStopMic,
  onClearSession,
  selectedFile,
  mediaUrl,
  mediaRef,
  isProcessingFile,
  processingPhase,
  isGeneratingSample,
  onFileSelected,
  onClearFile,
  onStartFileTranscription,
  onCancelProcessing,
  onGenerateSample,
  onTimeUpdate,
  hasTranscript,
}: MediaWorkspaceProps) {
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [isDragging, setIsDragging] = useState(false);

  const handleFileChange = (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      onFileSelected(file);
    }
    e.target.value = '';
  };

  const handleDragOver = (e: DragEvent<HTMLElement>) => {
    if (source !== 'file') return;
    e.preventDefault();
    e.stopPropagation();
    if (!isDragging) setIsDragging(true);
  };

  const handleDragLeave = (e: DragEvent<HTMLElement>) => {
    if (source !== 'file') return;
    e.preventDefault();
    if (!e.currentTarget.contains(e.relatedTarget as Node | null)) {
      setIsDragging(false);
    }
  };

  const handleDrop = (e: DragEvent<HTMLElement>) => {
    if (source !== 'file') return;
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);
    const file = e.dataTransfer.files?.[0];
    if (file) {
      onFileSelected(file);
    }
  };

  const isVideo = selectedFile?.type.startsWith('video/') ?? false;
  const fileSizeMb = selectedFile ? (selectedFile.size / (1024 * 1024)).toFixed(2) : '0';

  return (
    <aside
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
      className={`bg-white border rounded-xl p-5 flex flex-col gap-5 h-full transition-colors ${
        isDragging ? 'border-blue-600 ring-2 ring-blue-600/15' : 'border-slate-200'
      }`}
    >
      {/* Segmented Source Selector */}
      <div className="flex items-center justify-between gap-3">
        <div
          role="tablist"
          aria-label="Audio or video input source"
          className="inline-flex items-center p-1 bg-slate-100 rounded-lg w-full"
        >
          <button
            type="button"
            role="tab"
            aria-selected={source === 'mic'}
            onClick={() => onSourceChange('mic')}
            disabled={isListening || isProcessingFile}
            className={`flex-1 inline-flex items-center justify-center gap-2 px-3 py-2 text-xs font-semibold rounded-md transition-colors whitespace-nowrap shrink-0 disabled:opacity-60 ${
              source === 'mic'
                ? 'bg-white text-slate-900 shadow-xs'
                : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            <Mic className="w-3.5 h-3.5" aria-hidden="true" />
            <span>Live Microphone</span>
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={source === 'file'}
            onClick={() => onSourceChange('file')}
            disabled={isListening || isProcessingFile}
            className={`flex-1 inline-flex items-center justify-center gap-2 px-3 py-2 text-xs font-semibold rounded-md transition-colors whitespace-nowrap shrink-0 disabled:opacity-60 ${
              source === 'file'
                ? 'bg-white text-slate-900 shadow-xs'
                : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            <Upload className="w-3.5 h-3.5" aria-hidden="true" />
            <span>Audio / Video File</span>
          </button>
        </div>
      </div>

      {source === 'mic' ? (
        <div className="flex flex-col gap-5 flex-1">
          {/* Live Audio Meter & Timer */}
          <div className="bg-slate-50 border border-slate-200 rounded-lg p-4 flex flex-col gap-3">
            <div className="flex items-center justify-between text-xs text-slate-600">
              <span className="font-medium text-slate-800">
                {isConnectingMic
                  ? 'Connecting live session...'
                  : isListening
                  ? 'Live speech capture active'
                  : 'Microphone ready'}
              </span>
              <span className="font-mono tabular-nums font-medium text-slate-700">
                {formatSeconds(elapsedSeconds)}
              </span>
            </div>

            <AudioMeterCanvas analyser={analyser} isActive={isListening} />

            <div className="flex items-center gap-2.5 pt-1">
              {!isListening ? (
                <button
                  type="button"
                  onClick={onStartMic}
                  disabled={isConnectingMic}
                  className="flex-1 inline-flex items-center justify-center gap-2 px-4 py-2.5 text-sm font-semibold text-white bg-blue-600 rounded-lg hover:bg-blue-700 disabled:bg-blue-400 transition-colors whitespace-nowrap shrink-0 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600"
                >
                  {isConnectingMic ? (
                    <Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" />
                  ) : (
                    <Mic className="w-4 h-4" aria-hidden="true" />
                  )}
                  <span>{isConnectingMic ? 'Connecting...' : 'Start Listening'}</span>
                </button>
              ) : (
                <button
                  type="button"
                  onClick={onStopMic}
                  className="flex-1 inline-flex items-center justify-center gap-2 px-4 py-2.5 text-sm font-semibold text-white bg-red-600 rounded-lg hover:bg-red-700 transition-colors whitespace-nowrap shrink-0 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-red-600"
                >
                  <Square className="w-3.5 h-3.5 fill-current" aria-hidden="true" />
                  <span>Stop Listening</span>
                </button>
              )}

              {hasTranscript && !isListening && (
                <button
                  type="button"
                  onClick={onClearSession}
                  className="px-3.5 py-2.5 text-xs font-medium text-slate-700 bg-white border border-slate-200 rounded-lg hover:bg-slate-50 transition-colors whitespace-nowrap shrink-0"
                >
                  Clear
                </button>
              )}
            </div>
          </div>

          {/* Interim Speech Preview */}
          <div className="border-t border-slate-200 pt-4 flex flex-col gap-2">
            <div className="flex items-center justify-between">
              <h3 className="text-xs font-semibold text-slate-700">Live Interim Buffer</h3>
              <span className="text-xs text-slate-500">16 kHz PCM stream</span>
            </div>
            <div className="min-h-[84px] p-3.5 rounded-lg bg-slate-50 border border-slate-200 text-sm text-slate-700 leading-relaxed">
              {interimTranscript ? (
                <span>{interimTranscript}</span>
              ) : isListening ? (
                <span className="text-slate-400">Speak naturally into your microphone...</span>
              ) : (
                <span className="text-slate-400">
                  Partial words appear here instantaneously as you speak, then commit into your
                  directive insights.
                </span>
              )}
            </div>
          </div>

          <div className="mt-auto border-t border-slate-200 pt-4 text-xs text-slate-500 leading-relaxed">
            Insights automatically refresh every few spoken sentences while keeping your active
            directive locked in.
          </div>
        </div>
      ) : (
        <div className="flex flex-col gap-5 flex-1">
          {/* File Dropzone or Active Media Player */}
          {!selectedFile || !mediaUrl ? (
            <div
              className={`border-2 border-dashed rounded-xl p-6 text-center transition-colors flex flex-col items-center justify-center gap-3 min-h-[210px] ${
                isDragging
                  ? 'border-blue-600 bg-blue-50/60'
                  : 'border-slate-300 bg-slate-50/70 hover:border-slate-400'
              }`}
            >
              <div className="w-10 h-10 rounded-full bg-white border border-slate-200 flex items-center justify-center text-slate-700">
                <Upload className="w-4 h-4" aria-hidden="true" />
              </div>
              <div className="flex flex-col gap-1">
                <p className="text-sm font-medium text-slate-900">
                  Drop an audio or video file here
                </p>
                <p className="text-xs text-slate-500">
                  MP4, WebM, MOV, MP3, WAV, or M4A up to 25 MB
                </p>
              </div>
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                className="px-4 py-2 text-xs font-semibold text-slate-900 bg-white border border-slate-300 rounded-lg hover:bg-slate-50 transition-colors whitespace-nowrap shrink-0"
              >
                Choose File
              </button>
              <input
                ref={fileInputRef}
                type="file"
                accept="audio/*,video/*,.mp4,.webm,.mov,.mkv,.mp3,.wav,.m4a,.ogg,.aac,.flac"
                onChange={handleFileChange}
                className="hidden"
              />
            </div>
          ) : (
            <div className="flex flex-col gap-3">
              {isVideo ? (
                <video
                  ref={mediaRef as RefObject<HTMLVideoElement | null>}
                  src={mediaUrl}
                  controls
                  onTimeUpdate={(e) => onTimeUpdate(e.currentTarget.currentTime)}
                  className="w-full rounded-lg bg-slate-950 aspect-video border border-slate-200"
                />
              ) : (
                <div className="bg-slate-50 border border-slate-200 rounded-lg p-4 flex flex-col gap-3">
                  <div className="flex items-center gap-2.5 text-slate-800">
                    <Volume2 className="w-4 h-4 text-blue-600 shrink-0" aria-hidden="true" />
                    <span className="text-sm font-medium truncate">{selectedFile.name}</span>
                  </div>
                  <audio
                    ref={mediaRef as RefObject<HTMLAudioElement | null>}
                    src={mediaUrl}
                    controls
                    onTimeUpdate={(e) => onTimeUpdate(e.currentTarget.currentTime)}
                    className="w-full"
                  />
                </div>
              )}

              {/* Clean unboxed file metadata */}
              <div className="flex items-center justify-between gap-2 text-xs text-slate-500">
                <div className="flex items-center gap-2 truncate">
                  <span className="truncate font-medium text-slate-700">{selectedFile.name}</span>
                  <span aria-hidden="true">·</span>
                  <span className="tabular-nums shrink-0">{fileSizeMb} MB</span>
                  <span aria-hidden="true">·</span>
                  <span className="shrink-0">{isVideo ? 'Video' : 'Audio'}</span>
                </div>
                <button
                  type="button"
                  onClick={onClearFile}
                  disabled={isProcessingFile}
                  className="inline-flex items-center gap-1 text-slate-500 hover:text-red-600 disabled:opacity-40 transition-colors shrink-0"
                >
                  <Trash2 className="w-3.5 h-3.5" aria-hidden="true" />
                  <span>Remove</span>
                </button>
              </div>

              {/* Primary Transcribe CTA */}
              <div className="flex items-center gap-2.5 pt-1">
                {!isProcessingFile ? (
                  <button
                    type="button"
                    onClick={onStartFileTranscription}
                    className="flex-1 inline-flex items-center justify-center gap-2 px-4 py-2.5 text-sm font-semibold text-white bg-blue-600 rounded-lg hover:bg-blue-700 transition-colors whitespace-nowrap shrink-0 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600"
                  >
                    {hasTranscript ? (
                      <RefreshCw className="w-4 h-4" aria-hidden="true" />
                    ) : (
                      <Play className="w-4 h-4 fill-current" aria-hidden="true" />
                    )}
                    <span>
                      {hasTranscript ? 'Re-run Transcription' : 'Transcribe & Interpret'}
                    </span>
                  </button>
                ) : (
                  <button
                    type="button"
                    onClick={onCancelProcessing}
                    className="flex-1 inline-flex items-center justify-center gap-2 px-4 py-2.5 text-sm font-semibold text-slate-900 bg-slate-100 border border-slate-300 rounded-lg hover:bg-slate-200 transition-colors whitespace-nowrap shrink-0"
                  >
                    <Loader2 className="w-4 h-4 animate-spin text-blue-600" aria-hidden="true" />
                    <span>{processingPhase || 'Processing...'} (Cancel)</span>
                  </button>
                )}
              </div>
            </div>
          )}

          {/* Real Spoken Sample Generator */}
          <div className="mt-auto border-t border-slate-200 pt-4 flex flex-col gap-2.5">
            <div className="flex items-baseline justify-between gap-2">
              <h3 className="text-xs font-semibold text-slate-800">
                Try a spoken lecture sample
              </h3>
              <span className="text-xs text-slate-500">Synthesized live</span>
            </div>
            <div className="flex flex-col gap-2">
              {SAMPLE_TOPICS.map((topic) => {
                const isLoadingThis = isGeneratingSample === topic.id;
                return (
                  <button
                    key={topic.id}
                    type="button"
                    disabled={isProcessingFile || isGeneratingSample !== null}
                    onClick={() => onGenerateSample(topic.id)}
                    className="w-full text-left px-3.5 py-2.5 rounded-lg border border-slate-200 bg-slate-50/70 hover:bg-white hover:border-slate-300 disabled:opacity-50 transition-colors flex items-center justify-between gap-3"
                  >
                    <div className="min-w-0">
                      <div className="text-xs font-semibold text-slate-900 truncate">
                        {topic.title}
                      </div>
                      <div className="text-xs text-slate-500 truncate">{topic.subtitle}</div>
                    </div>
                    <span className="text-xs font-medium text-blue-600 shrink-0 whitespace-nowrap">
                      {isLoadingThis ? 'Generating...' : 'Load & Run'}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>
        </div>
      )}
    </aside>
  );
}
