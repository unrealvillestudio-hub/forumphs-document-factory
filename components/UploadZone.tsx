'use client'

import { useCallback, useState } from 'react'

interface UploadZoneProps {
  onDataReady: (data: Record<string, unknown>) => void
  loading: boolean
}

export default function UploadZone({ onDataReady, loading }: UploadZoneProps) {
  const [dragging, setDragging] = useState(false)
  const [fileName, setFileName] = useState<string | null>(null)
  const [error, setError] = useState('')

  const handleFile = useCallback(async (file: File) => {
    if (!file.name.endsWith('.json')) {
      setError('Sube el archivo .json generado por el ZIP Extractor')
      return
    }
    setError('')
    setFileName(file.name)
    try {
      const text = await file.text()
      const data = JSON.parse(text)
      onDataReady(data)
    } catch {
      setError('El archivo JSON no es válido')
    }
  }, [onDataReady])

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    setDragging(false)
    const file = e.dataTransfer.files[0]
    if (file) handleFile(file)
  }, [handleFile])

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (file) handleFile(file)
  }

  return (
    <div className="fade-in">

      {/* Logotype */}
      <div style={{ marginBottom: 56, textAlign: 'center' }}>
        <div style={{ display: 'inline-flex', alignItems: 'center', gap: 8, marginBottom: 20 }}>
          <span style={{
            display: 'inline-block', width: 6, height: 6, borderRadius: '50%',
            background: 'var(--amatista)', animation: 'prompt-blink 1.1s step-end infinite',
          }} />
          <span style={{ fontFamily: 'DM Sans, sans-serif', fontSize: 11, fontWeight: 500, letterSpacing: '0.2em', textTransform: 'uppercase' as const, color: 'var(--amatista-light)' }}>
            ForumPHs
          </span>
        </div>
        <div style={{ lineHeight: 1, marginBottom: 24 }}>
          <div style={{ fontFamily: 'Cormorant Garamond, serif', fontSize: 56, fontWeight: 300, fontStyle: 'italic', color: 'var(--parch)', lineHeight: 1 }}>
            Document
          </div>
          <div style={{ fontFamily: 'DM Sans, sans-serif', fontSize: 44, fontWeight: 700, letterSpacing: '0.22em', textTransform: 'uppercase' as const, color: 'var(--amatista-light)', lineHeight: 1, marginTop: -4 }}>
            FACTORY
          </div>
        </div>
        <p style={{ fontFamily: 'EB Garamond, serif', fontSize: 20, fontStyle: 'italic', color: 'var(--parch-dim)', margin: 0 }}>
          Del ZIP al acta firmable. En minutos.
        </p>
      </div>

      {/* Upload zone */}
      <label
        onDragOver={(e) => { e.preventDefault(); setDragging(true) }}
        onDragLeave={() => setDragging(false)}
        onDrop={handleDrop}
        style={{
          display: 'block',
          border: `2px dashed ${dragging ? 'var(--amatista)' : error ? 'rgba(196,98,45,0.4)' : 'rgba(92,52,114,0.35)'}`,
          borderRadius: 16, padding: '52px 32px', textAlign: 'center',
          cursor: loading ? 'not-allowed' : 'pointer',
          background: dragging ? 'rgba(92,52,114,0.07)' : 'rgba(28,34,51,0.5)',
          transition: 'all 0.2s ease', backdropFilter: 'blur(8px)',
        }}
      >
        <input type="file" accept=".json" className="hidden" onChange={handleChange} disabled={loading} />

        {loading ? (
          <div style={{ color: 'var(--parch-dim)' }}>
            <div style={{ width: 36, height: 36, border: '2px solid rgba(92,52,114,0.3)', borderTop: '2px solid var(--amatista)', borderRadius: '50%', margin: '0 auto 14px', animation: 'spin-slow 1s linear infinite' }} />
            <p style={{ margin: 0, fontSize: 14 }}>Analizando datos…</p>
          </div>
        ) : fileName && !error ? (
          <div>
            <div style={{ fontSize: 36, marginBottom: 10 }}>✅</div>
            <p style={{ color: 'var(--parch)', fontWeight: 500, margin: '0 0 4px', fontSize: 15 }}>{fileName}</p>
            <p style={{ color: 'var(--parch-dim)', fontSize: 12, margin: 0 }}>JSON cargado. Procesando…</p>
          </div>
        ) : (
          <div>
            <div style={{ width: 56, height: 56, background: 'rgba(92,52,114,0.12)', borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 18px', fontSize: 24 }}>
              {error ? '⚠️' : '{}'}
            </div>
            <p style={{ color: error ? 'var(--terra)' : 'var(--parch)', fontWeight: 500, margin: '0 0 6px', fontSize: 16 }}>
              {error || 'Arrastra el parsed.json aquí'}
            </p>
            <p style={{ color: 'var(--parch-dim)', fontSize: 13, margin: '0 0 4px' }}>
              {error ? 'Genera el JSON con el ZIP Extractor primero' : 'Generado por ForumPHs ZIP Extractor'}
            </p>
            <p style={{ color: 'rgba(200,196,190,0.3)', fontSize: 11, margin: 0, letterSpacing: '0.05em' }}>
              HYPAL_[PH]_[FECHA].json
            </p>
          </div>
        )}
      </label>

      {/* Capability cards */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: 10, marginTop: 20 }}>
        {[
          { icon: '⚡', label: 'Paso 0.5 activo', desc: 'Claude API formaliza cada intervención en 3ª persona legal' },
          { icon: '🔍', label: 'QA 100% absoluto', desc: 'Completeness score + lectura de cada oración antes de entregar' },
          { icon: '💬', label: 'Interactivo', desc: 'Solicita información faltante (Finca, convocatoria, hora cierre)' },
        ].map(card => (
          <div key={card.label} style={{ background: 'rgba(28,34,51,0.7)', border: '1px solid rgba(92,52,114,0.18)', borderRadius: 10, padding: '14px 16px' }}>
            <div style={{ fontSize: 18, marginBottom: 6 }}>{card.icon}</div>
            <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--parch)', marginBottom: 3 }}>{card.label}</div>
            <div style={{ fontSize: 11, color: 'var(--parch-dim)', lineHeight: 1.4 }}>{card.desc}</div>
          </div>
        ))}
      </div>
    </div>
  )
}
