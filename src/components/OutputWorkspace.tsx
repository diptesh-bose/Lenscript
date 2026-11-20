import { useMemo, useState } from 'react';
import { Copy, Check, BookmarkPlus, Search } from 'lucide-react';
import type { AlignedSegment, OutputLayout } from '../types';
import {
  segmentsToMarkdown,
  segmentsToMeaningText,
  segmentsToTranscriptText,
} from '../utils/audio';

interface OutputWorkspaceProps {
  layout: OutputLayout;
  onLayoutChange: (layout: OutputLayout) => void;
  directive: string;
  segments: AlignedSegment[];
  interimTranscript: string;
  isTranscribing: boolean;
  isInterpreting: boolean;
  currentMediaTime: number;
  canSeek: boolean;
  onSeekTo: (seconds: number) => void;
  onSaveSession: () => void;
  sessionSavedNotice: boolean;
}

export function OutputWorkspace({
  layout,
  onLayoutChange,
  directive,
  segments,
  interimTranscript,
  isTranscribing,
  isInterpreting,
  currentMediaTime,
  canSeek,
  onSeekTo,
  onSaveSession,
  sessionSavedNotice,
}: OutputWorkspaceProps) {
  const [searchQuery, setSearchQuery] = useState('');
  const [copied, setCopied] = useState(false);

  const filteredSegments = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return segments;
    return segments.filter(
      (seg) =>
        seg.speech.toLowerCase().includes(q) ||
        seg.meaning.toLowerCase().includes(q) ||
        seg.timestamp.toLowerCase().includes(q)
    );
  }, [segments, searchQuery]);

  const wordCount = useMemo(() => {
    const combined = segments.map((s) => s.speech).join(' ').trim();
    return combined ? combined.split(/\s+/).length : 0;
  }, [segments]);

  // Determine currently active timed segment during media playback
  const activeSegment = useMemo(() => {
    if (!canSeek || segments.length === 0) return null;
    let current: AlignedSegment | null = null;
    for (let i = 0; i < segments.length; i++) {
      if (currentMediaTime >= segments[i].seconds) {
        current = segments[i];
      } else {
        break;
      }
    }
    return current;
  }, [canSeek, currentMediaTime, segments]);

  const handleCopy = async () => {
    if (segments.length === 0) return;
    let text = '';
    if (layout === 'transcript') {
      text = segmentsToTranscriptText(segments);
    } else if (layout === 'insights') {
      text = segmentsToMeaningText(segments);
    } else {
      text = segmentsToMarkdown(segments, directive);
    }
    if (!text.trim()) return;
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      // Clipboard blocked
    }
  };

  const showSpeech = layout === 'split' || layout === 'transcript';
  const showMeaning = layout === 'split' || layout === 'insights';
  const hasAnyContent = segments.length > 0 || interimTranscript.trim().length > 0;

  return (
    <section
      aria-label="Synchronized speech and directive meaning"
      className="bg-white border border-slate-200 rounded-xl flex flex-col min-h-[540px] h-full overflow-hidden"
    >
      {/* Workspace Header Controls */}
      <div className="px-5 py-3.5 border-b border-slate-200 flex flex-wrap items-center justify-between gap-3">
        <div
          role="tablist"
          aria-label="Output view mode"
          className="inline-flex items-center p-1 bg-slate-100 rounded-lg"
        >
          {(
            [
              { id: 'split', label: 'Aligned View' },
              { id: 'insights', label: 'Directive Meaning' },
              { id: 'transcript', label: 'Original Speech' },
            ] as const
          ).map((item) => (
            <button
              key={item.id}
              type="button"
              role="tab"
              aria-selected={layout === item.id}
              onClick={() => onLayoutChange(item.id)}
              className={`px-3 py-1.5 text-xs font-semibold rounded-md transition-colors whitespace-nowrap shrink-0 ${
                layout === item.id
                  ? 'bg-white text-slate-900 shadow-xs'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              {item.label}
            </button>
          ))}
        </div>

        <div className="flex items-center gap-2.5 flex-wrap">
          {segments.length > 0 && (
            <div className="relative">
              <Search
                className="w-3.5 h-3.5 text-slate-400 absolute left-2.5 top-1/2 -translate-y-1/2"
                aria-hidden="true"
              />
              <input
                type="search"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Filter..."
                aria-label="Filter timed transcript"
                className="pl-7 pr-2.5 py-1.5 text-xs bg-slate-50 border border-slate-200 rounded-md w-32 focus:w-44 focus:outline-none focus:bg-white focus:border-blue-600 transition-all"
              />
            </div>
          )}

          {wordCount > 0 && (
            <span className="text-xs text-slate-500 tabular-nums whitespace-nowrap">
              {wordCount} words
            </span>
          )}

          <button
            type="button"
            onClick={handleCopy}
            disabled={segments.length === 0}
            className="inline-flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium text-slate-600 hover:text-slate-900 hover:bg-slate-100 rounded-md disabled:opacity-40 transition-colors shrink-0"
          >
            {copied ? (
              <Check className="w-3.5 h-3.5 text-green-600" aria-hidden="true" />
            ) : (
              <Copy className="w-3.5 h-3.5" aria-hidden="true" />
            )}
            <span>{copied ? 'Copied' : 'Copy'}</span>
          </button>

          <button
            type="button"
            onClick={onSaveSession}
            disabled={!hasAnyContent || isTranscribing}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-slate-700 bg-white border border-slate-200 rounded-lg hover:bg-slate-50 disabled:opacity-40 disabled:cursor-not-allowed transition-colors whitespace-nowrap shrink-0"
          >
            {sessionSavedNotice ? (
              <>
                <Check className="w-3.5 h-3.5 text-green-600" aria-hidden="true" />
                <span>Saved</span>
              </>
            ) : (
              <>
                <BookmarkPlus className="w-3.5 h-3.5" aria-hidden="true" />
                <span>Save Session</span>
              </>
            )}
          </button>
        </div>
      </div>

      {/* Live Playback Sync Strip */}
      {canSeek && activeSegment && (
        <div className="px-5 py-3 bg-slate-50 border-b border-slate-200 flex flex-col gap-1.5">
          <div className="flex items-center justify-between gap-3 text-xs">
            <span className="font-medium text-slate-600">Synced with playback</span>
            <span className="font-mono tabular-nums font-semibold text-blue-600">
              {activeSegment.timestamp}
            </span>
          </div>
          <div
            className={`grid gap-4 ${
              showSpeech && showMeaning ? 'grid-cols-1 md:grid-cols-2' : 'grid-cols-1'
            }`}
          >
            {showSpeech && (
              <p className="text-xs text-slate-600 leading-relaxed">{activeSegment.speech}</p>
            )}
            {showMeaning && (
              <p className="text-sm font-medium text-slate-900 leading-relaxed">
                {activeSegment.meaning || 'Translating meaning...'}
              </p>
            )}
          </div>
        </div>
      )}

      {/* Column Headers */}
      {hasAnyContent && (
        <div
          className={`hidden md:grid px-5 py-2.5 border-b border-slate-200 bg-slate-50/70 text-xs font-semibold text-slate-600 gap-4 ${
            showSpeech && showMeaning
              ? 'grid-cols-[64px_1fr_1fr]'
              : 'grid-cols-[64px_1fr]'
          }`}
        >
          <div>Time</div>
          {showSpeech && <div>Original Speech</div>}
          {showMeaning && (
            <div className="truncate">
              Directive Meaning — {directive.trim() || 'Plain summary'}
            </div>
          )}
        </div>
      )}

      {/* Timed Aligned Rows */}
      {hasAnyContent ? (
        <div className="flex-1 overflow-y-auto max-h-[600px] divide-y divide-slate-100">
          {filteredSegments.map((seg) => {
            const isActive = activeSegment?.id === seg.id;
            return (
              <div
                key={seg.id}
                onClick={() => canSeek && onSeekTo(seg.seconds)}
                className={`px-5 py-3.5 grid gap-3 md:gap-4 items-start transition-colors ${
                  showSpeech && showMeaning
                    ? 'grid-cols-1 md:grid-cols-[64px_1fr_1fr]'
                    : 'grid-cols-1 md:grid-cols-[64px_1fr]'
                } ${canSeek ? 'cursor-pointer' : ''} ${
                  isActive ? 'bg-blue-50/70' : 'hover:bg-slate-50/80'
                }`}
              >
                {/* Timestamp Cell */}
                <div className="pt-0.5">
                  <button
                    type="button"
                    disabled={!canSeek}
                    onClick={(e) => {
                      e.stopPropagation();
                      if (canSeek) onSeekTo(seg.seconds);
                    }}
                    className={`font-mono tabular-nums text-xs font-medium ${
                      isActive
                        ? 'text-blue-700 font-semibold'
                        : canSeek
                        ? 'text-blue-600 hover:text-blue-700'
                        : 'text-slate-500 cursor-default'
                    }`}
                    title={canSeek ? `Jump to ${seg.timestamp}` : undefined}
                  >
                    {seg.timestamp}
                  </button>
                </div>

                {/* Original Speech Cell */}
                {showSpeech && (
                  <div className="text-sm text-slate-700 leading-relaxed min-w-0">
                    {seg.speech || (
                      <span className="text-slate-400 italic">Listening...</span>
                    )}
                  </div>
                )}

                {/* Timed Directive Meaning Cell */}
                {showMeaning && (
                  <div className="text-sm text-slate-900 leading-relaxed min-w-0">
                    {seg.meaning ? (
                      <span>{seg.meaning}</span>
                    ) : (
                      <span className="text-xs text-blue-600 font-medium">
                        Translating moment...
                      </span>
                    )}
                  </div>
                )}
              </div>
            );
          })}

          {filteredSegments.length === 0 && searchQuery.trim() && (
            <div className="px-5 py-8 text-xs text-slate-500">
              No timed segments match &ldquo;{searchQuery}&rdquo;.
            </div>
          )}

          {/* Live Interim Microphone Row */}
          {interimTranscript.trim() && (
            <div
              className={`px-5 py-3.5 grid gap-3 md:gap-4 items-start bg-slate-50/60 ${
                showSpeech && showMeaning
                  ? 'grid-cols-1 md:grid-cols-[64px_1fr_1fr]'
                  : 'grid-cols-1 md:grid-cols-[64px_1fr]'
              }`}
            >
              <div className="font-mono tabular-nums text-xs text-slate-400 pt-0.5">
                live
              </div>
              {showSpeech && (
                <p className="text-sm text-slate-500 italic leading-relaxed">
                  {interimTranscript}
                </p>
              )}
              {showMeaning && (
                <p className="text-xs text-slate-400 pt-0.5">
                  Waiting for phrase to finish...
                </p>
              )}
            </div>
          )}

          {(isTranscribing || isInterpreting) && (
            <div className="px-5 py-3 text-xs font-medium text-blue-600">
              {isTranscribing
                ? 'Streaming live timed speech and directive meaning...'
                : 'Updating timed meanings for your directive...'}
            </div>
          )}
        </div>
      ) : isTranscribing || isInterpreting ? (
        <div className="p-5 flex flex-col gap-3">
          <p className="text-xs font-medium text-blue-600">
            Streaming live timed speech and directive meaning...
          </p>
          <div className="space-y-3 animate-pulse">
            <div className="grid grid-cols-1 md:grid-cols-[64px_1fr_1fr] gap-4">
              <div className="h-4 bg-slate-100 rounded w-12" />
              <div className="h-4 bg-slate-100 rounded w-full" />
              <div className="h-4 bg-slate-100 rounded w-5/6" />
            </div>
            <div className="grid grid-cols-1 md:grid-cols-[64px_1fr_1fr] gap-4">
              <div className="h-4 bg-slate-100 rounded w-12" />
              <div className="h-4 bg-slate-100 rounded w-4/5" />
              <div className="h-4 bg-slate-100 rounded w-full" />
            </div>
          </div>
        </div>
      ) : (
        <div className="flex-1 flex flex-col items-start justify-center p-8 text-left max-w-lg">
          <p className="text-sm font-semibold text-slate-900">
            Timed speech paired live with your directive meaning
          </p>
          <p className="text-xs text-slate-500 mt-1.5 leading-relaxed">
            Every spoken phrase is timestamped and immediately translated beside the original
            transcript using your Transcription Directive—so playback stays synchronized row by
            row.
          </p>
        </div>
      )}
    </section>
  );
}
