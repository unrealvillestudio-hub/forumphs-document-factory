/**
 * detectPlatform.ts — PR-B
 *
 * Config-driven platform detection. The conventions of each transcription
 * platform (Hypal/Zoom, TOC/HIF, …) live as DATA in the Supabase table
 * `public.df_platform_parsing_config` (UNRLVL project), NOT in code. A new
 * platform = a new row, no code change.
 *
 * Given the transcription text (and optionally the resumen), this returns the
 * config that applies: score each platform by how many of its `detect_signals`
 * (regex) match the text; most signals wins; ties broken by `detect_priority`
 * (higher wins); if nothing matches, the highest-priority platform (hypal) is
 * the default.
 *
 * Reads the table server-side via REST with the UNRLVL service_role key,
 * mirroring lib/processors/fincaLookup.ts. If the table can't be read (missing
 * env, network), it DEGRADES to the hypal default and reports it, so the caller
 * can surface a non-blocking banner. It never throws / never breaks generation.
 */

const UNRLVL_URL =
  process.env.UNRLVL_SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || ''
const UNRLVL_KEY = process.env.unrlvl_service_role || ''

export type Segmentation = 'speaker_colon' | 'prose_paragraph'

export interface PlatformParsingConfig {
  id: string
  display_name?: string | null
  active?: boolean
  detect_signals: string[]
  detect_priority: number
  segmentation: Segmentation
  speaker_line_regex: string | null
  timestamp_regex: string | null
  turn_cues: string[]
  asistencia_header_offset: number | null
  extra?: Record<string, unknown> | null
}

export interface PlatformDetection {
  config: PlatformParsingConfig
  id: string
  source: 'db' | 'fallback'
  error?: string
}

// Hardcoded hypal default — identical to the seed row — so behaviour is unchanged
// when the config table is unreachable (env missing / network / DB paused).
const HYPAL_FALLBACK: PlatformParsingConfig = {
  id: 'hypal',
  display_name: 'Hypal / Zoom',
  active: true,
  detect_priority: 10,
  segmentation: 'speaker_colon',
  speaker_line_regex: '^([A-ZÁÉÍÓÚÑ][^:]{2,60}):\\s*(.*)',
  timestamp_regex:
    '^\\d{2}:\\d{2}:\\d{2}[\\.,]\\d{3}\\s*-->\\s*\\d{2}:\\d{2}:\\d{2}[\\.,]\\d{3}',
  turn_cues: [],
  asistencia_header_offset: 0,
  detect_signals: [],
  extra: null,
}

async function loadConfigs(): Promise<PlatformParsingConfig[] | null> {
  // PR-C §4b — log every degradation reason (never the key), so a Vercel runtime
  // log shows WHY it fell back to Hypal instead of failing invisibly.
  if (!UNRLVL_URL || !UNRLVL_KEY) {
    const missing = [!UNRLVL_URL && 'UNRLVL_SUPABASE_URL/NEXT_PUBLIC_SUPABASE_URL', !UNRLVL_KEY && 'unrlvl_service_role']
      .filter(Boolean).join(' + ')
    console.error(`[detectPlatform] config unreadable, degrading to hypal: missing env ${missing}`)
    return null
  }
  try {
    const res = await fetch(
      `${UNRLVL_URL}/rest/v1/df_platform_parsing_config?active=eq.true&select=*`,
      {
        headers: {
          apikey: UNRLVL_KEY,
          Authorization: `Bearer ${UNRLVL_KEY}`,
          'Content-Type': 'application/json',
        },
        cache: 'no-store',
      },
    )
    if (!res.ok) {
      console.error(`[detectPlatform] config unreadable, degrading to hypal: HTTP ${res.status}`)
      return null
    }
    const text = await res.text()
    const rows = text ? JSON.parse(text) : null
    if (!Array.isArray(rows) || rows.length === 0) {
      console.error('[detectPlatform] config unreadable, degrading to hypal: no active rows returned')
      return null
    }
    return rows as PlatformParsingConfig[]
  } catch (err) {
    console.error('[detectPlatform] config unreadable, degrading to hypal:', err instanceof Error ? err.message : String(err))
    return null
  }
}

function countSignals(cfg: PlatformParsingConfig, text: string): number {
  let score = 0
  for (const sig of cfg.detect_signals || []) {
    if (!sig) continue
    try {
      if (new RegExp(sig, 'i').test(text)) score++
    } catch {
      // A malformed regex in config never breaks detection — just doesn't score.
    }
  }
  return score
}

export async function detectPlatform(
  transcripcion: string,
  resumen?: string,
): Promise<PlatformDetection> {
  const text = `${transcripcion || ''}\n${resumen || ''}`
  const rows = await loadConfigs()

  if (!rows) {
    // Config unreadable → degrade to hypal, flag it so the route warns.
    return { config: HYPAL_FALLBACK, id: 'hypal', source: 'fallback', error: 'config_unavailable' }
  }

  // Most signals wins; ties → higher detect_priority. When nothing matches, every
  // score is 0 and this same rule falls back to the highest-priority platform.
  let best = rows[0]
  let bestScore = countSignals(rows[0], text)
  for (let i = 1; i < rows.length; i++) {
    const cfg = rows[i]
    const score = countSignals(cfg, text)
    if (score > bestScore || (score === bestScore && cfg.detect_priority > best.detect_priority)) {
      best = cfg
      bestScore = score
    }
  }

  return { config: best, id: best.id, source: 'db' }
}
