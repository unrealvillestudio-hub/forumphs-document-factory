'use client'

import { useState, useCallback, useRef } from 'react'
import JSZip from 'jszip'

type Stage = 'idle' | 'reading' | 'processing' | 'done' | 'error'
interface FileEntry { name: string; content: string; type: 'vtt' | 'txt' | 'other' }

const cinzel = (color = 'rgba(184,176,168,0.55)'): React.CSSProperties => ({
  fontFamily: "'Cinzel', serif",
  fontSize: '9px',
  fontWeight: 600,
  letterSpacing: '0.22em',
  textTransform: 'uppercase' as const,
  color,
})

export default function ActasPage() {
  const [stage, setStage]       = useState<Stage>('idle')
  const [files, setFiles]       = useState<FileEntry[]>([])
  const [result, setResult]     = useState<string>('')
  const [error, setError]       = useState<string>('')
  const [dragOver, setDragOver] = useState(false)
  const [progress, setProgress] = useState(0)
  const fileRef = useRef<HTMLInputElement>(null)

  const generateActa = useCallback(async (entries: FileEntry[], zipName: string) => {
    setStage('processing')
    setProgress(50)
    try {
      const vttFiles = entries.filter(e => e.type === 'vtt')
      const txtFiles = entries.filter(e => e.type === 'txt')
      const transcript = [...vttFiles, ...txtFiles]
        .map(e => e.content)
        .join('\n\n---\n\n')
        .slice(0, 40000)
      const res = await fetch('/api/actas/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ transcript, zip_name: zipName }),
      })
      setProgress(85)
      if (!res.ok) throw new Error('API error ' + res.status)
      const data = await res.json()
      setResult(data.docx_url ?? data.preview ?? '')
      setProgress(100)
      setStage('done')
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Error generando el acta')
      setStage('error')
    }
  }, [])

  const handleZip = useCallback(async (file: File) => {
    setStage('reading')
    setError('')
    setProgress(10)
    try {
      const zip = await JSZip.loadAsync(file)
      const entries: FileEntry[] = []
      const names = Object.keys(zip.files).filter(n => !zip.files[n].dir)
      let i = 0
      for (const name of names) {
        const content = await zip.files[name].async('string')
        const ext = name.split('.').pop()?.toLowerCase() ?? ''
        entries.push({ name, content, type: ext === 'vtt' ? 'vtt' : ext === 'txt' ? 'txt' : 'other' })
        setProgress(10 + Math.round((++i / names.length) * 30))
      }
      setFiles(entries)
      setProgress(40)
      await generateActa(entries, file.name)
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Error procesando el ZIP')
      setStage('error')
    }
  }, [generateActa])

  const onDrop = (e: React.DragEvent) => {
    e.preventDefault()
    setDragOver(false)
    const f = e.dataTransfer.files?.[0]
    if (f?.name.endsWith('.zip')) handleZip(f)
  }
  const onFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0]
    if (f) handleZip(f)
  }

  const heroColor = '#EAD9F5'

  return (
    <div style={{ minHeight: '100vh', background: '#0E1018', color: '#F0EDE8', fontFamily: "'DM Sans', sans-serif", paddingBottom: '80px', position: 'relative', zIndex: 1 }}>

      {/* HERO */}
      <div style={{ position: 'relative', overflow: 'hidden', padding: '56px 0 44px', borderBottom: '1px solid rgba(92,52,114,0.12)' }}>
        <div style={{ position: 'absolute', inset: 0, background: 'radial-gradient(circle at 75% 0%, rgba(92,52,114,0.2), transparent 55%)', pointerEvents: 'none' }} />
        <div style={{ maxWidth: '780px', margin: '0 auto', padding: '0 28px', position: 'relative', zIndex: 1 }}>
          <div style={{ ...cinzel('#C4622D'), marginBottom: '12px', opacity: 0.85, animation: 'fade-in 0.4s ease-out forwards' }}>
            Document Factory · ForumPHs
          </div>
          <div style={{ fontFamily: "'Cormorant Garamond', serif", fontSize: 'clamp(2.5rem, 6vw, 4.5rem)', fontWeight: 300, fontStyle: 'italic', lineHeight: 1.0, color: heroColor, marginBottom: '10px', animation: 'fade-in 0.5s 0.1s ease-out both' }}>
            Del ZIP al acta firmable.
          </div>
          <p style={{ fontFamily: "'EB Garamond', serif", fontSize: '17px', fontStyle: 'italic', color: 'rgba(240,237,232,0.4)', margin: '0 0 20px', animation: 'fade-in 0.5s 0.2s ease-out both' }}>
            Transcripción Hypal → normalización → redacción legal → DOCX
          </p>
          <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', animation: 'fade-in 0.5s 0.3s ease-out both' }}>
            {['ZIP local · sin uploads', 'Claude 3ª persona legal', 'Ley 284 de 2022'].map(tag => (
              <span key={tag} style={{ ...cinzel('rgba(200,196,190,0.35)'), fontSize: '8px', padding: '4px 10px', border: '1px solid rgba(200,196,190,0.1)', borderRadius: '20px', transition: 'border-color 0.2s, color 0.2s', cursor: 'default' }}
                onMouseEnter={e => { const el = e.target as HTMLElement; el.style.borderColor = 'rgba(92,52,114,0.35)'; el.style.color = 'rgba(240,237,232,0.55)' }}
                onMouseLeave={e => { const el = e.target as HTMLElement; el.style.borderColor = 'rgba(200,196,190,0.1)'; el.style.color = 'rgba(200,196,190,0.35)' }}>
                {tag}
              </span>
            ))}
          </div>
        </div>
      </div>

      {/* MAIN */}
      <div style={{ maxWidth: '780px', margin: '0 auto', padding: '32px 28px', display: 'grid', gap: '20px' }}>

        {/* DROP ZONE */}
        {(stage === 'idle' || stage === 'error') && (
          <div style={{ animation: 'snap-in 0.35s ease-out forwards' }}>
            <div
              onDragOver={e => { e.preventDefault(); setDragOver(true) }}
              onDragLeave={() => setDragOver(false)}
              onDrop={onDrop}
              onClick={() => fileRef.current?.click()}
              style={{ border: '2px dashed ' + (dragOver ? '#C4622D' : 'rgba(92,52,114,0.3)'), borderRadius: '14px', padding: '56px 32px', textAlign: 'center', cursor: 'pointer', background: dragOver ? 'rgba(196,98,45,0.06)' : 'rgba(28,34,51,0.5)', transition: 'all 0.2s ease', position: 'relative', overflow: 'hidden' }}>
              <div style={{ position: 'absolute', fontFamily: "'DM Sans', sans-serif", fontSize: '200px', fontWeight: 700, color: 'rgba(92,52,114,0.04)', lineHeight: 1, top: '-30px', right: '-10px', pointerEvents: 'none', userSelect: 'none' }} aria-hidden="true">.zip</div>
              <input ref={fileRef} type="file" accept=".zip" onChange={onFileChange} style={{ display: 'none' }} />
              <div style={{ position: 'relative', zIndex: 1 }}>
                <div style={{ width: '56px', height: '56px', background: 'rgba(92,52,114,0.1)', border: '1px solid rgba(92,52,114,0.3)', borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 18px', transition: 'all 0.2s ease' }}>
                  <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="rgba(92,52,114,0.7)" strokeWidth="1.5">
                    <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
                    <polyline points="17 8 12 3 7 8"/>
                    <line x1="12" y1="3" x2="12" y2="15"/>
                  </svg>
                </div>
                <p style={{ fontSize: '16px', fontWeight: 500, color: '#F0EDE8', margin: '0 0 6px' }}>Arrastra el ZIP de Hypal aquí</p>
                <p style={{ ...cinzel(), fontSize: '8px', margin: '0 0 4px', opacity: 0.5 }}>HYPAL_[PH]_[FECHA].zip</p>
                <p style={{ fontFamily: "'EB Garamond', serif", fontSize: '13px', fontStyle: 'italic', color: 'rgba(240,237,232,0.25)', margin: 0 }}>
                  El ZIP nunca sale de tu máquina
                </p>
              </div>
            </div>
          </div>
        )}

        {/* ERROR */}
        {stage === 'error' && error && (
          <div style={{ background: 'rgba(196,98,45,0.07)', border: '1px solid rgba(196,98,45,0.25)', borderLeft: '3px solid #C4622D', borderRadius: '8px', padding: '14px 18px', fontSize: '13px', color: '#C4622D', animation: 'snap-in 0.3s ease-out forwards' }}>
            {error}
          </div>
        )}

        {/* PROCESSING */}
        {(stage === 'reading' || stage === 'processing') && (
          <div style={{ background: '#1C2233', border: '1px solid rgba(92,52,114,0.2)', borderRadius: '12px', padding: '36px 32px', textAlign: 'center', animation: 'fade-in 0.3s ease-out forwards' }}>
            <div style={{ width: '36px', height: '36px', border: '3px solid rgba(92,52,114,0.15)', borderTopColor: '#5C3472', borderRadius: '50%', animation: 'spin 0.8s linear infinite', margin: '0 auto 20px' }} />
            <div style={{ ...cinzel(), marginBottom: '14px' }}>
              {stage === 'reading' ? 'Leyendo archivos del ZIP…' : 'Claude redactando acta…'}
            </div>
            <div style={{ height: '3px', background: 'rgba(92,52,114,0.15)', borderRadius: '2px', overflow: 'hidden', maxWidth: '300px', margin: '0 auto' }}>
              <div style={{ height: '100%', background: '#5C3472', borderRadius: '2px', width: progress + '%', transition: 'width 0.4s ease' }} />
            </div>
            <div style={{ fontFamily: "'EB Garamond', serif", fontSize: '14px', fontStyle: 'italic', color: 'rgba(240,237,232,0.25)', marginTop: '12px' }}>
              {stage === 'reading' ? files.length + ' archivos extraídos' : 'Consolidando intervenciones · 3ª persona · números en letras…'}
            </div>
          </div>
        )}

        {/* FILES LIST */}
        {files.length > 0 && stage !== 'idle' && (
          <div style={{ background: '#1C2233', border: '1px solid rgba(92,52,114,0.12)', borderRadius: '10px', overflow: 'hidden', animation: 'fade-in 0.4s 0.1s ease-out both' }}>
            <div style={{ padding: '14px 20px 10px', borderBottom: '1px solid rgba(255,255,255,0.05)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div style={cinzel()}>Archivos detectados</div>
              <div style={{ fontFamily: "'EB Garamond', serif", fontSize: '18px', color: '#EAD9F5' }}>{files.length}</div>
            </div>
            <div style={{ padding: '12px 16px', display: 'grid', gap: '4px' }}>
              {files.slice(0, 8).map((f, i) => (
                <div key={i} style={{ display: 'flex', alignItems: 'center', gap: '10px', padding: '5px 8px', borderRadius: '6px', transition: 'background 0.15s', cursor: 'default' }}
                  onMouseEnter={e => { e.currentTarget.style.background = 'rgba(92,52,114,0.08)' }}
                  onMouseLeave={e => { e.currentTarget.style.background = 'transparent' }}>
                  <span style={{ ...cinzel(f.type === 'vtt' ? '#EAD9F5' : f.type === 'txt' ? '#C4622D' : '#6B6460'), fontSize: '7px', padding: '2px 6px', border: '1px solid ' + (f.type === 'vtt' ? 'rgba(92,52,114,0.4)' : f.type === 'txt' ? 'rgba(196,98,45,0.4)' : 'rgba(107,100,96,0.3)'), borderRadius: '3px', flexShrink: 0 }}>
                    {f.type.toUpperCase()}
                  </span>
                  <span style={{ fontFamily: "'DM Sans', sans-serif", fontSize: '12px', color: 'rgba(240,237,232,0.5)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{f.name}</span>
                </div>
              ))}
              {files.length > 8 && (
                <div style={{ ...cinzel(), fontSize: '8px', padding: '4px 8px', opacity: 0.3 }}>+{files.length - 8} más</div>
              )}
            </div>
          </div>
        )}

        {/* DONE */}
        {stage === 'done' && (
          <div style={{ animation: 'snap-in 0.4s ease-out forwards' }}>
            <div style={{ background: '#1C2233', border: '1px solid rgba(74,222,128,0.2)', borderTop: '3px solid #4ADE80', borderRadius: '12px', padding: '28px 32px', textAlign: 'center', marginBottom: '14px' }}>
              <div style={{ width: '48px', height: '48px', background: 'rgba(74,222,128,0.1)', borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 16px' }}>
                <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#4ADE80" strokeWidth="2"><polyline points="20 6 9 17 4 12"/></svg>
              </div>
              <div style={{ fontFamily: "'EB Garamond', serif", fontSize: '24px', color: '#F0EDE8', marginBottom: '6px' }}>Acta generada</div>
              <p style={{ fontSize: '12px', color: '#6B6460', margin: '0 0 20px' }}>Revisada · numerada · lista para firmas</p>
              {result && (
                <a href={result} download
                  style={{ display: 'inline-flex', alignItems: 'center', gap: '8px', padding: '10px 22px', background: '#5C3472', border: '1px solid rgba(92,52,114,0.5)', borderRadius: '6px', color: '#F0EDE8', textDecoration: 'none', ...cinzel('#F0EDE8'), fontSize: '10px', transition: 'filter 0.15s, transform 0.15s' }}
                  onMouseEnter={e => { const el = e.currentTarget as HTMLElement; el.style.filter = 'brightness(1.15)'; el.style.transform = 'translateY(-1px)' }}
                  onMouseLeave={e => { const el = e.currentTarget as HTMLElement; el.style.filter = 'none'; el.style.transform = 'none' }}>
                  Descargar DOCX
                </a>
              )}
            </div>
            <div style={{ textAlign: 'center' }}>
              <button onClick={() => { setStage('idle'); setFiles([]); setResult(''); setProgress(0) }}
                style={{ background: 'transparent', border: '1px solid rgba(92,52,114,0.25)', borderRadius: '6px', padding: '8px 18px', color: 'rgba(240,237,232,0.4)', ...cinzel('rgba(240,237,232,0.4)'), fontSize: '8px', cursor: 'pointer', transition: 'all 0.15s' }}
                onMouseEnter={e => { e.currentTarget.style.borderColor = 'rgba(92,52,114,0.5)'; e.currentTarget.style.color = 'rgba(240,237,232,0.65)' }}
                onMouseLeave={e => { e.currentTarget.style.borderColor = 'rgba(92,52,114,0.25)'; e.currentTarget.style.color = 'rgba(240,237,232,0.4)' }}>
                Nueva acta
              </button>
            </div>
          </div>
        )}

        {/* FEATURE CARDS */}
        {stage === 'idle' && (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: '12px', animation: 'fade-in 0.5s 0.35s ease-out both' }}>
            {[
              { icon: '🔒', title: 'ZIP local', desc: 'Extracción en tu máquina. El ZIP nunca sale de tu PC.' },
              { icon: '⚡', title: 'Paso 0.5 activo', desc: 'Claude consolida intervenciones y redacta en 3ª persona legal.' },
              { icon: '📄', title: 'DOCX firmable', desc: 'Números en letras, votaciones exactas, formato Ley 284.' },
            ].map(card => (
              <div key={card.title}
                style={{ background: 'rgba(28,34,51,0.7)', border: '1px solid rgba(92,52,114,0.15)', borderRadius: '10px', padding: '16px', transition: 'border-color 0.2s, transform 0.2s, box-shadow 0.2s', cursor: 'default' }}
                onMouseEnter={e => { const el = e.currentTarget; el.style.borderColor = 'rgba(92,52,114,0.35)'; el.style.transform = 'translateY(-2px)'; el.style.boxShadow = '0 8px 24px rgba(0,0,0,0.3)' }}
                onMouseLeave={e => { const el = e.currentTarget; el.style.borderColor = 'rgba(92,52,114,0.15)'; el.style.transform = 'none'; el.style.boxShadow = 'none' }}>
                <div style={{ fontSize: '18px', marginBottom: '8px' }}>{card.icon}</div>
                <div style={{ fontSize: '12px', fontWeight: 600, color: '#F0EDE8', marginBottom: '4px' }}>{card.title}</div>
                <div style={{ fontSize: '11px', color: 'rgba(200,196,190,0.5)', lineHeight: 1.5 }}>{card.desc}</div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* FOOTER */}
      <footer style={{ position: 'fixed', bottom: 0, left: 0, right: 0, borderTop: '2px solid #5C3472', background: 'rgba(14,16,24,0.97)', backdropFilter: 'blur(12px)', WebkitBackdropFilter: 'blur(12px)', padding: '7px 28px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '12px', zIndex: 100 }}>
        <div style={{ display: 'inline-flex', alignItems: 'baseline', gap: 0, lineHeight: 1 }}>
          <span style={{ fontFamily: "'EB Garamond', serif", fontWeight: 400, color: 'rgba(240,237,232,0.55)', fontSize: '14px' }}>Forum</span>
          <span style={{ fontFamily: "'DM Sans', sans-serif", fontWeight: 700, color: '#C4622D', letterSpacing: '0.06em', fontSize: '13px' }}>PH</span>
          <span style={{ fontFamily: "'DM Sans', sans-serif", fontWeight: 700, color: '#C4622D', letterSpacing: '0.04em', fontSize: '13px' }}>s</span>
          <span style={{ fontSize: '9px', color: 'rgba(240,237,232,0.2)', letterSpacing: '0.06em', marginLeft: '8px', fontFamily: "'DM Sans', sans-serif" }}>Actas · Ley 284 de 2022</span>
        </div>
        <div style={{ fontSize: '9px', color: 'rgba(200,196,190,0.18)', letterSpacing: '0.04em' }}>Document Factory v2.0</div>
      </footer>

      <style>{`
        @keyframes fade-in  { from { opacity: 0; transform: translateY(8px);   } to { opacity: 1; transform: none; } }
        @keyframes snap-in  { from { opacity: 0; transform: scale(0.96);       } to { opacity: 1; transform: none; } }
        @keyframes spin     { to   { transform: rotate(360deg); } }
        @media (prefers-reduced-motion: reduce) { * { animation-duration: 0.01ms !important; } }
      `}</style>
    </div>
  )
}