'use client'

import { useEffect, useRef, useState } from 'react'
import type { DebateBlock } from '@/lib/types'

interface ProcessingPipelineProps {
  blocks: DebateBlock[]
  skeleton?: { agenda_items?: { number: number; title: string }[] }
  onComplete: (formalizedBlocks: DebateBlock[]) => void
  retryAttempt?: number
}

interface ChunkStatus {
  id: number
  from: number
  to: number
  status: 'pending' | 'running' | 'done' | 'error'
  formalized: number
  skipped: number
  error?: string
}

// Supabase Edge Function URL
const EDGE_FN_URL = 'https://amlvyycfepwhiindxgzw.supabase.co/functions/v1/fphs-formalize'
const CHUNK_SIZE = 15  // blocks per Edge Function call

export default function ProcessingPipeline({ blocks, skeleton, onComplete, retryAttempt = 0 }: ProcessingPipelineProps) {
  const [chunks, setChunks] = useState<ChunkStatus[]>([])
  const [done, setDone] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [totalProcessed, setTotalProcessed] = useState(0)
  const startedRef = useRef(false)
  const logRef = useRef<HTMLDivElement>(null)

  const totalBlocks = blocks.length
  const totalChunks = Math.ceil(totalBlocks / CHUNK_SIZE)
  const pct = done ? 100 : totalBlocks > 0 ? Math.round((totalProcessed / totalBlocks) * 100) : 0

  useEffect(() => {
    if (startedRef.current) return
    startedRef.current = true

    const initialChunks: ChunkStatus[] = Array.from({ length: totalChunks }, (_, i) => ({
      id: i,
      from: i * CHUNK_SIZE + 1,
      to: Math.min((i + 1) * CHUNK_SIZE, totalBlocks),
      status: 'pending',
      formalized: 0,
      skipped: 0,
    }))
    setChunks(initialChunks)

    async function run() {
      const allResults: DebateBlock[] = new Array(totalBlocks)

      // Pre-assign agenda sections before fanning out
      const { assignBlocksToSections } = await import('@/lib/processors/sectionAssigner')
      const agendaItems = skeleton?.agenda_items || []
      const assignedBlocks = assignBlocksToSections(blocks, agendaItems)

      // Mark all chunks as running simultaneously
      setChunks(prev => prev.map(c => ({ ...c, status: 'running' })))

      // Fan-out: fire ALL chunks simultaneously
      const chunkPromises = Array.from({ length: totalChunks }, async (_, i) => {
        const start = i * CHUNK_SIZE
        const chunkBlocks = assignedBlocks.slice(start, start + CHUNK_SIZE)

        try {
          // Retry up to 3 times on 503 (Supabase rate limit / cold start)
          let res: Response | null = null
          for (let attempt = 0; attempt < 3; attempt++) {
            res = await fetch(EDGE_FN_URL, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ blocks: chunkBlocks, retry_attempt: retryAttempt }),
            })
            if (res.status !== 503) break
            await new Promise(r => setTimeout(r, 1500 * (attempt + 1)))  // 1.5s, 3s, 4.5s backoff
          }

          if (!res!.ok) {
            const errText = await res!.text()
            throw new Error(`HTTP ${res!.status}: ${errText.substring(0, 80)}`)
          }

          const data = await res!.json()
          if (!data.success || !data.blocks) throw new Error(data.error || 'Invalid response')

          // Store results in correct positions
          data.blocks.forEach((block: DebateBlock, j: number) => {
            allResults[start + j] = block
          })

          setChunks(prev => prev.map(c => c.id === i ? {
            ...c, status: 'done',
            formalized: data.total_formalized,
            skipped: data.total_skipped,
          } : c))

          setTotalProcessed(prev => prev + chunkBlocks.length)

          return data.blocks.length

        } catch (err) {
          const errMsg = err instanceof Error ? err.message : String(err)
          // On agent error: mark blocks as skip — raw text in the acta is worse than omitting
          // The QA threshold will trigger a retry with higher tolerance
          chunkBlocks.forEach((block, j) => {
            allResults[start + j] = { ...block, skip: true, skip_reason: 'agent_error' }
          })

          setChunks(prev => prev.map(c => c.id === i ? {
            ...c, status: 'error', error: errMsg.substring(0, 60),
          } : c))

          setTotalProcessed(prev => prev + chunkBlocks.length)
          return 0
        }
      })

      await Promise.allSettled(chunkPromises)

      setDone(true)
      onComplete(allResults.filter(Boolean))
    }

    run().catch(err => setError(err instanceof Error ? err.message : String(err)))
  }, []) // eslint-disable-line

  useEffect(() => {
    if (logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight
  }, [chunks])

  const doneCount = chunks.filter(c => c.status === 'done').length
  const errorCount = chunks.filter(c => c.status === 'error').length
  const runningCount = chunks.filter(c => c.status === 'running').length

  return (
    <div className="fade-in">
      <div style={{ marginBottom: 28 }}>
        <div style={{
          display: 'inline-flex', alignItems: 'center', gap: 8,
          background: done ? 'rgba(74,222,128,0.1)' : 'rgba(92,52,114,0.15)',
          border: `1px solid ${done ? 'rgba(74,222,128,0.3)' : 'rgba(92,52,114,0.3)'}`,
          borderRadius: 8, padding: '6px 14px', marginBottom: 16,
        }}>
          {!done && <div style={{ width: 8, height: 8, background: retryAttempt > 0 ? 'var(--terra)' : 'var(--amatista)', borderRadius: '50%', animation: 'pulse-ring 1.5s infinite' }} />}
          <span style={{ fontSize: 12, color: done ? '#4ADE80' : 'var(--amatista-light)', fontWeight: 500, letterSpacing: '0.05em' }}>
            {done
              ? `✅ COMPLETO — ${totalChunks} agentes finalizados`
              : `PASO 0.5 · ${runningCount} AGENTES · ${doneCount}/${totalChunks}${retryAttempt > 0 ? ` · TOLERANCIA +${retryAttempt * 10}%` : ''}`
            }
          </span>
        </div>

        <h2 style={{ fontFamily: 'EB Garamond, serif', fontSize: 32, fontWeight: 400, color: 'var(--parch)', margin: '0 0 8px' }}>
          {done ? 'Formalización completa' : 'Formalizando en paralelo'}
        </h2>
        <p style={{ color: 'var(--parch-dim)', fontSize: 14, margin: 0 }}>
          {done
            ? `${chunks.reduce((s, c) => s + c.formalized, 0)} bloques formalizados · ${errorCount > 0 ? `${errorCount} agentes con fallback` : 'todos los agentes OK'}`
            : retryAttempt > 0
              ? `Reintento ${retryAttempt} — tolerancia aumentada, umbral mínimo reducido`
              : `${totalChunks} agentes trabajando simultáneamente — sin límite de tiempo por Supabase Edge Functions`
          }
        </p>
      </div>

      {/* Progress */}
      <div style={{ marginBottom: 24 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8, fontSize: 13 }}>
          <span style={{ color: 'var(--parch-dim)' }}>{totalProcessed} / {totalBlocks} bloques</span>
          <span style={{ color: done ? '#4ADE80' : 'var(--amatista-light)', fontWeight: 600 }}>{pct}%</span>
        </div>
        <div className="wc-bar">
          <div className={`wc-bar-fill ${done ? 'ok' : ''}`} style={{ width: `${pct}%`, transition: 'width 0.3s ease' }} />
        </div>
      </div>

      {/* Agent grid */}
      <div ref={logRef} style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fill, minmax(160px, 1fr))',
        gap: 8,
        maxHeight: 320,
        overflowY: 'auto',
        background: 'rgba(14,17,26,0.8)',
        border: '1px solid rgba(92,52,114,0.2)',
        borderRadius: 10,
        padding: 16,
      }}>
        {chunks.map(chunk => (
          <div key={chunk.id} style={{
            padding: '10px 12px',
            borderRadius: 8,
            background: chunk.status === 'done'
              ? 'rgba(74,222,128,0.08)'
              : chunk.status === 'error'
              ? 'rgba(196,98,45,0.08)'
              : chunk.status === 'running'
              ? 'rgba(92,52,114,0.12)'
              : 'rgba(255,255,255,0.03)',
            border: `1px solid ${chunk.status === 'done' ? 'rgba(74,222,128,0.2)' : chunk.status === 'error' ? 'rgba(196,98,45,0.2)' : chunk.status === 'running' ? 'rgba(92,52,114,0.3)' : 'rgba(255,255,255,0.05)'}`,
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4 }}>
              {chunk.status === 'running' && (
                <div style={{ width: 8, height: 8, border: '1.5px solid var(--amatista)', borderTop: '1.5px solid transparent', borderRadius: '50%', animation: 'spin-slow 0.8s linear infinite', flexShrink: 0 }} />
              )}
              {chunk.status === 'done' && <span style={{ color: '#4ADE80', fontSize: 10 }}>✓</span>}
              {chunk.status === 'error' && <span style={{ color: 'var(--terra)', fontSize: 10 }}>⚠</span>}
              {chunk.status === 'pending' && <div style={{ width: 8, height: 8, borderRadius: '50%', background: 'rgba(200,196,190,0.15)', flexShrink: 0 }} />}
              <span style={{
                fontSize: 11, fontWeight: 700, letterSpacing: '0.04em',
                color: chunk.status === 'done' ? '#4ADE80' : chunk.status === 'error' ? 'var(--terra)' : chunk.status === 'running' ? 'var(--amatista-light)' : 'rgba(200,196,190,0.2)',
              }}>
                Agente {chunk.id + 1}
              </span>
            </div>
            <div style={{ fontSize: 10, color: 'rgba(200,196,190,0.35)' }}>
              bloques {chunk.from}–{chunk.to}
            </div>
            {chunk.status === 'done' && (
              <div style={{ fontSize: 10, color: '#4ADE80', marginTop: 3 }}>
                {chunk.formalized} ok · {chunk.skipped} skip
              </div>
            )}
            {chunk.status === 'error' && (
              <div style={{ fontSize: 9, color: 'var(--terra)', marginTop: 3, wordBreak: 'break-word' as const }}>
                {chunk.error}
              </div>
            )}
          </div>
        ))}
      </div>

      {error && (
        <div style={{ marginTop: 16, padding: '12px 16px', background: 'rgba(196,98,45,0.1)', border: '1px solid rgba(196,98,45,0.3)', borderRadius: 8, color: 'var(--terra)', fontSize: 13 }}>
          ⚠️ {error}
        </div>
      )}
    </div>
  )
}
