'use client'

import { useEffect, useRef, useState } from 'react'
import type { DebateBlock } from '@/lib/types'

interface ProcessingPipelineProps {
  blocks: DebateBlock[]
  onComplete: (formalizedBlocks: DebateBlock[]) => void
}

interface ProgressEvent {
  type: 'progress' | 'error' | 'complete'
  index?: number
  total?: number
  speaker?: string
  unit?: string
  result?: string
  skipped?: boolean
  blocks?: DebateBlock[]
  total_formalized?: number
  total_skipped?: number
  error?: string
}

export default function ProcessingPipeline({ blocks, onComplete }: ProcessingPipelineProps) {
  const [events, setEvents] = useState<ProgressEvent[]>([])
  const [done, setDone] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [current, setCurrent] = useState<{ index: number; total: number; speaker: string } | null>(null)
  const logRef = useRef<HTMLDivElement>(null)
  const startedRef = useRef(false)

  const totalBlocks = blocks.filter(b => !b.skip && b.text_cleaned).length

  useEffect(() => {
    if (startedRef.current) return
    startedRef.current = true

    async function run() {
      try {
        const res = await fetch('/api/formalize', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ blocks }),
        })

        if (!res.ok || !res.body) {
          setError('Error al conectar con el API de formalización')
          return
        }

        const reader = res.body.getReader()
        const decoder = new TextDecoder()
        let buffer = ''

        while (true) {
          const { done: streamDone, value } = await reader.read()
          if (streamDone) break

          buffer += decoder.decode(value, { stream: true })
          const lines = buffer.split('\n')
          buffer = lines.pop() || ''

          for (const line of lines) {
            if (!line.trim()) continue
            try {
              const event: ProgressEvent = JSON.parse(line)
              if (event.type === 'progress') {
                setCurrent({
                  index: event.index! + 1,
                  total: event.total!,
                  speaker: event.speaker || '…',
                })
                setEvents(prev => [...prev.slice(-50), event])
              } else if (event.type === 'complete') {
                setDone(true)
                setEvents(prev => [...prev, event])
                if (event.blocks) onComplete(event.blocks)
              } else if (event.type === 'error') {
                setEvents(prev => [...prev, event])
              }
            } catch { /* skip malformed line */ }
          }
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Error desconocido')
      }
    }

    run()
  }, []) // eslint-disable-line

  useEffect(() => {
    if (logRef.current) {
      logRef.current.scrollTop = logRef.current.scrollHeight
    }
  }, [events])

  const pct = current ? Math.round((current.index / current.total) * 100) : 0

  return (
    <div className="fade-in">
      <div style={{ marginBottom: 28 }}>
        <div style={{
          display: 'inline-flex',
          alignItems: 'center',
          gap: 8,
          background: 'rgba(92,52,114,0.15)',
          border: '1px solid rgba(92,52,114,0.3)',
          borderRadius: 8,
          padding: '6px 14px',
          marginBottom: 16,
        }}>
          {!done && (
            <div style={{
              width: 8, height: 8,
              background: 'var(--amatista)',
              borderRadius: '50%',
              animation: 'pulse-amatista 1.5s infinite',
            }} />
          )}
          <span style={{ fontSize: 12, color: 'var(--amatista-light)', fontWeight: 500, letterSpacing: '0.05em' }}>
            {done ? '✅ FORMALIZACIÓN COMPLETA' : 'PASO 0.5 · CLAUDE API · ACTIVO'}
          </span>
        </div>

        <h2 style={{
          fontFamily: 'EB Garamond, serif',
          fontSize: 32,
          fontWeight: 400,
          color: 'var(--parch)',
          margin: '0 0 8px',
        }}>
          {done ? 'Bloques formalizados' : 'Formalizando intervenciones'}
        </h2>
        <p style={{ color: 'var(--parch-dim)', fontSize: 14, margin: 0 }}>
          {done
            ? 'Todos los bloques procesados. Generando el acta final…'
            : 'Cada intervención pasa por Claude API para convertirla en narrativa legal formal en 3ª persona.'
          }
        </p>
      </div>

      {/* Progress bar */}
      <div style={{ marginBottom: 24 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8, fontSize: 13 }}>
          <span style={{ color: 'var(--parch-dim)' }}>
            {current ? `${current.index} / ${current.total} bloques` : `0 / ${totalBlocks} bloques`}
          </span>
          <span style={{ color: done ? '#4ADE80' : 'var(--amatista-light)', fontWeight: 600 }}>
            {done ? '100%' : `${pct}%`}
          </span>
        </div>
        <div className="wc-bar">
          <div
            className={`wc-bar-fill ${done ? 'ok' : ''}`}
            style={{ width: done ? '100%' : `${pct}%` }}
          />
        </div>
      </div>

      {/* Current speaker */}
      {current && !done && (
        <div style={{
          background: 'rgba(92,52,114,0.08)',
          border: '1px solid rgba(92,52,114,0.2)',
          borderRadius: 10,
          padding: '14px 18px',
          marginBottom: 20,
          display: 'flex',
          alignItems: 'center',
          gap: 12,
        }}>
          <div style={{
            width: 32, height: 32,
            border: '2px solid var(--amatista)',
            borderTop: '2px solid transparent',
            borderRadius: '50%',
            animation: 'spin-slow 0.8s linear infinite',
            flexShrink: 0,
          }} />
          <div>
            <div style={{ fontSize: 12, color: 'var(--parch-dim)', marginBottom: 2 }}>Procesando ahora</div>
            <div style={{ fontSize: 14, color: 'var(--parch)', fontWeight: 500 }}>{current.speaker}</div>
          </div>
        </div>
      )}

      {/* Live log */}
      <div
        ref={logRef}
        style={{
          background: 'rgba(14, 17, 26, 0.8)',
          border: '1px solid rgba(92,52,114,0.2)',
          borderRadius: 10,
          padding: '16px',
          height: 300,
          overflowY: 'auto',
          fontFamily: 'DM Sans, monospace',
          fontSize: 12,
        }}
      >
        {events.length === 0 && (
          <span style={{ color: 'var(--parch-dim)', opacity: 0.5 }}>Iniciando formalización…</span>
        )}
        {events.map((event, i) => (
          <div key={i} style={{
            padding: '4px 0',
            borderBottom: '1px solid rgba(255,255,255,0.04)',
            display: 'flex',
            gap: 12,
          }}>
            {event.type === 'progress' && (
              <>
                <span style={{ color: event.skipped ? 'rgba(200,196,190,0.3)' : 'var(--amatista-light)', minWidth: 32, textAlign: 'right' }}>
                  {event.index !== undefined ? `${event.index! + 1}` : ''}
                </span>
                <span style={{ color: event.skipped ? 'rgba(200,196,190,0.3)' : 'var(--parch-dim)', minWidth: 150, flexShrink: 0 }}>
                  {event.speaker}{event.unit ? ` · ${event.unit}` : ''}
                </span>
                <span style={{ color: event.skipped ? 'rgba(200,196,190,0.2)' : 'var(--parch)', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {event.skipped ? '— omitido' : event.result || '—'}
                </span>
              </>
            )}
            {event.type === 'error' && (
              <span style={{ color: 'var(--terra)' }}>⚠ {event.error}</span>
            )}
            {event.type === 'complete' && (
              <span style={{ color: '#4ADE80', fontWeight: 600 }}>
                ✅ Completado — {event.total_formalized} formalizados · {event.total_skipped} omitidos
              </span>
            )}
          </div>
        ))}
      </div>

      {error && (
        <div style={{
          marginTop: 16,
          padding: '12px 16px',
          background: 'rgba(196,98,45,0.1)',
          border: '1px solid rgba(196,98,45,0.3)',
          borderRadius: 8,
          color: 'var(--terra)',
          fontSize: 13,
        }}>
          ⚠️ {error}
        </div>
      )}
    </div>
  )
}
