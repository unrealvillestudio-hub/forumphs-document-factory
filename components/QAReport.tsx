'use client'

import type { QAReport } from '@/lib/types'

interface QAReportViewProps {
  report: QAReport
  wordCount: number
  filename: string
  onDownload: () => void
  onRegenerate: () => void
}

const ERROR_LABELS: Record<string, string> = {
  FIRST_PERSON: 'Primera persona',
  ORAL_ARTIFACT: 'Lenguaje oral',
  SPOKEN_WORD: 'Muletilla oral',
  REPEATED_WORD: 'Palabra repetida',
  DANGLING_CONJ: 'Conjunción suelta',
  INCOMPLETE_SENTENCE: 'Frase incompleta',
  NUMBER_FORMAT: 'Formato número',
  GENDER_MISMATCH: 'Género incorrecto',
}

export default function QAReportView({ report, wordCount, filename, onDownload, onRegenerate }: QAReportViewProps) {
  const verdictColor = {
    PASS: '#4ADE80',
    WARN: '#FBBF24',
    FAIL: 'var(--terra)',
    STOP: '#EF4444',
  }[report.verdict]

  const verdictLabel = {
    PASS: '✅ Acta lista para revisión de Ivette',
    WARN: '⚠️ Errores menores — revisar antes de enviar',
    FAIL: '❌ Errores significativos — corregir secciones',
    STOP: '🛑 STOP — revisar completamente',
  }[report.verdict]

  const wcPct = report.word_count_pct || 0
  const wcColor = wcPct >= 85 && wcPct <= 115 ? '#4ADE80' : wcPct > 115 ? 'var(--terra)' : '#FBBF24'

  return (
    <div className="fade-in">
      <div style={{ marginBottom: 28 }}>
        <h2 style={{
          fontFamily: 'EB Garamond, serif',
          fontSize: 32,
          fontWeight: 400,
          color: 'var(--parch)',
          margin: '0 0 8px',
        }}>
          Reporte QA
        </h2>
        <p style={{ color: 'var(--parch-dim)', fontSize: 14, margin: 0 }}>
          Lectura 100% del documento generado. Cada oración fue analizada.
        </p>
      </div>

      {/* Verdict banner */}
      <div style={{
        background: `${verdictColor}18`,
        border: `1px solid ${verdictColor}40`,
        borderRadius: 12,
        padding: '20px 24px',
        marginBottom: 24,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
      }}>
        <div>
          <div style={{ fontSize: 22, color: verdictColor, fontWeight: 600, marginBottom: 4 }}>
            {verdictLabel}
          </div>
          <div style={{ fontSize: 13, color: 'var(--parch-dim)' }}>
            {report.total_errors} errores encontrados en {wordCount.toLocaleString()} palabras
          </div>
        </div>
        <div style={{
          fontSize: 48,
          fontFamily: 'EB Garamond, serif',
          color: verdictColor,
          fontWeight: 400,
        }}>
          {report.total_errors}
        </div>
      </div>

      {/* Metrics grid */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: 12, marginBottom: 24 }}>
        <div style={{
          background: 'var(--carbon-light)',
          border: '1px solid rgba(92,52,114,0.2)',
          borderRadius: 10,
          padding: '16px',
        }}>
          <div style={{ fontSize: 11, color: 'var(--parch-dim)', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 6 }}>
            Completeness
          </div>
          <div style={{ fontSize: 24, color: report.completeness ? (report.completeness.score >= 80 ? '#4ADE80' : report.completeness.score >= 60 ? '#FBBF24' : 'var(--terra)') : 'var(--parch-dim)', fontWeight: 600 }}>
            {report.completeness ? `${report.completeness.score}%` : '—'}
          </div>
          <div style={{ fontSize: 11, color: 'var(--parch-dim)', marginTop: 4 }}>
            {report.completeness ? `${report.completeness.items.filter(i => i.passed).length}/${report.completeness.items.length} elementos OK` : 'Sin datos'}
          </div>
          <div className="wc-bar" style={{ marginTop: 8 }}>
            <div className={`wc-bar-fill ${report.completeness && report.completeness.score >= 80 ? 'ok' : ''}`}
              style={{ width: `${report.completeness?.score || 0}%` }} />
          </div>
        </div>

        <div style={{
          background: 'var(--carbon-light)',
          border: '1px solid rgba(92,52,114,0.2)',
          borderRadius: 10,
          padding: '16px',
        }}>
          <div style={{ fontSize: 11, color: 'var(--parch-dim)', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 6 }}>
            Páginas est.
          </div>
          <div style={{ fontSize: 24, color: 'var(--parch)', fontWeight: 600 }}>
            ~{Math.round(wordCount / 500)}
          </div>
          <div style={{ fontSize: 11, color: 'var(--parch-dim)', marginTop: 4 }}>Target: 27–33 páginas</div>
        </div>

        <div style={{
          background: 'var(--carbon-light)',
          border: '1px solid rgba(92,52,114,0.2)',
          borderRadius: 10,
          padding: '16px',
        }}>
          <div style={{ fontSize: 11, color: 'var(--parch-dim)', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 6 }}>
            Score QA
          </div>
          <div style={{ fontSize: 24, color: verdictColor, fontWeight: 600 }}>
            {report.verdict}
          </div>
          <div style={{ fontSize: 11, color: 'var(--parch-dim)', marginTop: 4 }}>
            {report.total_errors <= 10 ? 'Listo para Ivette' : `${report.total_errors} correcciones`}
          </div>
        </div>
      </div>

      {/* Error breakdown */}
      {report.total_errors > 0 && (
        <div style={{
          background: 'var(--carbon-light)',
          border: '1px solid rgba(92,52,114,0.2)',
          borderRadius: 10,
          padding: '16px 20px',
          marginBottom: 24,
        }}>
          <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--parch-dim)', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 14 }}>
            Errores por tipo
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {Object.entries(report.by_type).map(([type, count]) => (
              <div key={type} style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                <span style={{ minWidth: 160, fontSize: 13, color: 'var(--parch-dim)' }}>
                  {ERROR_LABELS[type] || type}
                </span>
                <div style={{ flex: 1, height: 6, background: 'var(--carbon-mid)', borderRadius: 3, overflow: 'hidden' }}>
                  <div style={{
                    height: '100%',
                    width: `${Math.min((count / report.total_errors) * 100, 100)}%`,
                    background: count > 5 ? 'var(--terra)' : '#FBBF24',
                    borderRadius: 3,
                    transition: 'width 0.5s ease',
                  }} />
                </div>
                <span style={{ minWidth: 28, fontSize: 13, color: 'var(--parch)', fontWeight: 600, textAlign: 'right' }}>
                  {count}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Error detail */}
      {report.errors.length > 0 && report.errors.length <= 50 && (
        <div style={{
          background: 'rgba(14,17,26,0.8)',
          border: '1px solid rgba(92,52,114,0.2)',
          borderRadius: 10,
          padding: '16px',
          maxHeight: 200,
          overflowY: 'auto',
          marginBottom: 24,
        }}>
          {report.errors.slice(0, 20).map((err, i) => (
            <div key={i} style={{
              padding: '6px 0',
              borderBottom: '1px solid rgba(255,255,255,0.04)',
              fontSize: 12,
            }}>
              <span style={{ color: 'var(--terra)', marginRight: 8 }}>[{ERROR_LABELS[err.type] || err.type}]</span>
              <span style={{ color: 'var(--parch-dim)', fontFamily: 'DM Sans, monospace' }}>
                "…{err.text_fragment}…"
              </span>
              {err.suggestion && (
                <span style={{ color: '#4ADE80', marginLeft: 8 }}>→ {err.suggestion}</span>
              )}
            </div>
          ))}
          {report.errors.length > 20 && (
            <div style={{ color: 'var(--parch-dim)', fontSize: 12, paddingTop: 8 }}>
              + {report.errors.length - 20} errores más…
            </div>
          )}
        </div>
      )}

      {/* Completeness breakdown */}
      {report.completeness && (
        <div style={{
          background: 'var(--carbon-light)',
          border: '1px solid rgba(92,52,114,0.2)',
          borderRadius: 10,
          padding: '16px 20px',
          marginBottom: 24,
        }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
            <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--parch-dim)', textTransform: 'uppercase', letterSpacing: '0.08em' }}>
              Completeness — {report.completeness.score}%
            </div>
            <div style={{
              fontSize: 11,
              padding: '3px 10px',
              borderRadius: 4,
              background: report.completeness.score >= 80 ? 'rgba(74,222,128,0.15)' : 'rgba(196,98,45,0.15)',
              color: report.completeness.score >= 80 ? '#4ADE80' : 'var(--terra)',
              fontWeight: 600,
            }}>
              {report.completeness.items.filter(i => i.passed).length}/{report.completeness.items.length} OK
            </div>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {report.completeness.items.map((item, i) => (
              <div key={i} style={{ display: 'flex', alignItems: 'flex-start', gap: 10 }}>
                <span style={{ fontSize: 13, color: item.passed ? '#4ADE80' : 'var(--terra)', flexShrink: 0, marginTop: 1 }}>
                  {item.passed ? '✓' : '✗'}
                </span>
                <div style={{ flex: 1 }}>
                  <span style={{ fontSize: 13, color: item.passed ? 'var(--parch-dim)' : 'var(--parch)' }}>
                    {item.label}
                  </span>
                  {item.detail && (
                    <span style={{ fontSize: 11, color: 'var(--parch-dim)', opacity: 0.6, marginLeft: 8 }}>
                      {item.detail}
                    </span>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Filename */}
      <div style={{
        background: 'rgba(92,52,114,0.08)',
        border: '1px solid rgba(92,52,114,0.2)',
        borderRadius: 8,
        padding: '10px 14px',
        marginBottom: 24,
        display: 'flex',
        alignItems: 'center',
        gap: 10,
      }}>
        <span style={{ fontSize: 18 }}>📄</span>
        <span style={{ fontFamily: 'DM Sans, monospace', fontSize: 13, color: 'var(--parch)' }}>{filename}</span>
      </div>

      {/* Actions */}
      <div style={{ display: 'flex', gap: 12 }}>
        <button className="df-btn-primary" onClick={onDownload} style={{ padding: '12px 32px', fontSize: 15 }}>
          ⬇ Descargar .docx
        </button>
        <button className="df-btn-ghost" onClick={onRegenerate}>
          ↺ Regenerar
        </button>
      </div>
    </div>
  )
}
