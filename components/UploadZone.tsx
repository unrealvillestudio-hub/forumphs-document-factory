'use client'

import { useCallback, useState } from 'react'
import { extractZip } from '@/lib/zipExtractor'
import type { ExtractedData } from '@/lib/zipExtractor'

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
  const [dragging, setDragging]               = useState(false)
  const [extracting, setExtracting]           = useState(false)
  const [progress, setProgress]               = useState<{ step: string; pct: number } | null>(null)
  const [stats, setStats]                     = useState<ExtractionStats | null>(null)
  const [extracted, setExtracted]             = useState<ExtractedData | null>(null)
  const [error, setError]                     = useState('')

  const handleFile = useCallback(async (file: File) => {
    if (!file.name.toLowerCase().endsWith('.zip')) { setError('Sube el archivo .zip de Hypal'); return }
    setError(''); setExtracted(null); setStats(null)
    setExtracting(true); setProgress({ step: 'Iniciando extracción…', pct: 0 })

    try {
      const data = await extractZip(file, (step, pct) => setProgress({ step, pct }))
      setStats({
        name: file.name,
        transcripcion: data.stats.transcripcion_found,
        resumen: data.stats.resumen_found,
        asistentes: data.stats.asistencia_rows_count,
        votaciones: data.stats.votaciones_rows_count,
        imagenes: data.stats.images_count,
        archivos: data.stats.files_detected,
      })
      setExtracted(data)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error al extraer el ZIP')
    } finally {
      setExtracting(false); setProgress(null)
    }
  }, [])

  const handleContinue = () => {
    if (extracted) onDataReady(extracted)
  }

  const handleReset = () => {
    setStats(null); setExtracted(null); setError('')
  }

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault(); setDragging(false)
    const file = e.dataTransfer.files[0]; if (file) handleFile(file)
  }, [handleFile])

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]; if (file) handleFile(file)
  }

  const isDisabled = loading || extracting

  // ── Render helpers ─────────────────────────────────────────────────────────

  const renderStatRow = (label: string, val: string | number, ok: boolean) => (
    <div key={label} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '9px 0', borderBottom: '1px solid rgba(200,196,190,0.07)' }}>
      <span style={{ fontSize: 13, color: 'var(--parch-dim)' }}>{label}</span>
      <span style={{ fontSize: 13, fontWeight: 600, color: ok ? 'var(--amatista-light)' : 'var(--terra)' }}>{val}</span>
    </div>
  )

  return (
    <div className="fade-in">

      {/* ── Product header ─────────────────────────────────────────────── */}
      <div style={{ marginBottom: 44, textAlign: 'center' }}>
        <div style={{ marginBottom: 24 }}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/FPHS_logo-wt.png" alt="ForumPHs" style={{ height: 28, width: 'auto', opacity: 0.85, marginBottom: 16 }} />
        </div>
        <div style={{ position: 'relative', marginBottom: 14 }}>
          <div style={{ position: 'absolute', inset: 0, background: 'radial-gradient(ellipse 60% 50% at 50% 60%, rgba(92,52,114,0.18) 0%, transparent 70%)', pointerEvents: 'none' }} />
          <div style={{ position: 'relative' }}>
            <div style={{ fontFamily: 'DM Sans, sans-serif', fontSize: 'clamp(40px, 8vw, 68px)', fontWeight: 800, letterSpacing: '-0.02em', lineHeight: 0.95, color: 'var(--parch)', textTransform: 'uppercase' as const }}>Document</div>
            <div style={{ fontFamily: 'DM Sans, sans-serif', fontSize: 'clamp(40px, 8vw, 68px)', fontWeight: 800, letterSpacing: '-0.02em', lineHeight: 0.95, background: 'linear-gradient(135deg, var(--terra) 0%, #E8855A 50%, var(--amatista-light) 100%)', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent', backgroundClip: 'text', textTransform: 'uppercase' as const }}>Factory</div>
          </div>
        </div>
        <p style={{ fontFamily: 'EB Garamond, serif', fontSize: 18, fontStyle: 'italic', color: 'var(--parch-dim)', margin: '0 0 10px' }}>Del ZIP al acta firmable. En minutos.</p>
        <div style={{ display: 'flex', justifyContent: 'center', gap: 8, flexWrap: 'wrap' as const }}>
          {['ZIP local · sin uploads', 'Claude 3ª persona legal', 'ICR · QA · DOCX'].map(b => (
            <span key={b} style={{ fontSize: 10, letterSpacing: '0.08em', textTransform: 'uppercase' as const, color: 'rgba(200,196,190,0.35)', padding: '3px 10px', border: '1px solid rgba(200,196,190,0.1)', borderRadius: 20 }}>{b}</span>
          ))}
        </div>
      </div>

      {/* ── Extraction result — stats + confirm ─────────────────────────── */}
      {stats && extracted && !loading ? (
        <div className="fade-in">
          {/* Stats card */}
          <div style={{ background: 'rgba(28,34,51,0.6)', border: '1px solid rgba(92,52,114,0.25)', borderRadius: 14, padding: '20px 24px', marginBottom: 16 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 16 }}>
              <div style={{ fontSize: 22 }}>📦</div>
              <div>
                <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--parch)' }}>{stats.name}</div>
                <div style={{ fontSize: 11, color: 'var(--parch-dim)' }}>Extracción completada</div>
              </div>
              <button onClick={handleReset} style={{ marginLeft: 'auto', background: 'transparent', border: '1px solid rgba(200,196,190,0.15)', borderRadius: 6, color: 'var(--parch-dim)', fontSize: 11, padding: '4px 10px', cursor: 'pointer' }}>↺ Cambiar</button>
            </div>

            {/* Stat rows */}
            <div>
              {renderStatRow('Transcripción', stats.transcripcion ? '✓ Detectada' : '✗ No encontrada', stats.transcripcion)}
              {renderStatRow('Resumen', stats.resumen ? '✓ Detectado' : '✗ No encontrado', stats.resumen)}
              {renderStatRow('Asistentes', stats.asistentes > 0 ? `${stats.asistentes} registros` : '0', stats.asistentes > 0)}
              {renderStatRow('Votaciones', stats.votaciones > 0 ? `${stats.votaciones} registros` : '0', true)}
              {renderStatRow('Imágenes', stats.imagenes > 0 ? `${stats.imagenes} archivo${stats.imagenes > 1 ? 's' : ''}` : '0', true)}
            </div>

            {/* Warnings */}
            {!stats.transcripcion && (
              <div style={{ marginTop: 14, background: 'rgba(196,98,45,0.1)', border: '1px solid rgba(196,98,45,0.25)', borderRadius: 8, padding: '10px 14px', fontSize: 12, color: 'var(--terra)' }}>
                ⚠ No se detectó transcripción. El acta se generará sin el debate de los propietarios.<br />
                <span style={{ color: 'rgba(196,98,45,0.6)', fontSize: 11 }}>Archivos en el ZIP: {stats.archivos.slice(0, 6).join(', ')}{stats.archivos.length > 6 ? '…' : ''}</span>
              </div>
            )}
            {!stats.resumen && (
              <div style={{ marginTop: 10, background: 'rgba(255,193,7,0.08)', border: '1px solid rgba(255,193,7,0.2)', borderRadius: 8, padding: '8px 14px', fontSize: 12, color: '#FFC107' }}>
                ⚠ No se detectó el Resumen de la Asamblea. Algunos metadatos deberán completarse en Pre-flight.
              </div>
            )}
          </div>

          {/* CTA */}
          <button
            onClick={handleContinue}
            disabled={loading}
            style={{ width: '100%', padding: '14px 32px', background: 'var(--amatista)', border: 'none', borderRadius: 10, color: '#fff', fontSize: 15, fontWeight: 700, fontFamily: 'DM Sans, sans-serif', cursor: loading ? 'not-allowed' : 'pointer', letterSpacing: '0.02em', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, opacity: loading ? 0.7 : 1 }}
          >
            {loading ? (
              <><div style={{ width: 16, height: 16, border: '2px solid rgba(255,255,255,0.3)', borderTop: '2px solid #fff', borderRadius: '50%', animation: 'spin-slow 1s linear infinite' }} />Analizando…</>
            ) : (
              <>Continuar al Pre-flight →</>
            )}
          </button>
        </div>

      ) : (
        <>
          {/* ── Upload zone ──────────────────────────────────────────────── */}
          <label
            onDragOver={(e) => { e.preventDefault(); if (!isDisabled) setDragging(true) }}
            onDragLeave={() => setDragging(false)}
            onDrop={handleDrop}
            style={{ display: 'block', border: `2px dashed ${dragging ? 'var(--amatista)' : error ? 'rgba(196,98,45,0.4)' : 'rgba(92,52,114,0.35)'}`, borderRadius: 16, padding: extracting ? '36px 32px' : '48px 32px', textAlign: 'center', cursor: isDisabled ? 'not-allowed' : 'pointer', background: dragging ? 'rgba(92,52,114,0.07)' : 'rgba(28,34,51,0.5)', transition: 'all 0.2s ease', backdropFilter: 'blur(8px)' }}
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

          {/* Cards */}
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
        </>
      )}
    </div>
  )
}
