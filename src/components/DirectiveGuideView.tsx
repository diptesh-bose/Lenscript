import { ArrowRight } from 'lucide-react';

interface DirectiveTemplate {
  id: string;
  category: string;
  title: string;
  prompt: string;
  exampleUse: string;
}

const TEMPLATES: DirectiveTemplate[] = [
  {
    id: 'kid-friendly',
    category: 'Learning & Comprehension',
    title: 'Explain Like I Am 10 Years Old',
    prompt: 'Help me understand the meaning as if I am a 10 year old kid',
    exampleUse:
      'Turns dense physics, medicine, or economics lectures into relatable everyday analogies without losing accuracy.',
  },
  {
    id: 'exec-decisions',
    category: 'Meetings & Briefings',
    title: 'Decisions, Owners & Risks',
    prompt:
      'Ignore small talk and list only the concrete decisions made, open risks, and next actions with clear owners',
    exampleUse:
      'Extracts high-signal operational accountability from long team calls or recorded presentations.',
  },
  {
    id: 'contrarian-audit',
    category: 'Critical Analysis',
    title: 'Assumptions & Evidence Check',
    prompt:
      'Identify the main claims made by the speaker, the evidence provided for each, and any unstated assumptions',
    exampleUse:
      'Useful when reviewing product pitches, debates, earnings calls, or technical proposals.',
  },
  {
    id: 'non-native-clarity',
    category: 'Plain Language',
    title: 'Everyday Plain English',
    prompt:
      'Rewrite the core ideas in crisp, everyday English using short sentences and defining any technical terms',
    exampleUse:
      'Makes specialized video tutorials or academic talks immediately accessible across disciplines.',
  },
];

interface DirectiveGuideViewProps {
  onApplyDirective: (prompt: string) => void;
}

export function DirectiveGuideView({ onApplyDirective }: DirectiveGuideViewProps) {
  return (
    <div className="bg-white border border-slate-200 rounded-xl p-6 flex flex-col gap-6">
      <div className="max-w-2xl">
        <h1 className="font-display text-lg font-semibold text-slate-900">
          Writing Effective Transcription Directives
        </h1>
        <p className="text-sm text-slate-600 mt-1.5 leading-relaxed">
          Unlike standard speech-to-text tools that stop at raw words, Lenscript keeps your
          verbatim transcript synchronized while actively translating spoken concepts through your
          instruction. Click any directive below to load it into the Studio.
        </p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {TEMPLATES.map((tpl) => (
          <div
            key={tpl.id}
            className="border border-slate-200 rounded-xl p-5 flex flex-col justify-between gap-4 bg-slate-50/50"
          >
            <div className="flex flex-col gap-2">
              <span className="text-xs font-medium text-slate-500">{tpl.category}</span>
              <h2 className="font-display text-base font-semibold text-slate-900">{tpl.title}</h2>
              <p className="text-xs text-slate-600 leading-relaxed">{tpl.exampleUse}</p>
              <div className="mt-2 p-3 rounded-lg bg-white border border-slate-200 text-xs text-slate-800 font-medium">
                &ldquo;{tpl.prompt}&rdquo;
              </div>
            </div>

            <button
              type="button"
              onClick={() => onApplyDirective(tpl.prompt)}
              className="inline-flex items-center justify-center gap-1.5 px-3.5 py-2 text-xs font-semibold text-blue-600 bg-white border border-slate-200 rounded-lg hover:bg-blue-50 hover:border-blue-200 transition-colors self-start"
            >
              <span>Use in Studio</span>
              <ArrowRight className="w-3.5 h-3.5" aria-hidden="true" />
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}
