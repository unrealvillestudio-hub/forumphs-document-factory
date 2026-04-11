'use client'

import { useCallback, useState } from 'react'

interface UploadZoneProps {
  onFileSelected: (file: File) => void
  loading: boolean
}

export default function UploadZone({ onFileSelected, loading }: UploadZoneProps) {
  const [dragging, setDragging] = useState(false)
  const [fileName, setFileName] = useState<string | null>(null)

  const handleFile = useCallback((file: File) => {
    if (!file.name.endsWith('.zip')) {
      alert('Por favor sube un archivo .zip de Hypal')
      return
    }
    setFileName(file.name)
    onFileSelected(file)
  }, [onFileSelected])

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

      {/* ── LOGOTYPE BLOCK ── */}
      <div style={{ marginBottom: 56, textAlign: 'center' }}>

        {/* Parent brand label */}
        <div style={{
          display: 'inline-flex',
          alignItems: 'center',
          gap: 8,
          marginBottom: 20,
        }}>
          <span style={{
            display: 'inline-block',
            width: 6, height: 6,
            borderRadius: '50%',
            background: 'var(--amatista)',
            animation: 'prompt-blink 1.1s step-end infinite',
          }} />
          <span style={{
            fontFamily: 'DM Sans, sans-serif',
            fontSize: 11,
            fontWeight: 500,
            letterSpacing: '0.2em',
            textTransform: 'uppercase',
            color: 'var(--amatista-light)',
          }}>
            ForumPHs
          </span>
        </div>

        {/* Logotype: Document FACTORY */}
        <div style={{ lineHeight: 1, marginBottom: 24 }}>
          <div style={{
            fontFamily: 'Cormorant Garamond, serif',
            fontSize: 56,
            fontWeight: 300,
            fontStyle: 'italic',
            color: 'var(--parch)',
            letterSpacing: '-0.01em',
            lineHeight: 1,
          }}>
            Document
          </div>
          <div style={{
            fontFamily: 'DM Sans, sans-serif',
            fontSize: 44,
            fontWeight: 700,
            letterSpacing: '0.22em',
            textTransform: 'uppercase',
            color: 'var(--amatista-light)',
            lineHeight: 1,
            marginTop: -4,
          }}>
            FACTORY
          </div>
        </div>

        {/* Tagline */}
        <p style={{
          fontFamily: 'EB Garamond, serif',
          fontSize: 20,
          fontStyle: 'italic',
          color: 'var(--parch-dim)',
          margin: 0,
          letterSpacing: '0.01em',
        }}>
          Del ZIP al acta firmable. En minutos.
        </p>
      </div>

      {/* ── UPLOAD AREA ── */}
      <label
        onDragOver={(e) => { e.preventDefault(); setDragging(true) }}
        onDragLeave={() => setDragging(false)}
        onDrop={handleDrop}
        style={{
          display: 'block',
          border: `2px dashed ${dragging ? 'var(--amatista)' : 'rgba(92,52,114,0.35)'}`,
          borderRadius: 16,
          padding: '48px 32px',
          textAlign: 'center',
          cursor: loading ? 'not-allowed' : 'pointer',
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
          disabled={loading}
        />

        {loading ? (
          <div style={{ color: 'var(--parch-dim)' }}>
            <div style={{
              width: 36, height: 36,
              border: '2px solid rgba(92,52,114,0.3)',
              borderTop: '2px solid var(--amatista)',
              borderRadius: '50%',
              margin: '0 auto 14px',
              animation: 'spin-slow 1s linear infinite',
            }} />
            <p style={{ margin: 0, fontSize: 14 }}>Procesando ZIP…</p>
          </div>
        ) : fileName ? (
          <div>
            <div style={{ fontSize: 36, marginBottom: 10 }}>📦</div>
            <p style={{ color: 'var(--parch)', fontWeight: 500, margin: '0 0 4px', fontSize: 15 }}>{fileName}</p>
            <p style={{ color: 'var(--parch-dim)', fontSize: 12, margin: 0 }}>Procesando…</p>
          </div>
        ) : (
          <div>
            <div style={{
              width: 56, height: 56,
              background: 'rgba(92,52,114,0.12)',
              borderRadius: '50%',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              margin: '0 auto 18px',
              fontSize: 24,
            }}>
              📁
            </div>
            <p style={{ color: 'var(--parch)', fontWeight: 500, margin: '0 0 6px', fontSize: 16 }}>
              Arrastra el ZIP de Hypal aquí
            </p>
            <p style={{ color: 'var(--parch-dim)', fontSize: 13, margin: '0 0 18px' }}>
              o haz clic para seleccionar
            </p>
            <div style={{ display: 'inline-flex', gap: 6, flexWrap: 'wrap', justifyContent: 'center' }}>
              {['Resumen.docx','Lista_Asistencia.xlsx','Votaciones.xlsx','Transcripcion.docx','Chats.docx','Quorum.docx'].map(f => (
                <span key={f} style={{
                  fontSize: 10,
                  padding: '3px 8px',
                  background: 'rgba(92,52,114,0.15)',
                  borderRadius: 4,
                  color: 'var(--parch-dim)',
                  fontFamily: 'DM Sans, monospace',
                  letterSpacing: '0.02em',
                }}>
                  {f}
                </span>
              ))}
            </div>
          </div>
        )}
      </label>

      {/* ── CAPABILITY CARDS ── */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: 10, marginTop: 20 }}>
        {[
          { icon: '⚡', label: 'Paso 0.5 activo', desc: 'Claude API formaliza cada intervención en 3ª persona legal' },
          { icon: '🔍', label: 'QA 100% absoluto', desc: 'Lectura de cada oración + completeness score antes de entregar' },
          { icon: '💬', label: 'Interactivo', desc: 'Detecta información faltante y pregunta antes de generar' },
        ].map(card => (
          <div key={card.label} style={{
            background: 'rgba(28,34,51,0.7)',
            border: '1px solid rgba(92,52,114,0.18)',
            borderRadius: 10,
            padding: '14px 16px',
          }}>
            <div style={{ fontSize: 18, marginBottom: 6 }}>{card.icon}</div>
            <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--parch)', marginBottom: 3, fontFamily: 'DM Sans, sans-serif' }}>{card.label}</div>
            <div style={{ fontSize: 11, color: 'var(--parch-dim)', lineHeight: 1.4 }}>{card.desc}</div>
          </div>
        ))}
      </div>
    </div>
  )
}
