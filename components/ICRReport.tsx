'use client'

import type { ICRReport, ICRFinding } from '@/lib/types'

interface ICRReportViewProps {
  report: ICRReport
  loading: boolean
}

const SEVERITY_COLOR = {
  CRITICAL: '#EF4444',
  HIGH: 'var(--terra)',
  MEDIUM: '#FBBF24',
  LOW: '#4ADE80',
}

const SEVERITY_BG = {
  CRITICAL: 'rgba(239,68,68,0.08)',
  HIGH: 'rgba(196,98,45,0.08)',
  MEDIUM: 'rgba(251,191,36,0.08)',
  LOW: 'rgba(74,222,128,0.08)',
}

const CATEGORY_LABEL: Record<ICRFinding['category'], string> = {
  VOTE_INCONSISTENCY: '⚠ Votos inconsistentes',
  ROLE_ERROR: '👤 Rol incorrecto',
  LEGAL_COMPLIANCE: '⚖ Cumplimiento legal',
  DATA_MISMATCH: '🔢 Datos incorrectos',
  NARRATIVE_QUALITY: '✍ Calidad narrativa',
  STRUCTURAL: '📋 Estructura',
}

const VERDICT_CONFIG = {
  APPROVED: { label: '✅ APROBADO — Listo para firma', color: '#4ADE80', bg: 'rgba(74,222,128,0.08)', border: 'rgba(74,222,128,0.25)' },
  APPROVED_WITH_NOTES: { label: '✅ APROBADO CON NOTAS — Revisar observaciones menores', color: '#FBBF24', bg: 'rgba(251,191,36,0.06)', border: 'rgba(251,191,36,0.25)' },
  REQUIRES_CORRECTION: { label: '❌ REQUIERE CORRECCIÓN — Resolver antes de firmar', color: 'var(--terra)', bg: 'rgba(196,98,45,0.08)', border: 'rgba(196,98,45,0.3)' },
  BLOCKED: { label: '🛑 BLOQUEADO — El acta NO puede firmarse en este estado', color: '#EF4444', bg: 'rgba(239,68,68,0.08)', border: 'rgba(239,68,68,0.3)' },
}

export default function ICRReportView({ report, loading }: ICRReportViewProps) {
  if (!report && !loading) return null

  if (loading) {
    return (
      <div style={{
        background: 'var(--carbon-light)', border: '1px solid rgba(92,52,114,0.2)',
        borderRadius: 12, padding: '24px', marginTop: 20,
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <div style={{ width: 20, height: 20, border: '2px solid rgba(92,52,114,0.3)', borderTop: '2px solid var(--amatista)', borderRadius: '50%', animation: 'spin-slow 1s linear infinite' }} />
          <div>
            <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--parch)', marginBottom: 2 }}>ICR — Industrial Consistency Review</div>
            <div style={{ fontSize: 12, color: 'var(--parch-dim)' }}>Claude está leyendo el documento completo como auditor legal…</div>
          </div>
        </div>
      </div>
    )
  }

  const verdict = VERDICT_CONFIG[report.verdict]

  return (
    <div style={{ marginTop: 20 }}>
      {/* ICR header */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 14 }}>
        <div style={{ width: 2, height: 24, background: 'var(--amatista)', borderRadius: 1 }} />
        <div>
          <div style={{ fontSize: 11, fontWeight: 600, letterSpacing: '0.12em', textTransform: 'uppercase' as const, color: 'var(--amatista-light)' }}>
            ICR · Industrial Consistency Review
          </div>
          <div style={{ fontSize: 11, color: 'var(--parch-dim)' }}>Segunda capa — auditoría semántica y legal por Claude</div>
        </div>
      </div>

      {/* Verdict banner */}
      <div style={{
        background: verdict.bg, border: `1px solid ${verdict.border}`,
        borderRadius: 10, padding: '16px 20px', marginBottom: 16,
        display: 'flex', justifyContent: 'space-between', alignItems: 'center',
      }}>
        <div>
          <div style={{ fontSize: 16, fontWeight: 600, color: verdict.color, marginBottom: 4 }}>{verdict.label}</div>
          <div style={{ fontSize: 13, color: 'var(--parch-dim)', maxWidth: 560 }}>{report.auditor_summary}</div>
        </div>
        <div style={{ fontSize: 36, fontWeight: 700, color: verdict.color, fontFamily: 'DM Sans, sans-serif', minWidth: 48, textAlign: 'right' as const }}>
          {report.total_findings}
        </div>
      </div>

      {/* Counts */}
      {report.total_findings > 0 && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: 8, marginBottom: 16 }}>
          {[
            { label: 'Crítico', count: report.critical, color: '#EF4444' },
            { label: 'Alto', count: report.high, color: 'var(--terra)' },
            { label: 'Medio', count: report.medium, color: '#FBBF24' },
            { label: 'Bajo', count: report.low, color: '#4ADE80' },
          ].map(s => (
            <div key={s.label} style={{ background: 'var(--carbon-light)', border: '1px solid rgba(92,52,114,0.15)', borderRadius: 8, padding: '10px 12px', textAlign: 'center' as const }}>
              <div style={{ fontSize: 22, fontWeight: 700, color: s.count > 0 ? s.color : 'rgba(200,196,190,0.2)' }}>{s.count}</div>
              <div style={{ fontSize: 11, color: 'var(--parch-dim)' }}>{s.label}</div>
            </div>
          ))}
        </div>
      )}

      {/* Findings */}
      {report.findings.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {report.findings.map((f, i) => (
            <div key={i} style={{
              background: SEVERITY_BG[f.severity],
              border: `1px solid ${SEVERITY_COLOR[f.severity]}30`,
              borderLeft: `3px solid ${SEVERITY_COLOR[f.severity]}`,
              borderRadius: 8, padding: '12px 16px',
            }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 6 }}>
                <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                  <span style={{ fontSize: 11, fontWeight: 700, color: SEVERITY_COLOR[f.severity], letterSpacing: '0.06em' }}>
                    {f.severity}
                  </span>
                  <span style={{ fontSize: 11, color: 'var(--parch-dim)', background: 'rgba(255,255,255,0.05)', padding: '2px 8px', borderRadius: 4 }}>
                    {CATEGORY_LABEL[f.category]}
                  </span>
                </div>
                <span style={{ fontSize: 11, color: 'rgba(200,196,190,0.4)', textAlign: 'right' as const, maxWidth: 180 }}>{f.location}</span>
              </div>
              <div style={{ fontSize: 13, color: 'var(--parch)', marginBottom: 4, lineHeight: 1.4 }}>{f.issue}</div>
              <div style={{ fontSize: 12, color: 'var(--parch-dim)', paddingLeft: 10, borderLeft: '2px solid rgba(255,255,255,0.08)' }}>
                → {f.suggestion}
              </div>
            </div>
          ))}
        </div>
      )}

      {report.total_findings === 0 && (
        <div style={{ textAlign: 'center' as const, padding: '20px 0', color: '#4ADE80', fontSize: 13 }}>
          ✓ Sin hallazgos — el acta cumple todos los criterios de consistencia legal
        </div>
      )}
    </div>
  )
}
