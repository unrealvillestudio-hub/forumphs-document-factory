'use client'

import { useEffect, useRef, useState } from 'react'
import type { DebateBlock } from '@/lib/types'

interface ProcessingPipelineProps {
  blocks: DebateBlock[]
  skeleton?: { agenda_items?: { number: number; title: string }[] }
  onComplete: (formalizedBlocks: DebateBlock[]) => void
}

interface BatchLog {
  batchNum: number
  from: number
  to: number
  formalized: number
  skipped: number
  status: 'pending' | 'running' | 'done' | 'error'
  error?: string
}

const BATCH_SIZE = 20

export default function ProcessingPipeline({ blocks, skeleton, onComplete }: ProcessingPipelineProps) {
  const [logs, setLogs] = useState<BatchLog[]>([])
  const [done, setDone] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [currentBatch, setCurrentBatch] = useState(0)
  const [totalProcessed, setTotalProcessed] = useState(0)
  const startedRef = useRef(false)
  const logRef = useRef<HTMLDivElement>(null)

  const totalBlocks = blocks.length
  const totalBatches = Math.ceil(totalBlocks / BATCH_SIZE)
  const pct = done ? 100 : totalBlocks > 0 ? Math.round((totalProcessed / totalBlocks) * 100) : 0

  useEffect(() => {
    if (startedRef.current) return
    startedRef.current = true

    // Initialize batch log
    const initialLogs: BatchLog[] = Array.from({ length: totalBatches }, (_, i) => ({
      batchNum: i + 1,
      from: i * BATCH_SIZE + 1,
      to: Math.min((i + 1) * BATCH_SIZE, totalBlocks),
      formalized: 0,
      skipped: 0,
      status: 'pending',
    }))
    setLogs(initialLogs)

    async function run() {
      const allResults: DebateBlock[] = []

      for (let batchIdx = 0; batchIdx < totalBatches; batchIdx++) {
        const batchStart = batchIdx * BATCH_SIZE
        const batch = blocks.slice(batchStart, batchStart + BATCH_SIZE)

        setCurrentBatch(batchIdx + 1)
        setLogs(prev => prev.map((l, i) => i === batchIdx ? { ...l, status: 'running' } : l))

        try {
          const res = await fetch('/api/formalize', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ blocks: batch, skeleton }),
          })

          if (!res.ok) {
            const errText = await res.text()
            throw new Error(`HTTP ${res.status}: ${errText.substring(0, 100)}`)
          }

          const data = await res.json()

          if (!data.success || !data.blocks) {
            throw new Error(data.error || 'Respuesta inválida del servidor')
          }

          allResults.push(...data.blocks)
          setTotalProcessed(allResults.length)

          setLogs(prev => prev.map((l, i) => i === batchIdx ? {
            ...l,
            status: 'done',
            formalized: data.total_formalized,
            skipped: data.total_skipped,
          } : l))

        } catch (err) {
          const errMsg = err instanceof Error ? err.message : String(err)
          setLogs(prev => prev.map((l, i) => i === batchIdx ? {
            ...l,
            status: 'error',
            error: errMsg.substring(0, 80),
          } : l))
          // Push unformalized blocks as fallback so we don't lose them
          allResults.push(...batch.map(b => ({ ...b, text_formal: b.text_cleaned })))
          setTotalProcessed(allResults.length)
        }
      }

      setDone(true)
      onComplete(allResults)
    }

    run().catch(err => setError(err instanceof Error ? err.message : String(err)))
  }, []) // eslint-disable-line

  useEffect(() => {
    if (logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight
  }, [logs])

  return (
    <div className="fade-in">
      <div style={{ marginBottom: 28 }}>
        <div style={{
          display: 'inline-flex', alignItems: 'center', gap: 8,
          background: done ? 'rgba(74,222,128,0.1)' : 'rgba(92,52,114,0.15)',
          border: `1px solid ${done ? 'rgba(74,222,128,0.3)' : 'rgba(92,52,114,0.3)'}`,
          borderRadius: 8, padding: '6px 14px', marginBottom: 16,
        }}>
          {!done && <div style={{ width: 8, height: 8, background: 'var(--amatista)', borderRadius: '50%', animation: 'pulse-ring 1.5s infinite' }} />}
          <span style={{ fontSize: 12, color: done ? '#4ADE80' : 'var(--amatista-light)', fontWeight: 500, letterSpacing: '0.05em' }}>
            {done ? '✅ FORMALIZACIÓN COMPLETA' : `PASO 0.5 · BATCH ${currentBatch}/${totalBatches}`}
          </span>
        </div>

        <h2 style={{ fontFamily: 'EB Garamond, serif', fontSize: 32, fontWeight: 400, color: 'var(--parch)', margin: '0 0 8px' }}>
          {done ? 'Bloques formalizados' : 'Formalizando intervenciones'}
        </h2>
        <p style={{ color: 'var(--parch-dim)', fontSize: 14, margin: 0 }}>
          {done
            ? `${logs.reduce((s,l) => s + l.formalized, 0)} formalizados · ${logs.reduce((s,l) => s + l.skipped, 0)} omitidos`
            : `Cada batch de ${BATCH_SIZE} bloques se procesa en una llamada separada — sin timeouts.`}
        </p>
      </div>

      {/* Progress bar */}
      <div style={{ marginBottom: 24 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8, fontSize: 13 }}>
          <span style={{ color: 'var(--parch-dim)' }}>{totalProcessed} / {totalBlocks} bloques</span>
          <span style={{ color: done ? '#4ADE80' : 'var(--amatista-light)', fontWeight: 600 }}>{pct}%</span>
        </div>
        <div className="wc-bar">
          <div className={`wc-bar-fill ${done ? 'ok' : ''}`} style={{ width: `${pct}%`, transition: 'width 0.5s ease' }} />
        </div>
      </div>

      {/* Batch log */}
      <div ref={logRef} style={{
        background: 'rgba(14,17,26,0.8)', border: '1px solid rgba(92,52,114,0.2)',
        borderRadius: 10, padding: 16, maxHeight: 320, overflowY: 'auto',
      }}>
        {logs.map((log, i) => (
          <div key={i} style={{
            padding: '8px 0', borderBottom: '1px solid rgba(255,255,255,0.04)',
            display: 'flex', alignItems: 'center', gap: 14,
          }}>
            <span style={{
              fontSize: 11, minWidth: 60, fontWeight: 600, letterSpacing: '0.04em',
              color: log.status === 'done' ? '#4ADE80' : log.status === 'error' ? 'var(--terra)' : log.status === 'running' ? 'var(--amatista-light)' : 'rgba(200,196,190,0.2)',
            }}>
              BATCH {log.batchNum}
            </span>
            <span style={{ fontSize: 12, color: 'rgba(200,196,190,0.4)', minWidth: 100 }}>
              bloques {log.from}–{log.to}
            </span>
            <span style={{ fontSize: 12, flex: 1, color: log.status === 'done' ? 'var(--parch-dim)' : log.status === 'error' ? 'var(--terra)' : 'rgba(200,196,190,0.2)' }}>
              {log.status === 'pending' && '— en espera'}
              {log.status === 'running' && (
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                  <span style={{ display: 'inline-block', width: 10, height: 10, border: '1.5px solid var(--amatista)', borderTop: '1.5px solid transparent', borderRadius: '50%', animation: 'spin-slow 0.8s linear infinite' }} />
                  procesando…
                </span>
              )}
              {log.status === 'done' && `✓ ${log.formalized} formalizados · ${log.skipped} omitidos`}
              {log.status === 'error' && `⚠ ${log.error}`}
            </span>
          </div>
        ))}
        {logs.length === 0 && <span style={{ color: 'var(--parch-dim)', opacity: 0.4, fontSize: 13 }}>Iniciando…</span>}
      </div>

      {error && (
        <div style={{ marginTop: 16, padding: '12px 16px', background: 'rgba(196,98,45,0.1)', border: '1px solid rgba(196,98,45,0.3)', borderRadius: 8, color: 'var(--terra)', fontSize: 13 }}>
          ⚠️ {error}
        </div>
      )}
    </div>
  )
}
