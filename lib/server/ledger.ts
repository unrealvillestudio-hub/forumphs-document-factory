/**
 * ledger.ts — SERVER-ONLY writer to ops_generation_ledger (UNRLVL).
 *
 * Único punto server-side donde las rutas Next de ForumPHs registran su consumo
 * de modelo, vía la RPC ops_log_generation (misma que usan las Edge Functions en
 * T3/T5). Replica el patrón canónico: se AWAIT el insert, se falla LOUD (status +
 * body en consola), nunca fire-and-forget. No lanza al path del usuario.
 *
 * Suplanta a lib/processors/costLedger.ts (rama sprint/df-cost-ledger-finca-warning),
 * que apuntaba a ops_token_sessions (tabla retirada en T1) con tarifas hardcodeadas.
 * costLedger no debe coexistir con este escritor: al reconciliar esa rama, se
 * elimina costLedger.ts y su import en /api/generate (ver PR T6, §6.5).
 *
 * Env (T6b): UNRLVL_SUPABASE_URL + unrlvl_service_role, server-side, SIN NEXT_PUBLIC_.
 * Son los nombres que existen en el proyecto Vercel desde el 4-jul (los genéricos
 * SUPABASE_URL/SUPABASE_SERVICE_ROLE_KEY NO existen ahí — leerlos dejaba al escritor
 * en su rama de fail-loud, sin asientos). Mismos nombres que usa detectPlatform.ts
 * para la misma DB UNRLVL. Sin fallback: dos nombres para un valor fue la causa del
 * fallo, no se replica.
 * El service_role key nunca debe llegar al bundle del cliente: este módulo es
 * server-only (no importar desde un Client Component).
 *
 * El ledger resuelve la tarifa por model_id desde ops_lab_rates: por eso NO se
 * pasan rate params (rate_in/out van NULL y el costo lo calcula la RPC).
 */

const SB_URL = process.env.UNRLVL_SUPABASE_URL ?? ''
const SB_KEY = process.env.unrlvl_service_role ?? ''

export interface LedgerEntry {
  /** Carril de costo (ej. 'document-factory'). */
  lab: string
  /** Superficie concreta, separa el Dashboard dentro del lab (ej. 'fphs-icr'). */
  sourceApp: string
  /** model_id REAL leído del bundle/ruta (ej. 'claude-sonnet-5'). */
  modelId: string
  inputUnits: number
  outputUnits: number
  /** Identificador del acta: agrupa todos los asientos de una misma corrida. */
  jobId?: string | null
  outputType?: string | null
  durationMs?: number | null
  status?: 'success' | 'error'
  errorMsg?: string | null
  /** Nombre del agente/función para el Dashboard (default: sourceApp). */
  agentName?: string | null
  /** Env var que contiene la clave usada (ej. 'forumphs_document_factory'). */
  apiKeyRef?: string | null
}

/**
 * Escribe UN asiento en ops_generation_ledger vía la RPC ops_log_generation.
 * Fail-loud: en fallo loguea HTTP status + body; en error de red loguea la
 * excepción. Nunca relanza — el path del usuario ya continuó.
 */
export async function logLedger(e: LedgerEntry): Promise<void> {
  if (!SB_URL || !SB_KEY) {
    console.error('[ledger] UNRLVL_SUPABASE_URL/unrlvl_service_role ausentes; no se escribe al ledger.')
    return
  }
  // En success sin unidades no hay nada que costear. Un status='error' SÍ se
  // registra aunque las unidades sean 0 (fallo antes de capturar usage) — pero
  // los callers sólo invocan el asiento de error cuando hubo consumo real.
  const status = e.status ?? 'success'
  if (status === 'success' && e.inputUnits === 0 && e.outputUnits === 0) return

  try {
    const res = await fetch(`${SB_URL}/rest/v1/rpc/ops_log_generation`, {
      method: 'POST',
      headers: {
        apikey: SB_KEY,
        Authorization: `Bearer ${SB_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        p_lab: e.lab,
        p_brand_id: 'ForumPHs',
        p_job_id: e.jobId ?? null,
        p_piece_id: null,
        p_output_type: e.outputType ?? null,
        p_platform: null,
        p_provider: 'anthropic',
        p_model_id: e.modelId,
        p_unit_type: 'tokens_in', // fila combinada; la RPC resuelve in + out
        p_input_units: e.inputUnits,
        p_output_units: e.outputUnits,
        // rates NULL → ops_log_generation resuelve desde ops_lab_rates por model_id.
        p_status: status,
        p_duration_ms: e.durationMs ?? null,
        p_error_msg: e.errorMsg ?? null,
        p_agent_name: e.agentName ?? e.sourceApp,
        p_source_app: e.sourceApp,
        p_api_key_ref: e.apiKeyRef ?? null,
      }),
    })
    if (!res.ok) {
      const bodyText = await res.text().catch(() => '(unreadable body)')
      console.error(`[ledger] insert failed for ${e.sourceApp}: HTTP ${res.status} — ${bodyText}`)
    }
  } catch (err) {
    console.error(`[ledger] network error for ${e.sourceApp}:`, err)
  }
}
