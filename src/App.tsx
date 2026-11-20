import { useCallback, useEffect, useRef, useState } from 'react';
import { AlertCircle, X } from 'lucide-react';
import { TopBar } from './components/TopBar';
import type { ActiveTab } from './components/TopBar';
import { DirectiveBar } from './components/DirectiveBar';
import { MediaWorkspace } from './components/MediaWorkspace';
import { OutputWorkspace } from './components/OutputWorkspace';
import { SessionsView } from './components/SessionsView';
import { DirectiveGuideView } from './components/DirectiveGuideView';
import type {
  AlignedSegment,
  InputSource,
  OutputLayout,
  SampleTopic,
  SavedSession,
} from './types';
import {
  applyAlignedMeanings,
  base64ToFile,
  float32ToInt16Base64,
  formatSeconds,
  parseAlignedStream,
  parseTimestampToSeconds,
  segmentsToMarkdown,
  segmentsToMeaningText,
  segmentsToTranscriptText,
} from './utils/audio';

const STORAGE_KEY = 'lenscript_saved_sessions_v1';
const DEFAULT_DIRECTIVE = 'Help me understand the meaning as if I am a 10 year old kid';

function loadSavedSessions(): SavedSession[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export default function App() {
  const [activeTab, setActiveTab] = useState<ActiveTab>('studio');
  const [source, setSource] = useState<InputSource>('file');
  const [outputLayout, setOutputLayout] = useState<OutputLayout>('split');

  const [directive, setDirective] = useState<string>(DEFAULT_DIRECTIVE);
  const [segments, setSegments] = useState<AlignedSegment[]>([]);
  const [interimTranscript, setInterimTranscript] = useState<string>('');

  const [isTranscribing, setIsTranscribing] = useState<boolean>(false);
  const [isInterpreting, setIsInterpreting] = useState<boolean>(false);
  const [processingPhase, setProcessingPhase] = useState<string>('');
  const [errorBanner, setErrorBanner] = useState<string | null>(null);

  // Live microphone state
  const [isListening, setIsListening] = useState<boolean>(false);
  const [isConnectingMic, setIsConnectingMic] = useState<boolean>(false);
  const [elapsedSeconds, setElapsedSeconds] = useState<number>(0);
  const [analyser, setAnalyser] = useState<AnalyserNode | null>(null);

  // File & media playback state
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [mediaUrl, setMediaUrl] = useState<string | null>(null);
  const [currentMediaTime, setCurrentMediaTime] = useState<number>(0);
  const [isGeneratingSample, setIsGeneratingSample] = useState<string | null>(null);

  // Saved sessions
  const [savedSessions, setSavedSessions] = useState<SavedSession[]>(loadSavedSessions);
  const [sessionSavedNotice, setSessionSavedNotice] = useState<boolean>(false);

  // Refs for callbacks and stream cancellation
  const mediaRef = useRef<HTMLVideoElement | HTMLAudioElement | null>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const micStreamRef = useRef<MediaStream | null>(null);
  const processorRef = useRef<ScriptProcessorNode | null>(null);
  const timerRef = useRef<number | null>(null);
  const elapsedRef = useRef<number>(0);
  const directiveRef = useRef<string>(directive);
  const segmentsRef = useRef<AlignedSegment[]>(segments);
  const fileAbortRef = useRef<AbortController | null>(null);
  const realignAbortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    directiveRef.current = directive;
  }, [directive]);

  useEffect(() => {
    segmentsRef.current = segments;
  }, [segments]);

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(savedSessions));
    } catch {
      // Ignore storage quota errors
    }
  }, [savedSessions]);

  useEffect(() => {
    return () => {
      if (mediaUrl) URL.revokeObjectURL(mediaUrl);
    };
  }, [mediaUrl]);

  // Stream directive meaning for a single live microphone segment in real time
  const interpretLiveSegment = useCallback(
    async (
      segId: string,
      segmentText: string,
      recentContext: string,
      activeDirective: string
    ) => {
      try {
        const response = await fetch('/api/interpret-stream', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            mode: 'segment',
            segmentText,
            recentContext,
            directive: activeDirective,
          }),
        });

        if (!response.ok || !response.body) {
          const errData = await response.json().catch(() => ({}));
          throw new Error(errData.error || 'Failed to stream segment meaning.');
        }

        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffer = '';
        let accumulated = '';

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });

          const frames = buffer.split(/\r?\n\r?\n/);
          buffer = frames.pop() || '';

          for (const frame of frames) {
            const eventMatch = frame.match(/^event:\s*(.+)$/m);
            const dataMatch = frame.match(/^data:\s*(.+)$/m);
            if (!dataMatch) continue;
            const eventType = eventMatch ? eventMatch[1].trim() : 'message';
            const payload = JSON.parse(dataMatch[1]);

            if (eventType === 'meaning_delta' && payload.text) {
              accumulated += payload.text;
              setSegments((prev) =>
                prev.map((s) =>
                  s.id === segId ? { ...s, meaning: accumulated, isInterpreting: true } : s
                )
              );
            } else if (eventType === 'error') {
              throw new Error(payload.message || 'Live interpretation failed.');
            }
          }
        }

        setSegments((prev) =>
          prev.map((s) => (s.id === segId ? { ...s, isInterpreting: false } : s))
        );
      } catch (err) {
        setSegments((prev) =>
          prev.map((s) => (s.id === segId ? { ...s, isInterpreting: false } : s))
        );
        setErrorBanner((err as Error).message || 'Unable to translate live segment.');
      }
    },
    []
  );

  // Re-align all existing timed segments when user changes the Transcription Directive
  const realignSegmentsWithDirective = useCallback(
    async (currentSegments: AlignedSegment[], activeDirective: string) => {
      if (currentSegments.length === 0) return;

      realignAbortRef.current?.abort();
      const controller = new AbortController();
      realignAbortRef.current = controller;

      setErrorBanner(null);
      setIsInterpreting(true);
      // Clear meanings to show live per-row re-translation
      setSegments((prev) =>
        prev.map((s) => ({ ...s, meaning: '', isInterpreting: true }))
      );

      let accumulated = '';

      try {
        const response = await fetch('/api/interpret-stream', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            mode: 'realign',
            segments: currentSegments.map((s) => ({
              timestamp: s.timestamp,
              speech: s.speech,
            })),
            directive: activeDirective,
          }),
          signal: controller.signal,
        });

        if (!response.ok || !response.body) {
          const errData = await response.json().catch(() => ({}));
          throw new Error(errData.error || 'Failed to re-align timed meanings.');
        }

        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffer = '';

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });

          const frames = buffer.split(/\r?\n\r?\n/);
          buffer = frames.pop() || '';

          for (const frame of frames) {
            const eventMatch = frame.match(/^event:\s*(.+)$/m);
            const dataMatch = frame.match(/^data:\s*(.+)$/m);
            if (!dataMatch) continue;
            const eventType = eventMatch ? eventMatch[1].trim() : 'message';
            const payload = JSON.parse(dataMatch[1]);

            if (eventType === 'aligned_delta' && payload.text) {
              accumulated += payload.text;
              setSegments((prev) => applyAlignedMeanings(prev, accumulated));
            } else if (eventType === 'error') {
              throw new Error(payload.message || 'Re-alignment failed.');
            }
          }
        }

        setSegments((prev) => prev.map((s) => ({ ...s, isInterpreting: false })));
      } catch (err) {
        if ((err as Error).name !== 'AbortError') {
          setErrorBanner((err as Error).message || 'Unable to re-interpret segments.');
          setSegments((prev) => prev.map((s) => ({ ...s, isInterpreting: false })));
        }
      } finally {
        if (realignAbortRef.current === controller) {
          setIsInterpreting(false);
        }
      }
    },
    []
  );

  const stopMicCapture = useCallback(() => {
    if (timerRef.current) {
      window.clearInterval(timerRef.current);
      timerRef.current = null;
    }

    if (processorRef.current) {
      processorRef.current.disconnect();
      processorRef.current.onaudioprocess = null;
      processorRef.current = null;
    }
    if (audioCtxRef.current) {
      void audioCtxRef.current.close().catch(() => {});
      audioCtxRef.current = null;
    }
    if (micStreamRef.current) {
      micStreamRef.current.getTracks().forEach((t) => t.stop());
      micStreamRef.current = null;
    }
    if (wsRef.current) {
      if (wsRef.current.readyState === WebSocket.OPEN) {
        wsRef.current.send(JSON.stringify({ type: 'stop' }));
      }
      wsRef.current.close();
      wsRef.current = null;
    }

    setAnalyser(null);
    setIsListening(false);
    setIsConnectingMic(false);
    setIsTranscribing(false);
    setInterimTranscript('');
  }, []);

  useEffect(() => {
    return () => {
      stopMicCapture();
      fileAbortRef.current?.abort();
      realignAbortRef.current?.abort();
    };
  }, [stopMicCapture]);

  const startMicCapture = async () => {
    setErrorBanner(null);
    setIsConnectingMic(true);

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          channelCount: 1,
          echoCancellation: true,
          noiseSuppression: true,
        },
      });
      micStreamRef.current = stream;

      const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
      const ws = new WebSocket(`${protocol}//${window.location.host}/ws/live-transcribe`);
      wsRef.current = ws;

      const audioCtx = new AudioContext({ sampleRate: 16000 });
      audioCtxRef.current = audioCtx;
      if (audioCtx.state === 'suspended') {
        await audioCtx.resume();
      }

      const sourceNode = audioCtx.createMediaStreamSource(stream);
      const analyserNode = audioCtx.createAnalyser();
      analyserNode.fftSize = 128;
      const processor = audioCtx.createScriptProcessor(4096, 1, 1);
      const silentGain = audioCtx.createGain();
      silentGain.gain.value = 0;

      sourceNode.connect(analyserNode);
      analyserNode.connect(processor);
      processor.connect(silentGain);
      silentGain.connect(audioCtx.destination);

      processorRef.current = processor;
      setAnalyser(analyserNode);

      processor.onaudioprocess = (event) => {
        if (!wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) return;
        const channelData = event.inputBuffer.getChannelData(0);
        const base64 = float32ToInt16Base64(channelData);
        wsRef.current.send(JSON.stringify({ type: 'audio', data: base64 }));
      };

      ws.onopen = () => {
        setIsConnectingMic(false);
        setIsListening(true);
        setIsTranscribing(true);
        elapsedRef.current = 0;
        setElapsedSeconds(0);
        timerRef.current = window.setInterval(() => {
          elapsedRef.current += 1;
          setElapsedSeconds(elapsedRef.current);
        }, 1000);
      };

      ws.onmessage = (event) => {
        try {
          const msg = JSON.parse(event.data) as {
            type: string;
            text?: string;
            message?: string;
          };
          if (msg.type === 'interim' && msg.text) {
            setInterimTranscript(msg.text);
          } else if (msg.type === 'final' && msg.text) {
            const clean = msg.text.trim();
            if (clean) {
              const sec = elapsedRef.current;
              const ts = formatSeconds(sec);
              const segId = `live-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
              const recentContext = segmentsRef.current
                .slice(-3)
                .map((s) => s.speech)
                .join(' ');

              const newSeg: AlignedSegment = {
                id: segId,
                timestamp: ts,
                seconds: sec,
                speech: clean,
                meaning: '',
                isInterpreting: true,
              };

              setSegments((prev) => [...prev, newSeg]);
              setInterimTranscript('');
              void interpretLiveSegment(segId, clean, recentContext, directiveRef.current);
            }
          } else if (msg.type === 'error') {
            setErrorBanner(msg.message || 'Live transcription encountered an error.');
            stopMicCapture();
          }
        } catch {
          // Ignore malformed frame
        }
      };

      ws.onerror = () => {
        setErrorBanner('WebSocket connection failed while starting live transcription.');
        stopMicCapture();
      };

      ws.onclose = () => {
        if (micStreamRef.current) {
          stopMicCapture();
        }
      };
    } catch (err) {
      const message =
        err instanceof Error && err.name === 'NotAllowedError'
          ? 'Microphone permission was denied. Allow microphone access in your browser settings and try again.'
          : (err as Error).message || 'Unable to access microphone.';
      setErrorBanner(message);
      stopMicCapture();
    }
  };

  const runFileTranscription = async (fileToProcess: File, activeDirective: string) => {
    setErrorBanner(null);
    fileAbortRef.current?.abort();
    realignAbortRef.current?.abort();
    const controller = new AbortController();
    fileAbortRef.current = controller;

    setSegments([]);
    setInterimTranscript('');
    setIsTranscribing(true);
    setIsInterpreting(false);
    setProcessingPhase('Streaming speech & directive meaning...');

    const formData = new FormData();
    formData.append('file', fileToProcess);
    formData.append('directive', activeDirective.trim() || DEFAULT_DIRECTIVE);

    let accumulatedStream = '';

    try {
      const response = await fetch('/api/transcribe-media', {
        method: 'POST',
        body: formData,
        signal: controller.signal,
      });

      if (!response.ok || !response.body) {
        const errBody = await response.json().catch(() => ({}));
        throw new Error(errBody.error || 'Failed to transcribe uploaded media.');
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });

        const frames = buffer.split(/\r?\n\r?\n/);
        buffer = frames.pop() || '';

        for (const frame of frames) {
          const eventMatch = frame.match(/^event:\s*(.+)$/m);
          const dataMatch = frame.match(/^data:\s*(.+)$/m);
          if (!dataMatch) continue;
          const eventType = eventMatch ? eventMatch[1].trim() : 'message';
          const payload = JSON.parse(dataMatch[1]);

          if (eventType === 'phase') {
            setProcessingPhase(payload.message || 'Streaming...');
          } else if (eventType === 'aligned_delta' && payload.text) {
            accumulatedStream += payload.text;
            setSegments(parseAlignedStream(accumulatedStream));
          } else if (eventType === 'complete') {
            setSegments((prev) => prev.map((s) => ({ ...s, isInterpreting: false })));
          } else if (eventType === 'error') {
            throw new Error(payload.message || 'Media transcription failed.');
          }
        }
      }
    } catch (err) {
      if ((err as Error).name !== 'AbortError') {
        setErrorBanner((err as Error).message || 'Media transcription failed.');
      }
    } finally {
      if (fileAbortRef.current === controller) {
        setIsTranscribing(false);
        setIsInterpreting(false);
        setProcessingPhase('');
      }
    }
  };

  const inferMimeType = (file: File): string => {
    if (file.type && file.type !== 'application/octet-stream') {
      return file.type;
    }
    const ext = file.name.split('.').pop()?.toLowerCase() || '';
    const map: Record<string, string> = {
      mp3: 'audio/mpeg',
      wav: 'audio/wav',
      m4a: 'audio/mp4',
      ogg: 'audio/ogg',
      aac: 'audio/aac',
      flac: 'audio/flac',
      webm: 'video/webm',
      mp4: 'video/mp4',
      mov: 'video/quicktime',
      mkv: 'video/x-matroska',
      avi: 'video/x-msvideo',
    };
    return map[ext] || '';
  };

  const handleFileSelected = (rawFile: File) => {
    setErrorBanner(null);
    if (rawFile.size > 25 * 1024 * 1024) {
      setErrorBanner('File exceeds the 25 MB upload limit. Please select a smaller clip.');
      return;
    }
    const resolvedType = inferMimeType(rawFile);
    if (!resolvedType.startsWith('audio/') && !resolvedType.startsWith('video/')) {
      setErrorBanner('Unsupported format. Please choose an audio or video file.');
      return;
    }

    const file =
      rawFile.type === resolvedType
        ? rawFile
        : new File([rawFile], rawFile.name, { type: resolvedType });

    if (mediaUrl) URL.revokeObjectURL(mediaUrl);
    const nextUrl = URL.createObjectURL(file);
    setSelectedFile(file);
    setMediaUrl(nextUrl);
    setCurrentMediaTime(0);
    setSegments([]);

    void runFileTranscription(file, directiveRef.current);
  };

  const handleClearFile = () => {
    fileAbortRef.current?.abort();
    realignAbortRef.current?.abort();
    if (mediaUrl) URL.revokeObjectURL(mediaUrl);
    setSelectedFile(null);
    setMediaUrl(null);
    setCurrentMediaTime(0);
    setSegments([]);
  };

  const handleGenerateSample = async (topicId: SampleTopic['id']) => {
    setErrorBanner(null);
    setIsGeneratingSample(topicId);

    try {
      const response = await fetch('/api/sample-audio', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ topicId }),
      });

      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.error || 'Could not synthesize sample lecture.');
      }

      const sampleFile = base64ToFile(data.base64Audio, data.filename, data.mimeType);
      if (mediaUrl) URL.revokeObjectURL(mediaUrl);
      const nextUrl = URL.createObjectURL(sampleFile);
      setSelectedFile(sampleFile);
      setMediaUrl(nextUrl);
      setCurrentMediaTime(0);

      const activeDirective = directive.trim() || data.suggestedDirective || DEFAULT_DIRECTIVE;
      if (!directive.trim()) {
        setDirective(activeDirective);
      }

      setIsGeneratingSample(null);
      await runFileTranscription(sampleFile, activeDirective);
    } catch (err) {
      setErrorBanner((err as Error).message || 'Failed to generate spoken sample.');
      setIsGeneratingSample(null);
    }
  };

  const handleSeekTo = (seconds: number) => {
    const el = mediaRef.current;
    if (!el) return;
    el.currentTime = Math.max(0, seconds);
    if (el.paused) {
      void el.play().catch(() => {});
    }
  };

  const handleClearMicSession = () => {
    realignAbortRef.current?.abort();
    setSegments([]);
    setInterimTranscript('');
    setElapsedSeconds(0);
    elapsedRef.current = 0;
  };

  const handleSaveSession = () => {
    if (segments.length === 0) return;
    const verbatimTranscript = segmentsToTranscriptText(segments);
    const insightMarkdown = segmentsToMeaningText(segments);
    const words = verbatimTranscript.trim() ? verbatimTranscript.trim().split(/\s+/).length : 0;
    const title =
      source === 'file' && selectedFile
        ? selectedFile.name.replace(/\.[^.]+$/, '')
        : `Live Session (${new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })})`;

    const newSession: SavedSession = {
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      title,
      source,
      directive: directive.trim() || DEFAULT_DIRECTIVE,
      segments,
      verbatimTranscript,
      insightMarkdown,
      durationSeconds:
        source === 'mic'
          ? elapsedSeconds
          : Math.round(mediaRef.current?.duration || 0),
      wordCount: words,
      createdAt: new Date().toISOString(),
    };

    setSavedSessions((prev) => [newSession, ...prev]);
    setSessionSavedNotice(true);
    setTimeout(() => setSessionSavedNotice(false), 2000);
  };

  const handleLoadSession = (session: SavedSession) => {
    stopMicCapture();
    fileAbortRef.current?.abort();
    realignAbortRef.current?.abort();
    setSource(session.source);
    setDirective(session.directive);
    if (session.segments && session.segments.length > 0) {
      setSegments(session.segments);
    } else {
      // Backwards-compatible fallback for any prior saved session
      const lines = (session.verbatimTranscript || '')
        .split(/\r?\n/)
        .filter((l) => l.trim());
      setSegments(
        lines.map((line, i) => {
          const m = line.match(/^\[(\d{1,2}:\d{2}(?::\d{2})?)\]\s*(.*)$/);
          const ts = m ? m[1] : formatSeconds(i * 5);
          return {
            id: `loaded-${i}`,
            timestamp: ts,
            seconds: parseTimestampToSeconds(ts),
            speech: m ? m[2] : line,
            meaning: i === 0 ? session.insightMarkdown : '',
          };
        })
      );
    }
    setInterimTranscript('');
    setActiveTab('studio');
  };

  const handleDeleteSession = (id: string) => {
    setSavedSessions((prev) => prev.filter((s) => s.id !== id));
  };

  const handleExportNotes = () => {
    if (segments.length === 0) return;
    const content = segmentsToMarkdown(segments, directive.trim() || DEFAULT_DIRECTIVE);
    const blob = new Blob([content], { type: 'text/markdown;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `lenscript-notes-${Date.now()}.md`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const canExport = segments.length > 0;
  const isProcessingFile = (isTranscribing || isInterpreting) && source === 'file';

  return (
    <div className="min-h-screen flex flex-col bg-[#F8FAFC] text-slate-900">
      <TopBar
        activeTab={activeTab}
        onTabChange={setActiveTab}
        sessionCount={savedSessions.length}
        canExport={canExport}
        onExport={handleExportNotes}
      />

      <main className="flex-1 w-full max-w-[1440px] mx-auto px-6 py-6 flex flex-col gap-5">
        {errorBanner && (
          <div
            role="alert"
            className="bg-red-50 border border-red-200 rounded-xl px-4 py-3 flex items-center justify-between gap-3 text-xs text-red-800"
          >
            <div className="flex items-center gap-2.5 min-w-0">
              <AlertCircle className="w-4 h-4 text-red-600 shrink-0" aria-hidden="true" />
              <span className="font-medium">{errorBanner}</span>
            </div>
            <button
              type="button"
              onClick={() => setErrorBanner(null)}
              aria-label="Dismiss error"
              className="p-1 text-red-600 hover:bg-red-100 rounded transition-colors shrink-0"
            >
              <X className="w-3.5 h-3.5" aria-hidden="true" />
            </button>
          </div>
        )}

        {activeTab === 'studio' && (
          <>
            <DirectiveBar
              directive={directive}
              onDirectiveChange={setDirective}
              hasTranscript={segments.length > 0}
              isInterpreting={isInterpreting}
              onReinterpret={() => void realignSegmentsWithDirective(segments, directive)}
            />

            <div className="grid grid-cols-1 lg:grid-cols-12 gap-5 items-stretch flex-1">
              <div className="lg:col-span-5 xl:col-span-4 flex flex-col">
                <MediaWorkspace
                  source={source}
                  onSourceChange={(next) => {
                    setErrorBanner(null);
                    setSource(next);
                  }}
                  isListening={isListening}
                  isConnectingMic={isConnectingMic}
                  elapsedSeconds={elapsedSeconds}
                  analyser={analyser}
                  interimTranscript={interimTranscript}
                  onStartMic={() => void startMicCapture()}
                  onStopMic={stopMicCapture}
                  onClearSession={handleClearMicSession}
                  selectedFile={selectedFile}
                  mediaUrl={mediaUrl}
                  mediaRef={mediaRef}
                  isProcessingFile={isProcessingFile}
                  processingPhase={processingPhase}
                  isGeneratingSample={isGeneratingSample}
                  onFileSelected={handleFileSelected}
                  onClearFile={handleClearFile}
                  onStartFileTranscription={() =>
                    selectedFile && void runFileTranscription(selectedFile, directive)
                  }
                  onCancelProcessing={() => fileAbortRef.current?.abort()}
                  onGenerateSample={(topicId) => void handleGenerateSample(topicId)}
                  onTimeUpdate={setCurrentMediaTime}
                  hasTranscript={segments.length > 0}
                />
              </div>

              <div className="lg:col-span-7 xl:col-span-8 flex flex-col">
                <OutputWorkspace
                  layout={outputLayout}
                  onLayoutChange={setOutputLayout}
                  directive={directive}
                  segments={segments}
                  interimTranscript={interimTranscript}
                  isTranscribing={isTranscribing}
                  isInterpreting={isInterpreting}
                  currentMediaTime={currentMediaTime}
                  canSeek={source === 'file' && Boolean(mediaUrl)}
                  onSeekTo={handleSeekTo}
                  onSaveSession={handleSaveSession}
                  sessionSavedNotice={sessionSavedNotice}
                />
              </div>
            </div>
          </>
        )}

        {activeTab === 'sessions' && (
          <SessionsView
            sessions={savedSessions}
            onLoadSession={handleLoadSession}
            onDeleteSession={handleDeleteSession}
            onGoToStudio={() => setActiveTab('studio')}
          />
        )}

        {activeTab === 'guide' && (
          <DirectiveGuideView
            onApplyDirective={(prompt) => {
              setDirective(prompt);
              setActiveTab('studio');
              if (segments.length > 0) {
                void realignSegmentsWithDirective(segments, prompt);
              }
            }}
          />
        )}
      </main>
    </div>
  );
}
