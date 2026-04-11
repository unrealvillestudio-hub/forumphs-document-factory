'use client'

import { useState } from 'react'
import type { PreflightGap, ParsedHypalZip } from '@/lib/types'

interface PreflightFormProps {
  gaps: PreflightGap[]
  parsed: ParsedHypalZip
  onSubmit: (answers: Record<string, string | number | boolean>, informe?: string) => void
}

export default function PreflightForm({ gaps, parsed, onSubmit }: PreflightFormProps) {
  const [values, setValues] = useState<Record<string, string | number | boolean>>(() => {
    const init: Record<string, string | number | boolean> = {}
    for (const gap of gaps) {
      if (gap.value !== undefined) init[gap.field] = gap.value
    }
    return init
  })
  const [informe, setInforme] = useState('')

  const s = parsed.skeleton

  const set = (field: string, value: string | number | boolean) => {
    setValues(prev => ({ ...prev, [field]: value }))
  }

  const requiredFilled = gaps
    .filter(g => g.required)
    .every(g => values[g.field] !== undefined && values[g.field] !== '')

  return (
    <div className="fade-in">
      {/* Header */}
      <div style={{ marginBottom: 32 }}>
        <div style={{
          display: 'inline-flex',
          alignItems: 'center',
          gap: 8,
          background: 'rgba(196,98,45,0.15)',
          border: '1px solid rgba(196,98,45,0.3)',
          borderRadius: 8,
          padding: '6px 14px',
          marginBottom: 16,
        }}>
          <span style={{ fontSize: 14 }}>⚠️</span>
          <span style={{ fontSize: 12, color: 'var(--terra)', fontWeight: 500, letterSpacing: '0.05em' }}>
            PRE-FLIGHT · {gaps.filter(g => g.required).length} CAMPOS REQUERIDOS
          </span>
        </div>

        <h2 style={{
          fontFamily: 'EB Garamond, serif',
          fontSize: 32,
          fontWeight: 400,
          color: 'var(--parch)',
          margin: '0 0 8px',
        }}>
          Información necesaria
        </h2>
        <p style={{ color: 'var(--parch-dim)', fontSize: 14, margin: 0 }}>
          El ZIP de Hypal fue procesado. Para generar el acta al 95%+ de accuracy, necesito estos datos de Ivette.
        </p>
      </div>

      {/* Summary card */}
      <div style={{
        background: 'rgba(92,52,114,0.1)',
        border: '1px solid rgba(92,52,114,0.3)',
        borderRadius: 10,
        padding: '16px 20px',
        marginBottom: 28,
        display: 'grid',
        gridTemplateColumns: 'repeat(3, 1fr)',
        gap: 16,
      }}>
        <div>
          <div style={{ fontSize: 11, color: 'var(--parch-dim)', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 4 }}>PH</div>
          <div style={{ fontSize: 14, color: 'var(--parch)', fontWeight: 500 }}>{s.ph_name}</div>
        </div>
        <div>
          <div style={{ fontSize: 11, color: 'var(--parch-dim)', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 4 }}>Tipo</div>
          <div style={{ fontSize: 14, color: 'var(--parch)', fontWeight: 500 }}>{s.assembly_type}</div>
        </div>
        <div>
          <div style={{ fontSize: 11, color: 'var(--parch-dim)', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 4 }}>Fecha</div>
          <div style={{ fontSize: 14, color: 'var(--parch)', fontWeight: 500 }}>{s.date_str}</div>
        </div>
        <div>
          <div style={{ fontSize: 11, color: 'var(--parch-dim)', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 4 }}>Bloques</div>
          <div style={{ fontSize: 14, color: 'var(--parch)', fontWeight: 500 }}>{parsed.debates.filter(b => !b.skip).length} a formalizar</div>
        </div>
        <div>
          <div style={{ fontSize: 11, color: 'var(--parch-dim)', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 4 }}>Asistentes</div>
          <div style={{ fontSize: 14, color: 'var(--parch)', fontWeight: 500 }}>{parsed.attendance.length} unidades</div>
        </div>
        <div>
          <div style={{ fontSize: 11, color: 'var(--parch-dim)', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 4 }}>Votaciones</div>
          <div style={{ fontSize: 14, color: 'var(--parch)', fontWeight: 500 }}>{parsed.votations.length} registradas</div>
        </div>
      </div>

      {/* Gap fields */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 20, marginBottom: 28 }}>
        {gaps.map(gap => (
          <div key={gap.field}>
            <label className="df-label" style={{ color: gap.required ? 'var(--terra)' : 'var(--parch-dim)' }}>
              {gap.label} {gap.required && <span style={{ color: 'var(--terra)' }}>*</span>}
            </label>
            <p style={{ fontSize: 12, color: 'var(--parch-dim)', margin: '0 0 8px' }}>{gap.description}</p>

            {gap.type === 'textarea' ? (
              <textarea
                className="df-input"
                rows={5}
                placeholder="Pegar texto aquí…"
                value={String(values[gap.field] || '')}
                onChange={e => set(gap.field, e.target.value)}
                style={{ resize: 'vertical', fontFamily: 'DM Sans, sans-serif', fontSize: 13 }}
              />
            ) : gap.type === 'boolean' ? (
              <div style={{ display: 'flex', gap: 12 }}>
                {['Sí', 'No'].map(opt => (
                  <button
                    key={opt}
                    onClick={() => set(gap.field, opt === 'Sí')}
                    style={{
                      padding: '8px 24px',
                      borderRadius: 8,
                      border: values[gap.field] === (opt === 'Sí') ? '2px solid var(--amatista)' : '1px solid rgba(92,52,114,0.3)',
                      background: values[gap.field] === (opt === 'Sí') ? 'rgba(92,52,114,0.2)' : 'transparent',
                      color: 'var(--parch)',
                      cursor: 'pointer',
                      fontFamily: 'DM Sans, sans-serif',
                      fontSize: 14,
                      transition: 'all 0.15s',
                    }}
                  >
                    {opt}
                  </button>
                ))}
              </div>
            ) : (
              <input
                type={gap.type === 'number' ? 'number' : 'text'}
                className="df-input"
                placeholder={gap.type === 'number' ? '0' : 'Escribir aquí…'}
                value={String(values[gap.field] || '')}
                onChange={e => set(gap.field, gap.type === 'number' ? Number(e.target.value) : e.target.value)}
              />
            )}
          </div>
        ))}

        {/* Informe de Gestión */}
        {values['has_informe_gestion'] === true && (
          <div style={{ animation: 'fadeSlideIn 0.3s ease' }}>
            <label className="df-label">Contenido del Informe de Gestión</label>
            <p style={{ fontSize: 12, color: 'var(--parch-dim)', margin: '0 0 8px' }}>
              Pegar el texto del informe escrito de la JD
            </p>
            <textarea
              className="df-input"
              rows={8}
              placeholder="Pegar el informe de gestión aquí…"
              value={informe}
              onChange={e => setInforme(e.target.value)}
              style={{ resize: 'vertical', fontFamily: 'DM Sans, sans-serif', fontSize: 13 }}
            />
          </div>
        )}
      </div>

      {/* Actions */}
      <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
        <button
          className="df-btn-primary"
          onClick={() => onSubmit(values, informe || undefined)}
          disabled={!requiredFilled}
          style={{ padding: '12px 32px', fontSize: 15 }}
        >
          Continuar → Formalizar
        </button>
        {!requiredFilled && (
          <span style={{ fontSize: 12, color: 'var(--parch-dim)' }}>
            Completa los campos requeridos (*)
          </span>
        )}
      </div>
    </div>
  )
}
