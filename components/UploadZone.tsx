'use client'

import { useCallback, useState } from 'react'
import { extractZip } from '@/lib/zipExtractor'

interface UploadZoneProps {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  onDataReady: (data: Record<string, any>) => void
  loading: boolean
}

export default function UploadZone({ onDataReady, loading }: UploadZoneProps) {
  const [dragging, setDragging]       = useState(false)
  const [extracting, setExtracting]   = useState(false)
  const [progress, setProgress]       = useState<{ step: string; pct: number } | null>(null)
  const [stats, setStats]             = useState<{ name: string; images: number; attendees: number; votes: number } | null>(null)
  const [error, setError]             = useState('')

  const handleFile = useCallback(async (file: File) => {
    if (!file.name.toLowerCase().endsWith('.zip')) {
      setError('Sube el archivo .zip de Hypal')
      return
    }
    setError('')
    setExtracting(true)
    setProgress({ step: 'Iniciando extracción…', pct: 0 })

    try {
      const extracted = await extractZip(file, (step, pct) => {
        setProgress({ step, pct })
      })

      setStats({
        name: file.name,
        images: extracted.stats.images_count,
        attendees: extracted.stats.asistencia_rows_count,
        votes: extracted.stats.votaciones_rows_count,
      })

      setExtracting(false)
      setProgress(null)
      onDataReady(extracted)

    } catch (err) {
      setExtracting(false)
      setProgress(null)
      setError(err instanceof Error ? err.message : 'Error al extraer el ZIP')
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

  const isDisabled = loading || extracting

  return (
    <div className="fade-in">

      {/* Logotype */}
      <div style={{ marginBottom: 56, textAlign: 'center' }}>
        <div style={{ lineHeight: 1, marginBottom: 24 }}>
          <div style={{ fontFamily: 'Cormorant Garamond, serif', fontSize: 52, fontWeight: 300, fontStyle: 'italic', color: 'var(--parch)', lineHeight: 1 }}>
            Document
          </div>
          <div style={{ fontFamily: 'DM Sans, sans-serif', fontSize: 42, fontWeight: 700, letterSpacing: '0.22em', textTransform: 'uppercase' as const, color: 'var(--terra)', lineHeight: 1, marginTop: -4 }}>
            FACTORY
          </div>
        </div>
        <p style={{ fontFamily: 'EB Garamond, serif', fontSize: 20, fontStyle: 'italic', color: 'var(--parch-dim)', margin: 0 }}>
          Del ZIP al acta firmable. En minutos.
        </p>
      </div>

      {/* Upload zone */}
      <label
        onDragOver={(e) => { e.preventDefault(); if (!isDisabled) setDragging(true) }}
        onDragLeave={() => setDragging(false)}
        onDrop={handleDrop}
        style={{
          display: 'block',
          border: `2px dashed ${dragging ? 'var(--amatista)' : error ? 'rgba(196,98,45,0.4)' : 'rgba(92,52,114,0.35)'}`,
          borderRadius: 16,
          padding: extracting ? '36px 32px' : '52px 32px',
          textAlign: 'center',
          cursor: isDisabled ? 'not-allowed' : 'pointer',
          background: dragging ? 'rgba(92,52,114,0.07)' : 'rgba(28,34,51,0.5)',
          transition: 'all 0.2s ease',
          backdropFilter: 'blur(8px)',
        }}
      >
        <input
          type="file"
          accept=".zip"
          className="hidden"
          onChange={handleChange}
          disabled={isDisabled}
        />

        {/* Extracting state — progress bar */}
        {extracting && progress ? (
          <div style={{ maxWidth: 400, margin: '0 auto' }}>
            <div style={{ width: 36, height: 36, border: '2px solid rgba(92,52,114,0.3)', borderTop: '2px solid var(--amatista)', borderRadius: '50%', margin: '0 auto 20px', animation: 'spin-slow 1s linear infinite' }} />
            <p style={{ color: 'var(--parch)', fontWeight: 500, margin: '0 0 16px', fontSize: 15 }}>
              {progress.step}
            </p>
            {/* Progress bar */}
            <div style={{ height: 4, background: 'rgba(92,52,114,0.2)', borderRadius: 2, overflow: 'hidden', marginBottom: 8 }}>
              <div style={{
                height: '100%',
                width: `${progress.pct}%`,
                background: 'var(--amatista)',
                borderRadius: 2,
                transition: 'width 0.3s ease',
              }} />
            </div>
            <p style={{ color: 'var(--parch-dim)', fontSize: 12, margin: 0 }}>
              {progress.pct}% — extrayendo en tu máquina, sin subir el ZIP
            </p>
          </div>

        /* Loading (sending to API) */
        ) : loading ? (
          <div style={{ color: 'var(--parch-dim)' }}>
            <div style={{ width: 36, height: 36, border: '2px solid rgba(92,52,114,0.3)', borderTop: '2px solid var(--amatista)', borderRadius: '50%', margin: '0 auto 14px', animation: 'spin-slow 1s linear infinite' }} />
            <p style={{ margin: 0, fontSize: 14 }}>Analizando datos…</p>
          </div>

        /* Success stats */
        ) : stats ? (
          <div>
            <div style={{ fontSize: 36, marginBottom: 10 }}>✅</div>
            <p style={{ color: 'var(--parch)', fontWeight: 500, margin: '0 0 8px', fontSize: 15 }}>
              {stats.name}
            </p>
            <div style={{ display: 'flex', justifyContent: 'center', gap: 20, flexWrap: 'wrap' as const }}>
              {[
                { label: 'Asistentes', val: stats.attendees },
                { label: 'Votaciones', val: stats.votes },
                { label: 'Imágenes', val: stats.images },
              ].map(s => (
                <div key={s.label} style={{ textAlign: 'center' }}>
                  <div style={{ fontSize: 22, fontWeight: 700, color: 'var(--amatista-light)' }}>{s.val}</div>
                  <div style={{ fontSize: 11, color: 'var(--parch-dim)' }}>{s.label}</div>
                </div>
              ))}
            </div>
            <p style={{ color: 'var(--parch-dim)', fontSize: 12, margin: '12px 0 0' }}>
              Extracción completada · Procesando…
            </p>
          </div>

        /* Error */
        ) : error ? (
          <div>
            <div style={{ width: 56, height: 56, background: 'rgba(196,98,45,0.1)', borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 18px', fontSize: 24 }}>
              ⚠️
            </div>
            <p style={{ color: 'var(--terra)', fontWeight: 500, margin: '0 0 6px', fontSize: 16 }}>
              {error}
            </p>
            <p style={{ color: 'var(--parch-dim)', fontSize: 13, margin: 0 }}>
              Verifica que sea el ZIP exportado por Hypal
            </p>
          </div>

        /* Default */
        ) : (
          <div>
            <div style={{ width: 56, height: 56, background: 'rgba(92,52,114,0.12)', borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 18px', fontSize: 24 }}>
              📦
            </div>
            <p style={{ color: 'var(--parch)', fontWeight: 500, margin: '0 0 6px', fontSize: 16 }}>
              Arrastra el ZIP de Hypal aquí
            </p>
            <p style={{ color: 'var(--parch-dim)', fontSize: 13, margin: '0 0 4px' }}>
              Extracción local · El ZIP nunca sale de tu máquina
            </p>
            <p style={{ color: 'rgba(200,196,190,0.3)', fontSize: 11, margin: 0, letterSpacing: '0.05em' }}>
              HYPAL_[PH]_[FECHA].zip
            </p>
          </div>
        )}
      </label>

      {/* Capability cards */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: 10, marginTop: 20 }}>
        {[
          { icon: '🔒', label: 'ZIP local', desc: 'Extracción en tu máquina. Los documentos nunca salen de tu PC.' },
          { icon: '⚡', label: 'Paso 0.5 activo', desc: 'Claude formaliza cada intervención en 3ª persona legal.' },
          { icon: '🖼️', label: 'Imágenes incluidas', desc: 'Capturas de votaciones y evidencias se incluyen en el acta.' },
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
