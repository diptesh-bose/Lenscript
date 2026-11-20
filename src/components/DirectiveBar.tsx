import { RefreshCw } from 'lucide-react';
import type { DirectivePreset } from '../types';

export const DIRECTIVE_PRESETS: DirectivePreset[] = [
  {
    id: 'kid-10',
    label: 'Explain to a 10-year-old',
    instruction: 'Help me understand the meaning as if I am a 10 year old kid',
    description: 'Simple everyday analogies and friendly, clear explanations without jargon.',
  },
  {
    id: 'exec-brief',
    label: 'Executive Takeaways',
    instruction:
      'Summarize the core thesis, critical numbers or claims, and 4 actionable takeaways for a busy decision maker',
    description: 'High-signal summary focused on outcomes, trade-offs, and decisions.',
  },
  {
    id: 'tech-deep',
    label: 'Technical Breakdown',
    instruction:
      'Explain the exact underlying mechanisms, terminology, and cause-and-effect chain accurately',
    description: 'Preserves domain precision while organizing complex ideas cleanly.',
  },
  {
    id: 'study-notes',
    label: 'Study & Recall Notes',
    instruction:
      'Turn this speech into memorable mental models, key definitions, and 3 self-test questions',
    description: 'Structured for fast learning and long-term retention.',
  },
];

interface DirectiveBarProps {
  directive: string;
  onDirectiveChange: (value: string) => void;
  hasTranscript: boolean;
  isInterpreting: boolean;
  onReinterpret: () => void;
}

export function DirectiveBar({
  directive,
  onDirectiveChange,
  hasTranscript,
  isInterpreting,
  onReinterpret,
}: DirectiveBarProps) {
  return (
    <section
      aria-label="Transcription directive"
      className="bg-white border border-slate-200 rounded-xl p-5"
    >
      <div className="flex flex-col gap-3">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <label
            htmlFor="directive-input"
            className="font-display text-sm font-semibold text-slate-900"
          >
            Transcription Directive
          </label>
          <span className="text-xs text-slate-500">
            Speech is transcribed verbatim and simultaneously reshaped by this instruction
          </span>
        </div>

        <div className="flex flex-col sm:flex-row gap-3">
          <input
            id="directive-input"
            type="text"
            value={directive}
            onChange={(e) => onDirectiveChange(e.target.value)}
            placeholder="e.g. Help me understand the meaning as if I am a 10 year old kid"
            className="flex-1 min-w-0 px-3.5 py-2.5 text-sm text-slate-900 bg-slate-50 border border-slate-200 rounded-lg focus:outline-none focus:bg-white focus:border-blue-600 focus:ring-2 focus:ring-blue-600/15 transition-colors"
          />

          {hasTranscript && (
            <button
              type="button"
              onClick={onReinterpret}
              disabled={isInterpreting || !directive.trim()}
              className="inline-flex items-center justify-center gap-2 px-4 py-2.5 text-xs font-semibold text-white bg-slate-900 rounded-lg hover:bg-slate-800 disabled:bg-slate-200 disabled:text-slate-400 disabled:cursor-not-allowed transition-colors whitespace-nowrap shrink-0 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-slate-900"
            >
              <RefreshCw
                className={`w-3.5 h-3.5 ${isInterpreting ? 'animate-spin' : ''}`}
                aria-hidden="true"
              />
              <span>{isInterpreting ? 'Applying...' : 'Re-interpret'}</span>
            </button>
          )}
        </div>

        {/* Interactive preset selectors */}
        <div className="flex flex-wrap items-center gap-2 pt-1">
          <span className="text-xs text-slate-500 mr-1">Presets:</span>
          {DIRECTIVE_PRESETS.map((preset) => {
            const isSelected = directive.trim() === preset.instruction;
            return (
              <button
                key={preset.id}
                type="button"
                onClick={() => onDirectiveChange(preset.instruction)}
                className={`px-3 py-1.5 text-xs font-medium rounded-md border transition-colors whitespace-nowrap shrink-0 focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-blue-600 ${
                  isSelected
                    ? 'bg-blue-50 border-blue-200 text-blue-700'
                    : 'bg-white border-slate-200 text-slate-700 hover:bg-slate-50 hover:border-slate-300'
                }`}
              >
                {preset.label}
              </button>
            );
          })}
        </div>
      </div>
    </section>
  );
}
