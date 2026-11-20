import { useMemo, useState } from 'react';
import { Trash2, ArrowUpRight, Search } from 'lucide-react';
import type { SavedSession } from '../types';
import { formatSeconds } from '../utils/audio';

interface SessionsViewProps {
  sessions: SavedSession[];
  onLoadSession: (session: SavedSession) => void;
  onDeleteSession: (id: string) => void;
  onGoToStudio: () => void;
}

export function SessionsView({
  sessions,
  onLoadSession,
  onDeleteSession,
  onGoToStudio,
}: SessionsViewProps) {
  const [filter, setFilter] = useState('');

  const filtered = useMemo(() => {
    const q = filter.trim().toLowerCase();
    if (!q) return sessions;
    return sessions.filter(
      (s) =>
        s.title.toLowerCase().includes(q) ||
        s.directive.toLowerCase().includes(q) ||
        s.verbatimTranscript.toLowerCase().includes(q)
    );
  }, [sessions, filter]);

  return (
    <div className="bg-white border border-slate-200 rounded-xl p-6 flex flex-col gap-5">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="font-display text-lg font-semibold text-slate-900">Saved Sessions</h1>
          <p className="text-xs text-slate-500 mt-0.5">
            Previous transcripts and directive interpretations stored in your browser
          </p>
        </div>

        {sessions.length > 0 && (
          <div className="relative">
            <Search
              className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2"
              aria-hidden="true"
            />
            <input
              type="search"
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              placeholder="Search sessions..."
              className="pl-8 pr-3 py-2 text-xs bg-slate-50 border border-slate-200 rounded-lg w-60 focus:outline-none focus:bg-white focus:border-blue-600 transition-colors"
            />
          </div>
        )}
      </div>

      {sessions.length === 0 ? (
        <div className="py-16 text-center flex flex-col items-center gap-3 border-t border-slate-100">
          <p className="text-sm font-medium text-slate-900">No saved sessions yet</p>
          <p className="text-xs text-slate-500 max-w-sm">
            Transcribe a live speech stream or an audio/video file in the Studio, then click Save
            Session to revisit it here.
          </p>
          <button
            type="button"
            onClick={onGoToStudio}
            className="mt-1 px-4 py-2 text-xs font-semibold text-white bg-blue-600 rounded-lg hover:bg-blue-700 transition-colors"
          >
            Open Studio
          </button>
        </div>
      ) : (
        <div className="overflow-x-auto border border-slate-200 rounded-lg">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="border-b border-slate-200 bg-slate-50 text-xs font-semibold text-slate-600">
                <th className="py-2.5 px-4">Session</th>
                <th className="py-2.5 px-4">Directive</th>
                <th className="py-2.5 px-4">Source</th>
                <th className="py-2.5 px-4 text-right">Words</th>
                <th className="py-2.5 px-4 text-right">Duration</th>
                <th className="py-2.5 px-4">Saved</th>
                <th className="py-2.5 px-4 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200 text-xs text-slate-700">
              {filtered.map((session) => (
                <tr key={session.id} className="hover:bg-slate-50/80 transition-colors h-11">
                  <td className="py-2.5 px-4 font-medium text-slate-900 max-w-[200px] truncate">
                    {session.title}
                  </td>
                  <td className="py-2.5 px-4 text-slate-600 max-w-[280px] truncate">
                    {session.directive}
                  </td>
                  <td className="py-2.5 px-4 whitespace-nowrap">
                    {session.source === 'mic' ? 'Microphone' : 'Media File'}
                  </td>
                  <td className="py-2.5 px-4 text-right font-mono tabular-nums">
                    {session.wordCount}
                  </td>
                  <td className="py-2.5 px-4 text-right font-mono tabular-nums">
                    {formatSeconds(session.durationSeconds)}
                  </td>
                  <td className="py-2.5 px-4 text-slate-500 whitespace-nowrap tabular-nums">
                    {new Date(session.createdAt).toLocaleDateString()}
                  </td>
                  <td className="py-2.5 px-4 text-right whitespace-nowrap">
                    <div className="inline-flex items-center gap-2">
                      <button
                        type="button"
                        onClick={() => onLoadSession(session)}
                        className="inline-flex items-center gap-1 px-2.5 py-1 text-xs font-medium text-blue-600 hover:bg-blue-50 rounded transition-colors"
                      >
                        <span>Open</span>
                        <ArrowUpRight className="w-3 h-3" aria-hidden="true" />
                      </button>
                      <button
                        type="button"
                        onClick={() => onDeleteSession(session.id)}
                        aria-label={`Delete ${session.title}`}
                        className="p-1 text-slate-400 hover:text-red-600 rounded transition-colors"
                      >
                        <Trash2 className="w-3.5 h-3.5" aria-hidden="true" />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
              {filtered.length === 0 && (
                <tr>
                  <td colSpan={7} className="py-8 text-center text-xs text-slate-500">
                    No saved sessions match &ldquo;{filter}&rdquo;.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
