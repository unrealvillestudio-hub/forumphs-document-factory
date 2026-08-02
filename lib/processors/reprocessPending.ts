/**
 * reprocessPending.ts — GAP 2 orchestration (generator layer, NOT the EF).
 *
 * The fphs-formalize EF already supports forced re-sweeps: with retry_attempt>=1
 * it runs in MODO FORZADO (SYS1/SYS2) and never returns NULL — it recovers the
 * legitimate blocks that attempt 0 left as a fallback/template placeholder
 * ("[PENDIENTE DE FORMALIZACION …]"). What was missing is that /api/generate
 * called the EF only once (attempt 0) and never re-invoked it. This module does
 * exactly that re-invocation — it does NOT modify the EF.
 *
 * Reprocess set (intentionally narrow):
 *   - text_formal contains the PENDIENTE marker, OR
 *   - skip_reason ∈ {'fallback','template'}
 * Noise discards (claude_null / logistica / empty / agent_error) are NEVER
 * reprocessed — re-running them would reintroduce the "Mhm"/"tan tan tan" that
 * v23 deliberately removed.
 */

import type { DebateBlock } from '../types'
import { callFormalizeEF } from '../server/formalizeClient'

const PENDING_MARKER = '[PENDIENTE DE FORMALIZACION'
const REPROCESS_REASONS = new Set(['fallback', 'template'])
// EF caps at 15 blocks/call; stay under it to avoid timeouts.
const CHUNK = 12
// retry_attempt values to try, in order: 1 → SYS1 (forzado), 2 → SYS2 (forzado max).
const RETRY_ATTEMPTS = [1, 2]
const CALL_TIMEOUT_MS = 60_000

/** A block still awaiting real formalization (eligible for a forced re-sweep). */
export function isPendingBlock(b: DebateBlock): boolean {
  if (!b) return false
  const hasMarker = (b.text_formal || '').includes(PENDING_MARKER)
  const reprocessReason = REPROCESS_REASONS.has(b.skip_reason || '')
  return hasMarker || reprocessReason
}

async function callEF(blocks: DebateBlock[], retry_attempt: number): Promise<DebateBlock[] | null> {
  try {
    // Trusted server loop: attach the shared secret and hit the EF directly via
    // the shared client (bypasses the /api/formalize rate limiter by design —
    // T3 §3.1, "impide al desconocido, no al bucle propio").
    const res = await callFormalizeEF(
      { blocks, retry_attempt },
      { signal: AbortSignal.timeout(CALL_TIMEOUT_MS) },
    )
    if (!res.ok) return null
    const data = await res.json()
    if (!data || data.success !== true || !Array.isArray(data.blocks)) return null
    return data.blocks as DebateBlock[]
  } catch {
    return null
  }
}

/**
 * Re-invoke the EF (forced sweeps) for the blocks that came back pending.
 * Pure orchestration: identifies pendientes, re-formalizes them in chunks at
 * retry_attempt 1 then 2, and merges the recovered text back in place.
 *
 * Returns the (possibly) updated block list plus the blocks that remained
 * pending after both forced sweeps — those become a MEDIUM ICR finding so Ivette
 * can complete them by hand. The marker only survives as a LAST resort.
 */
export async function reprocessPendingBlocks(blocks: DebateBlock[]): Promise<{
  blocks: DebateBlock[]
  stillPending: DebateBlock[]
  recovered: number
}> {
  const out = [...blocks]
  const initialPending = out.filter(isPendingBlock).length
  if (initialPending === 0) return { blocks: out, stillPending: [], recovered: 0 }

  for (const ra of RETRY_ATTEMPTS) {
    const pendingIdx = out.map((b, i) => (isPendingBlock(b) ? i : -1)).filter(i => i >= 0)
    if (pendingIdx.length === 0) break
    for (let c = 0; c < pendingIdx.length; c += CHUNK) {
      const idxChunk = pendingIdx.slice(c, c + CHUNK)
      const subset = idxChunk.map(i => out[i])
      const result = await callEF(subset, ra)
      if (!result || result.length !== subset.length) continue
      result.forEach((rb, j) => { if (rb) out[idxChunk[j]] = rb })
    }
  }

  const stillPending = out.filter(isPendingBlock)
  return { blocks: out, stillPending, recovered: initialPending - stillPending.length }
}
