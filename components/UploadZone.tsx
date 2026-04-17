'use client'

import { useCallback, useState } from 'react'
import { extractZip } from '@/lib/zipExtractor'

interface UploadZoneProps {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  onDataReady: (data: Record<string, any>) => void
  loading: boolean
}

interface ExtractionStats {
  name: string
  transcripcion: boolean
  resumen: boolean
  asistentes: number
  votaciones: number
  imagenes: number
  archivos: string[]
}

export default function UploadZone({ onDataReady, loading }: UploadZoneProps) {
  const [dragging, setDragging]     = useState(false)
  const [extracting, setExtracting] = useState(false)
  const [progress, setProgress]     = useState<{ step: string; pct: number } | null>(null)
  const [stats, setStats]           = useState<ExtractionStats | null>(null)
  const [error, setError]           = useState('')

  const handleFile = useCallback(async (file: File) => {
    if (!file.name.toLowerCase().endsWith('.zip')) { setError('Sube el archivo .zip de Hypal'); return }
    setError(''); setExtracting(true); setProgress({ step: 'Iniciando extracción…', pct: 0 })
    try {
      const extracted = await extractZip(file, (step, pct) => setProgress({ step, pct }))
      setStats({
        name: file.name,
        transcripcion: extracted.stats.transcripcion_found,
        resumen: extracted.stats.resumen_found,
        asistentes: extracted.stats.asistencia_rows_count,
        votaciones: extracted.stats.votaciones_rows_count,
        imagenes: extracted.stats.images_count,
        archivos: extracted.stats.files_detected,
      })
      setExtracting(false); setProgress(null)
      onDataReady(extracted)
    } catch (err) {
      setExtracting(false); setProgress(null)
      setError(err instanceof Error ? err.message : 'Error al extraer el ZIP')
    }
  }, [onDataReady])

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault(); setDragging(false)
    const file = e.dataTransfer.files[0]; if (file) handleFile(file)
  }, [handleFile])

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]; if (file) handleFile(file)
  }

  const isDisabled = loading || extracting

  return (
    <div className="fade-in">

      {/* ── Product header ──────────────────────────────────────────────── */}
      <div style={{ marginBottom: 52, textAlign: 'center' }}>

        {/* ForumPHs wordmark */}
        <div style={{ marginBottom: 28 }}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/FPHS_logo-wt.png" alt="ForumPHs" style={{ height: 28, width: 'auto', opacity: 0.85, marginBottom: 20 }} />
        </div>

        {/* Product name — "Big News" scale */}
        <div style={{ position: 'relative', marginBottom: 18 }}>
          {/* Background glow */}
          <div style={{
            position: 'absolute', inset: 0,
            background: 'radial-gradient(ellipse 60% 50% at 50% 60%, rgba(92,52,114,0.18) 0%, transparent 70%)',
            pointerEvents: 'none',
          }} />
          <div style={{ position: 'relative' }}>
            <div style={{
              fontFamily: 'DM Sans, sans-serif',
              fontSize: 'clamp(42px, 8vw, 72px)',
              fontWeight: 800,
              letterSpacing: '-0.02em',
              lineHeight: 0.95,
              color: 'var(--parch)',
              textTransform: 'uppercase' as const,
            }}>
              Document
            </div>
            <div style={{
              fontFamily: 'DM Sans, sans-serif',
              fontSize: 'clamp(42px, 8vw, 72px)',
              fontWeight: 800,
              letterSpacing: '-0.02em',
              lineHeight: 0.95,
              background: 'linear-gradient(135deg, var(--terra) 0%, #E8855A 50%, var(--amatista-light) 100%)',
              WebkitBackgroundClip: 'text',
              WebkitTextFillColor: 'transparent',
              backgroundClip: 'text',
              textTransform: 'uppercase' as const,
            }}>
              Factory
            </div>
          </div>
        </div>

        {/* Tagline */}
        <p style={{
          fontFamily: 'EB Garamond, serif',
          fontSize: 19,
          fontStyle: 'italic',
          color: 'var(--parch-dim)',
          margin: '0 0 10px',
          letterSpacing: '0.01em',
        }}>
          Del ZIP al acta firmable. En minutos.
        </p>

        {/* Badges */}
        <div style={{ display: 'flex', justifyContent: 'center', gap: 8, flexWrap: 'wrap' as const }}>
          {['ZIP local · sin uploads', 'Claude 3ª persona legal', 'ICR · QA · DOCX'].map(b => (
            <span key={b} style={{
              fontSize: 10, letterSpacing: '0.08em', textTransform: 'uppercase' as const,
              color: 'rgba(200,196,190,0.35)', padding: '3px 10px',
              border: '1px solid rgba(200,196,190,0.1)', borderRadius: 20,
            }}>{b}</span>
          ))}
        </div>
      </div>

      {/* ── Upload zone ──────────────────────────────────────────────────── */}
      <label
        onDragOver={(e) => { e.preventDefault(); if (!isDisabled) setDragging(true) }}
        onDragLeave={() => setDragging(false)}
        onDrop={handleDrop}
        style={{
          display: 'block',
          border: `2px dashed ${dragging ? 'var(--amatista)' : error ? 'rgba(196,98,45,0.4)' : 'rgba(92,52,114,0.35)'}`,
          borderRadius: 16, padding: extracting ? '36px 32px' : '48px 32px',
          textAlign: 'center', cursor: isDisabled ? 'not-allowed' : 'pointer',
          background: dragging ? 'rgba(92,52,114,0.07)' : 'rgba(28,34,51,0.5)',
          transition: 'all 0.2s ease', backdropFilter: 'blur(8px)',
        }}
      >
        <input type="file" accept=".zip" className="hidden" onChange={handleChange} disabled={isDisabled} />

        {extracting && progress ? (
          <div style={{ maxWidth: 400, margin: '0 auto' }}>
            <div style={{ width: 36, height: 36, border: '2px solid rgba(92,52,114,0.3)', borderTop: '2px solid var(--amatista)', borderRadius: '50%', margin: '0 auto 20px', animation: 'spin-slow 1s linear infinite' }} />
            <p style={{ color: 'var(--parch)', fontWeight: 500, margin: '0 0 16px', fontSize: 15 }}>{progress.step}</p>
            <div style={{ height: 4, background: 'rgba(92,52,114,0.2)', borderRadius: 2, overflow: 'hidden', marginBottom: 8 }}>
              <div style={{ height: '100%', width: `${progress.pct}%`, background: 'var(--amatista)', borderRadius: 2, transition: 'width 0.3s ease' }} />
            </div>
            <p style={{ color: 'var(--parch-dim)', fontSize: 12, margin: 0 }}>{progress.pct}% — extrayendo en tu máquina</p>
          </div>

        ) : loading ? (
          <div style={{ color: 'var(--parch-dim)' }}>
            <div style={{ width: 36, height: 36, border: '2px solid rgba(92,52,114,0.3)', borderTop: '2px solid var(--amatista)', borderRadius: '50%', margin: '0 auto 14px', animation: 'spin-slow 1s linear infinite' }} />
            <p style={{ margin: 0, fontSize: 14 }}>Analizando datos…</p>
          </div>

        ) : stats ? (
          <div>
            <div style={{ fontSize: 28, marginBottom: 10 }}>✅</div>
            <p style={{ color: 'var(--parch)', fontWeight: 500, margin: '0 0 14px', fontSize: 14 }}>{stats.name}</p>
            <div style={{ display: 'flex', justifyContent: 'center', gap: 16, flexWrap: 'wrap' as const, marginBottom: 12 }}>
              {[
                { label: 'Transcripción', val: stats.transcripcion ? '✓' : '✗', ok: stats.transcripcion },
                { label: 'Resumen',       val: stats.resumen       ? '✓' : '✗', ok: stats.resumen },
                { label: 'Asistentes',   val: String(stats.asistentes), ok: stats.asistentes > 0 },
                { label: 'Votaciones',   val: String(stats.votaciones), ok: true },
                { label: 'Imágenes',     val: String(stats.imagenes),   ok: true },
              ].map(s => (
                <div key={s.label} style={{ textAlign: 'center' }}>
                  <div style={{ fontSize: 18, fontWeight: 700, color: s.ok ? 'var(--amatista-light)' : 'var(--terra)' }}>{s.val}</div>
                  <div style={{ fontSize: 10, color: 'var(--parch-dim)' }}>{s.label}</div>
                </div>
              ))}
            </div>
            {!stats.transcripcion && (
              <div style={{ background: 'rgba(196,98,45,0.1)', border: '1px solid rgba(196,98,45,0.3)', borderRadius: 8, padding: '8px 14px', fontSize: 12, color: 'var(--terra)', marginBottom: 10 }}>
                ⚠ Transcripción no detectada · Archivos: {stats.archivos.join(', ')}
              </div>
            )}
            <p style={{ color: 'var(--parch-dim)', fontSize: 12, margin: 0 }}>Extracción completada · Procesando…</p>
          </div>

        ) : error ? (
          <div>
            <div style={{ width: 56, height: 56, background: 'rgba(196,98,45,0.1)', borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 18px', fontSize: 24 }}>⚠️</div>
            <p style={{ color: 'var(--terra)', fontWeight: 500, margin: '0 0 6px', fontSize: 16 }}>{error}</p>
            <p style={{ color: 'var(--parch-dim)', fontSize: 13, margin: 0 }}>Verifica que sea el ZIP exportado por Hypal</p>
          </div>

        ) : (
          <div>
            <div style={{ width: 56, height: 56, background: 'rgba(92,52,114,0.12)', borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 18px', fontSize: 24 }}>📦</div>
            <p style={{ color: 'var(--parch)', fontWeight: 500, margin: '0 0 6px', fontSize: 16 }}>Arrastra el ZIP de Hypal aquí</p>
            <p style={{ color: 'var(--parch-dim)', fontSize: 13, margin: '0 0 4px' }}>Extracción local · El ZIP nunca sale de tu máquina</p>
            <p style={{ color: 'rgba(200,196,190,0.3)', fontSize: 11, margin: 0, letterSpacing: '0.05em' }}>HYPAL_[PH]_[FECHA].zip</p>
          </div>
        )}
      </label>

      {/* ── Capability cards ─────────────────────────────────────────────── */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: 10, marginTop: 20 }}>
        {[
          { icon: '🔒', label: 'ZIP local', desc: 'Extracción en tu máquina. El ZIP nunca sale de tu PC.' },
          { icon: '⚡', label: 'Paso 0.5 activo', desc: 'Claude formaliza cada intervención en 3ª persona legal.' },
          { icon: '🖼️', label: 'Imágenes incluidas', desc: 'Capturas de votaciones se incluyen en el acta.' },
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
