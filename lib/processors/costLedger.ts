/**
 * costLedger.ts — One row per acta in ops_token_sessions (UNRLVL).
 *
 * Token sources accumulated in /api/generate:
 *   • fphs-formalize (EF)   — returned in EF JSON response, passed by client in body
 *   • Image curation (Vision) — curateImages() returns usage directly
 *   • ICR (Mano A)           — /api/icr returns icr_input/output_tokens; client
 *                               passes them in the generate body when re-calling
 *                               with icr_findings (second-pass annotations).
 *
 * Rates from ops_lab_rates (UNRLVL):
 *   lab='document-factory', model_id='claude-sonnet-4-6'
 *   $3.00 / 1M input tokens · $15.00 / 1M output tokens
 *
 * DB: UNRLVL (amlvyycfepwhiindxgzw) — NOT the FPHS DB.
 * Auth: UNRLVL_SERVICE_KEY (server-side only, never NEXT_PUBLIC_).
 */

const UNRLVL_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || ''
const UNRLVL_KEY = process.env.UNRLVL_SERVICE_KEY || ''

const INPUT_RATE_PER_M  = 3.00   // USD per 1 000 000 input tokens
const OUTPUT_RATE_PER_M = 15.00  // USD per 1 000 000 output tokens

export interface LogActaCostParams {
  jobId:        string
  building:     string
  actaNo:       string
  inputTokens:  number
  outputTokens: number
  durationMs:   number
}

/**
 * Write ONE cost-ledger row for a complete acta generation job.
 * Errors are logged (never silenced) but are non-fatal — the caller's
 * document generation has already succeeded.
 */
export async function logActaCost(p: LogActaCostParams): Promise<void> {
  if (!UNRLVL_URL || !UNRLVL_KEY) {
    console.warn('[costLedger] UNRLVL_URL or UNRLVL_SERVICE_KEY not configured — skipping cost log.')
    return
  }
  if (p.inputTokens === 0 && p.outputTokens === 0) {
    console.warn('[costLedger] Zero tokens for job', p.jobId, '— skipping cost log.')
    return
  }

  const cost_usd =
    (p.inputTokens  / 1_000_000 * INPUT_RATE_PER_M) +
    (p.outputTokens / 1_000_000 * OUTPUT_RATE_PER_M)

  const payload = {
    session_type:  'document_factory',
    model_id:      'claude-sonnet-4-6',
    brand_id:      'ForumPHs',
    lab:           'document-factory',
    input_tokens:  p.inputTokens,
    output_tokens: p.outputTokens,
    cost_usd,
    duration_ms:   p.durationMs,
    notes:         `acta ${p.building} ${p.actaNo} | job ${p.jobId} | formalize+qa+icr+vision`,
  }

  try {
    const res = await fetch(`${UNRLVL_URL}/rest/v1/ops_token_sessions`, {
      method: 'POST',
      headers: {
        apikey:          UNRLVL_KEY,
        Authorization:   `Bearer ${UNRLVL_KEY}`,
        'Content-Type':  'application/json',
        Prefer:          'return=minimal',
      },
      body: JSON.stringify(payload),
    })
    if (!res.ok) {
      const text = await res.text().catch(() => '(unreadable body)')
      console.error(`[costLedger] INSERT failed: HTTP ${res.status} — ${text}`)
    }
  } catch (err) {
    console.error('[costLedger] Network error writing ops_token_sessions:', err)
  }
}
