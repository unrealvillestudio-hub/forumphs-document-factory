'use client';

import { useState } from 'react';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface ICRFinding {
  id?: string;            // optional — generated from index if missing
  severity: 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW';
  category: string;       // e.g. "⚖ Cumplimiento legal"
  section?: string;       // optional — hidden if missing
  issue: string;
  suggestion: string;
}

// Internal normalized type — always has id and section
interface NormalizedFinding extends ICRFinding {
  id: string;
  section: string;
}

export interface ProcessedBlock {
  id?: string;
  speaker_name?: string;
  speaker_role?: string;
  speaker_unit?: string;
  text_formal?: string;
  skip?: boolean;
  skip_reason?: string;
  icr_corrected?: boolean;
  icr_finding_id?: string;
  [key: string]: unknown;
}

export interface ICRDecision {
  finding_id: string;
  action: 'apply' | 'ignore' | 'edit';
  edited_instruction?: string;
}

type DecisionState = {
  action: 'apply' | 'ignore' | 'edit' | null;
  editedInstruction?: string;
};

interface ICRResolutionProps {
  findings: ICRFinding[];
  blocks: ProcessedBlock[];
  onComplete: (correctedBlocks: ProcessedBlock[], appliedCount: number) => void;
  onBack?: () => void;
}

// ─── Config ──────────────────────────────────────────────────────────────────

const SEV = {
  CRITICAL: {
    label: 'Crítico',
    badge: 'bg-red-50 text-red-700 border-red-200',
    dot: 'bg-red-500',
    border: 'border-l-red-500',
    order: 0,
  },
  HIGH: {
    label: 'Alto',
    badge: 'bg-orange-50 text-orange-700 border-orange-200',
    dot: 'bg-orange-500',
    border: 'border-l-orange-500',
    order: 1,
  },
  MEDIUM: {
    label: 'Medio',
    badge: 'bg-yellow-50 text-yellow-700 border-yellow-200',
    dot: 'bg-yellow-400',
    border: 'border-l-yellow-400',
    order: 2,
  },
  LOW: {
    label: 'Bajo',
    badge: 'bg-sky-50 text-sky-700 border-sky-200',
    dot: 'bg-sky-400',
    border: 'border-l-sky-400',
    order: 3,
  },
} as const;

// ─── Component ───────────────────────────────────────────────────────────────

export default function ICRResolution({
  findings,
  blocks,
  onComplete,
  onBack,
}: ICRResolutionProps) {
  const [decisions, setDecisions] = useState<Record<string, DecisionState>>({});
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editText, setEditText] = useState('');
  const [isApplying, setIsApplying] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Normalize: ensure every finding has id and section
  const normalized: NormalizedFinding[] = findings.map((f, i) => ({
    ...f,
    id: f.id || `finding_${i}`,
    section: f.section || '',
  }));

  const sorted = [...normalized].sort(
    (a, b) => SEV[a.severity].order - SEV[b.severity].order
  );

  const decided = Object.values(decisions).filter((d) => d.action !== null).length;
  const toApply = Object.values(decisions).filter(
    (d) => d.action === 'apply' || d.action === 'edit'
  ).length;
  const canProceed = decided === normalized.length;
  const progress = normalized.length > 0 ? (decided / normalized.length) * 100 : 0;

  // ─── Handlers ──────────────────────────────────────────────────────────────

  function decide(id: string, action: 'apply' | 'ignore' | 'edit', editedInstruction?: string) {
    setDecisions((prev) => ({ ...prev, [id]: { action, editedInstruction } }));
    if (action !== 'edit') setEditingId(null);
  }

  function startEdit(finding: ICRFinding) {
    const existing = decisions[finding.id]?.editedInstruction;
    setEditText(existing || finding.suggestion);
    setEditingId(finding.id);
    setDecisions((prev) => ({
      ...prev,
      [finding.id]: { action: 'edit', editedInstruction: existing || finding.suggestion },
    }));
  }

  function confirmEdit(id: string) {
    setDecisions((prev) => ({ ...prev, [id]: { action: 'edit', editedInstruction: editText } }));
    setEditingId(null);
  }

  function applyAll() {
    const all: Record<string, DecisionState> = {};
    normalized.forEach((f) => { all[f.id] = { action: 'apply' }; });
    setDecisions(all);
    setEditingId(null);
  }

  function ignoreAll() {
    const all: Record<string, DecisionState> = {};
    normalized.forEach((f) => { all[f.id] = { action: 'ignore' }; });
    setDecisions(all);
    setEditingId(null);
  }

  async function submit() {
    setIsApplying(true);
    setError(null);

    const decisionsList: ICRDecision[] = normalized.map((f) => {
      const d = decisions[f.id];
      if (!d || !d.action || d.action === 'ignore') {
        return { finding_id: f.id, action: 'ignore' as const };
      }
      return {
        finding_id: f.id,
        action: d.action,
        edited_instruction: d.action === 'edit' ? d.editedInstruction : undefined,
      };
    });

    try {
      const res = await fetch('/api/icr-apply', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ blocks, findings: normalized, decisions: decisionsList }),
      });

      if (!res.ok) throw new Error(`Error ${res.status} — ${res.statusText}`);
      const data = await res.json();
      if (!data.success) throw new Error(data.error || 'Error al aplicar correcciones');

      onComplete(data.corrected_blocks, data.applied_count);
    } catch (e) {
      setError(String(e));
      setIsApplying(false);
    }
  }

  // ─── Render ────────────────────────────────────────────────────────────────

  return (
    <div className="w-full max-w-2xl mx-auto px-4 py-6">

      {/* Header */}
      <div className="mb-6">
        <div className="flex items-center justify-between mb-1">
          <h2 className="text-lg font-semibold text-gray-900">Revisión ICR</h2>
          {onBack && (
            <button
              onClick={onBack}
              className="text-sm text-gray-400 hover:text-gray-600 transition-colors"
            >
              ← Auditoría
            </button>
          )}
        </div>
        <p className="text-sm text-gray-500 mb-4">
          Decide qué correcciones aplicar antes de generar el acta final.
        </p>

        {/* Stats row */}
        <div className="flex items-center gap-3 mb-3 text-sm">
          <span className="text-gray-500">{decided}/{normalized.length} revisados</span>
          <div className="flex-1 h-1.5 bg-gray-100 rounded-full overflow-hidden">
            <div
              className="h-full bg-[#00FFD1] rounded-full transition-all duration-300"
              style={{ width: `${progress}%` }}
            />
          </div>
          <div className="flex gap-2">
            <button
              onClick={applyAll}
              className="text-xs px-2.5 py-1 rounded-lg bg-green-50 text-green-700 hover:bg-green-100 border border-green-200 transition-colors"
            >
              Aplicar todo
            </button>
            <button
              onClick={ignoreAll}
              className="text-xs px-2.5 py-1 rounded-lg bg-gray-50 text-gray-500 hover:bg-gray-100 border border-gray-200 transition-colors"
            >
              Ignorar todo
            </button>
          </div>
        </div>
      </div>

      {/* Findings list */}
      <div className="space-y-3 pb-28">
        {sorted.map((finding) => {
          const cfg = SEV[finding.severity];
          const d = decisions[finding.id];
          const action = d?.action ?? null;
          const isEditing = editingId === finding.id;

          return (
            <div
              key={finding.id}
              className={`rounded-xl border border-l-4 ${cfg.border} p-4 transition-all duration-200 ${
                action === 'apply'
                  ? 'bg-green-50 border-green-200'
                  : action === 'ignore'
                  ? 'bg-gray-50 border-gray-200 opacity-55'
                  : action === 'edit'
                  ? 'bg-blue-50 border-blue-200'
                  : 'bg-white border-gray-200'
              }`}
            >
              {/* Top row */}
              <div className="flex items-start gap-2 mb-2">
                <span
                  className={`inline-flex items-center gap-1.5 text-xs font-medium px-2 py-0.5 rounded-full border ${cfg.badge}`}
                >
                  <span className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${cfg.dot}`} />
                  {cfg.label}
                </span>
                <span className="text-xs text-gray-400 mt-0.5 flex-1">{finding.category}</span>
                {action && (
                  <span
                    className={`text-xs font-medium px-2 py-0.5 rounded-full ${
                      action === 'apply'
                        ? 'bg-green-100 text-green-700'
                        : action === 'ignore'
                        ? 'bg-gray-100 text-gray-400'
                        : 'bg-blue-100 text-blue-700'
                    }`}
                  >
                    {action === 'apply' ? '✓ Aplicar' : action === 'ignore' ? '— Ignorar' : '✏ Editar'}
                  </span>
                )}
              </div>

              {/* Section ref */}
              <p className="text-xs font-mono text-gray-400 mb-1.5">{finding.section}</p>

              {/* Issue */}
              <p className="text-sm text-gray-700 leading-relaxed mb-3">{finding.issue}</p>

              {/* Suggestion or edit textarea */}
              {!isEditing ? (
                <div className="bg-white/70 rounded-lg border border-gray-100 px-3 py-2.5 mb-3">
                  <p className="text-xs text-gray-400 mb-0.5">→ Sugerencia</p>
                  <p className="text-sm text-gray-600 leading-relaxed">
                    {d?.editedInstruction || finding.suggestion}
                  </p>
                </div>
              ) : (
                <div className="mb-3">
                  <textarea
                    autoFocus
                    value={editText}
                    onChange={(e) => setEditText(e.target.value)}
                    className="w-full text-sm border border-blue-300 rounded-lg p-3 focus:outline-none focus:ring-2 focus:ring-blue-200 min-h-[80px] resize-y bg-white"
                    placeholder="Edita la instrucción de corrección..."
                  />
                  <div className="flex gap-2 mt-1.5">
                    <button
                      onClick={() => confirmEdit(finding.id)}
                      className="text-xs px-3 py-1.5 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
                    >
                      Confirmar
                    </button>
                    <button
                      onClick={() => setEditingId(null)}
                      className="text-xs px-3 py-1.5 bg-gray-100 text-gray-600 rounded-lg hover:bg-gray-200 transition-colors"
                    >
                      Cancelar
                    </button>
                  </div>
                </div>
              )}

              {/* Action buttons */}
              {!isEditing && (
                <div className="flex gap-2">
                  <button
                    onClick={() => decide(finding.id, 'apply')}
                    className={`flex-1 text-xs py-1.5 rounded-lg border font-medium transition-all ${
                      action === 'apply'
                        ? 'bg-green-600 text-white border-green-600'
                        : 'bg-white text-green-700 border-green-300 hover:bg-green-50'
                    }`}
                  >
                    ✓ Aplicar
                  </button>
                  <button
                    onClick={() => decide(finding.id, 'ignore')}
                    className={`flex-1 text-xs py-1.5 rounded-lg border font-medium transition-all ${
                      action === 'ignore'
                        ? 'bg-gray-400 text-white border-gray-400'
                        : 'bg-white text-gray-500 border-gray-300 hover:bg-gray-50'
                    }`}
                  >
                    — Ignorar
                  </button>
                  <button
                    onClick={() => startEdit(finding)}
                    className={`flex-1 text-xs py-1.5 rounded-lg border font-medium transition-all ${
                      action === 'edit'
                        ? 'bg-blue-600 text-white border-blue-600'
                        : 'bg-white text-blue-600 border-blue-300 hover:bg-blue-50'
                    }`}
                  >
                    ✏ Editar
                  </button>
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* Sticky bottom bar */}
      <div className="fixed bottom-0 left-0 right-0 bg-white/95 backdrop-blur-sm border-t border-gray-200 px-4 py-3 z-50">
        <div className="max-w-2xl mx-auto">
          {error && (
            <p className="text-xs text-red-600 mb-2">⚠ {error}</p>
          )}
          <div className="flex items-center gap-3">
            <div className="text-sm text-gray-500 flex-1">
              {!canProceed ? (
                <span className="text-amber-600">
                  {normalized.length - decided} hallazgo{normalized.length - decided !== 1 ? 's' : ''} sin revisar
                </span>
              ) : toApply > 0 ? (
                <span>
                  <strong className="text-gray-800">{toApply}</strong> corrección
                  {toApply !== 1 ? 'es' : ''} a aplicar
                </span>
              ) : (
                <span className="text-gray-400">Sin correcciones — se descarga el acta actual</span>
              )}
            </div>
            <button
              onClick={submit}
              disabled={!canProceed || isApplying}
              className={`px-5 py-2 rounded-xl text-sm font-medium transition-all flex items-center gap-2 ${
                canProceed && !isApplying
                  ? 'bg-[#00FFD1] text-gray-900 hover:brightness-90 active:scale-95'
                  : 'bg-gray-100 text-gray-400 cursor-not-allowed'
              }`}
            >
              {isApplying ? (
                <>
                  <svg className="animate-spin w-4 h-4" fill="none" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
                  </svg>
                  Aplicando…
                </>
              ) : (
                `Generar acta final${toApply > 0 ? ` · ${toApply}` : ''}`
              )}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
