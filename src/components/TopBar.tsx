import { Download } from 'lucide-react';

export type ActiveTab = 'studio' | 'sessions' | 'guide';

interface TopBarProps {
  activeTab: ActiveTab;
  onTabChange: (tab: ActiveTab) => void;
  sessionCount: number;
  canExport: boolean;
  onExport: () => void;
}

export function TopBar({
  activeTab,
  onTabChange,
  sessionCount,
  canExport,
  onExport,
}: TopBarProps) {
  return (
    <header className="sticky top-0 z-30 bg-white/95 backdrop-blur-sm border-b border-slate-200">
      <div className="max-w-[1440px] mx-auto px-6 h-16 flex items-center justify-between gap-8">
        {/* Zone 1: Single-element brand wordmark */}
        <a
          href="#studio"
          onClick={(e) => {
            e.preventDefault();
            onTabChange('studio');
          }}
          className="font-display text-lg font-bold tracking-tight text-slate-900 whitespace-nowrap shrink-0 focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-blue-600 rounded"
        >
          Lenscript
        </a>

        {/* Zone 2: Clean single-line navigation links */}
        <nav
          aria-label="Primary"
          className="flex items-center gap-6 text-sm font-medium text-slate-600 overflow-x-auto"
        >
          <button
            type="button"
            onClick={() => onTabChange('studio')}
            className={`py-5 border-b-2 transition-colors whitespace-nowrap shrink-0 focus-visible:outline-none focus-visible:text-blue-600 ${
              activeTab === 'studio'
                ? 'border-blue-600 text-slate-900'
                : 'border-transparent hover:text-slate-900'
            }`}
          >
            Studio
          </button>
          <button
            type="button"
            onClick={() => onTabChange('sessions')}
            className={`py-5 border-b-2 transition-colors whitespace-nowrap shrink-0 focus-visible:outline-none focus-visible:text-blue-600 ${
              activeTab === 'sessions'
                ? 'border-blue-600 text-slate-900'
                : 'border-transparent hover:text-slate-900'
            }`}
          >
            Saved Sessions{sessionCount > 0 ? ` (${sessionCount})` : ''}
          </button>
          <button
            type="button"
            onClick={() => onTabChange('guide')}
            className={`py-5 border-b-2 transition-colors whitespace-nowrap shrink-0 focus-visible:outline-none focus-visible:text-blue-600 ${
              activeTab === 'guide'
                ? 'border-blue-600 text-slate-900'
                : 'border-transparent hover:text-slate-900'
            }`}
          >
            Directive Guide
          </button>
        </nav>

        {/* Zone 3: Single primary action button */}
        <div className="flex items-center shrink-0">
          <button
            type="button"
            onClick={onExport}
            disabled={!canExport}
            className="inline-flex items-center gap-2 px-4 py-2 text-xs font-semibold text-white bg-blue-600 rounded-lg hover:bg-blue-700 disabled:bg-slate-200 disabled:text-slate-400 disabled:cursor-not-allowed transition-colors whitespace-nowrap shrink-0 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600"
          >
            <Download className="w-3.5 h-3.5" aria-hidden="true" />
            <span>Export Notes</span>
          </button>
        </div>
      </div>
    </header>
  );
}
