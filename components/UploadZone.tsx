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
      {/* Header */}
      <div className="mb-10">
        <div className="flex items-center gap-3 mb-2">
          <span style={{ color: 'var(--amatista)', fontSize: 28 }}>⬡</span>
          <span style={{
            fontFamily: 'EB Garamond, serif',
            fontSize: 13,
            letterSpacing: '0.15em',
            textTransform: 'uppercase',
            color: 'var(--parch-dim)',
          }}>
            ForumPHs · Document Factory
          </span>
        </div>
        <h1 style={{
          fontFamily: 'EB Garamond, serif',
          fontSize: 42,
          fontWeight: 400,
          color: 'var(--parch)',
          lineHeight: 1.1,
          margin: 0,
        }}>
          Generador de Actas
        </h1>
        <p style={{ color: 'var(--parch-dim)', marginTop: 8, fontSize: 15 }}>
          Sube el ZIP de Hypal para comenzar. El sistema procesará los 6 archivos automáticamente.
        </p>
      </div>

      {/* Upload area */}
      <label
        onDragOver={(e) => { e.preventDefault(); setDragging(true) }}
        onDragLeave={() => setDragging(false)}
        onDrop={handleDrop}
        style={{
          display: 'block',
          border: `2px dashed ${dragging ? 'var(--amatista)' : 'rgba(92,52,114,0.4)'}`,
          borderRadius: 16,
          padding: '56px 32px',
          textAlign: 'center',
          cursor: loading ? 'not-allowed' : 'pointer',
          background: dragging ? 'rgba(92,52,114,0.08)' : 'rgba(28,34,51,0.6)',
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
              width: 40, height: 40,
              border: '3px solid rgba(92,52,114,0.3)',
              borderTop: '3px solid var(--amatista)',
              borderRadius: '50%',
              margin: '0 auto 16px',
              animation: 'spin-slow 1s linear infinite',
            }} />
            <p style={{ margin: 0, fontSize: 15 }}>Procesando ZIP…</p>
          </div>
        ) : fileName ? (
          <div>
            <div style={{ fontSize: 40, marginBottom: 12 }}>📦</div>
            <p style={{ color: 'var(--parch)', fontWeight: 500, margin: '0 0 4px' }}>{fileName}</p>
            <p style={{ color: 'var(--parch-dim)', fontSize: 13, margin: 0 }}>Archivo seleccionado. Procesando…</p>
          </div>
        ) : (
          <div>
            <div style={{
              width: 64, height: 64,
              background: 'rgba(92,52,114,0.15)',
              borderRadius: '50%',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              margin: '0 auto 20px',
              fontSize: 28,
            }}>
              📁
            </div>
            <p style={{ color: 'var(--parch)', fontWeight: 500, margin: '0 0 8px', fontSize: 17 }}>
              Arrastra el ZIP de Hypal aquí
            </p>
            <p style={{ color: 'var(--parch-dim)', fontSize: 13, margin: '0 0 20px' }}>
              o haz clic para seleccionar
            </p>
            <div style={{
              display: 'inline-flex',
              gap: 8,
              flexWrap: 'wrap',
              justifyContent: 'center',
            }}>
              {['Resumen.docx', 'Lista_Asistencia.xlsx', 'Votaciones.xlsx', 'Transcripcion.docx', 'Chats.docx', 'Reporte_Quorum.docx'].map(f => (
                <span key={f} style={{
                  fontSize: 11,
                  padding: '3px 8px',
                  background: 'rgba(92,52,114,0.2)',
                  borderRadius: 4,
                  color: 'var(--parch-dim)',
                  fontFamily: 'DM Sans, monospace',
                }}>
                  {f}
                </span>
              ))}
            </div>
          </div>
        )}
      </label>

      {/* Info cards */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: 12, marginTop: 24 }}>
        {[
          { icon: '⚡', label: 'Paso 0.5 activo', desc: 'Claude API formaliza cada intervención' },
          { icon: '🔍', label: 'QA 100%', desc: 'Lectura absoluta antes de entregar' },
          { icon: '💬', label: 'Interactivo', desc: 'Solicita info faltante antes de generar' },
        ].map(card => (
          <div key={card.label} style={{
            background: 'rgba(28,34,51,0.8)',
            border: '1px solid rgba(92,52,114,0.2)',
            borderRadius: 10,
            padding: '14px 16px',
          }}>
            <div style={{ fontSize: 20, marginBottom: 6 }}>{card.icon}</div>
            <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--parch)', marginBottom: 3 }}>{card.label}</div>
            <div style={{ fontSize: 11, color: 'var(--parch-dim)' }}>{card.desc}</div>
          </div>
        ))}
      </div>
    </div>
  )
}
