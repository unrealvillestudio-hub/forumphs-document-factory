/**
 * fincaLookup.ts — Deterministic unit→finca resolution (Fase 2 wiring).
 *
 * Ley 284: each unit carries its own finca (finca hija de la matriz). The acta
 * attendance table should show the per-unit finca, not just the building's.
 *
 * DESIGN (locked decisions, session_log 2026-06-01):
 *   - Lookup is DETERMINISTIC SQL via canonical_key — NEVER the agent. A JOIN
 *     can't hallucinate a finca; an agent could "complete" a missing one and
 *     reintroduce the very input error Ivette does by hand today.
 *   - The DB column units.canonical_key is the persisted source of truth.
 *   - A transcribed unit string ("07A | Torre A") is normalized to the SAME
 *     canonical form, then matched against the column.
 *   - No match / null finca → '[FINCA PENDIENTE]', surfaced as an ICR warning
 *     (closes the loop: Ivette sees exactly what's missing).
 *
 * This module reads FPHS (sensitive data) via REST, mirroring app/bi/data.
 */

const FPHS_URL = process.env.FPHS_SUPABASE_URL || ''
const FPHS_KEY = process.env.FPHS_SERVICE_KEY || ''

export const FINCA_PENDIENTE = '[FINCA PENDIENTE]'

export interface NormalizationRule {
  source_pattern: string
  tower_strategy: 'explicit' | 'embedded_prefix' | 'none'
  canonical_template: string
  priority: number
}

export interface UnitFinca {
  unit_code: string
  tower: string | null
  canonical_key: string | null
  finca: string | null
}

interface FincaResolution {
  finca: string                // resolved finca OR FINCA_PENDIENTE
  matched: boolean
  canonical_key: string | null
  reason?: 'no_canonical' | 'no_unit_match' | 'null_finca'
}

async function db(table: string, params: string): Promise<unknown[] | null> {
  if (!FPHS_URL || !FPHS_KEY) return null
  try {
    const res = await fetch(`${FPHS_URL}/rest/v1/${table}?${params}`, {
      headers: { apikey: FPHS_KEY, Authorization: `Bearer ${FPHS_KEY}`, 'Content-Type': 'application/json' },
      cache: 'no-store',
    })
    if (!res.ok) return null
    const text = await res.text()
    return text ? JSON.parse(text) : null
  } catch {
    // Network-level failure (DB paused, DNS error, etc.) — throw a tagged error
    // so the generate route can distinguish "configured but unreachable" from
    // "not configured" (env vars missing) and surface a visible ICR warning.
    throw new Error('FPHS_DB_NETWORK_ERROR')
  }
}

/**
 * Normalize an incoming unit string to the SAME canonical form the DB column
 * uses. Mirrors the SQL normalize_unit() logic in TypeScript so the matching
 * key is computed identically on both sides.
 *
 * `rules` are the building_normalization rows for this building (priority asc).
 * `tower` is the tower hint parsed from the transcription, if any.
 */
export function normalizeUnitTS(
  rawUnit: string,
  tower: string | null,
  rules: NormalizationRule[],
): string | null {
  if (!rawUnit) return null
  const cleaned = rawUnit.trim()

  for (const rule of [...rules].sort((a, b) => a.priority - b.priority)) {
    // Convert (?<name>...) to plain capturing groups + collect names in order.
    const names: string[] = []
    const nameRe = /\(\?<([a-z]+)>/g
    let nm: RegExpExecArray | null
    while ((nm = nameRe.exec(rule.source_pattern)) !== null) names.push(nm[1])
    const jsPattern = rule.source_pattern.replace(/\(\?<[a-z]+>/g, '(')

    let re: RegExp
    try { re = new RegExp(jsPattern) } catch { continue }
    const m = cleaned.match(re)
    if (!m) continue

    let key = rule.canonical_template
    names.forEach((g, i) => { key = key.replace(`{${g}}`, m[i + 1] ?? '') })
    if (rule.tower_strategy === 'explicit') {
      key = key.replace('{tower}', (tower || 'NA').toUpperCase())
    }
    key = key.replace('{tower}', '')
    return key.toUpperCase().replace(/\s+/g, '')
  }
  return null
}

/**
 * Load all units (code, tower, canonical_key, finca) for a building, plus its
 * normalization rules. One round-trip pair per acta build; callers cache.
 */
export async function loadBuildingFincas(buildingId: string): Promise<{
  units: UnitFinca[]
  rules: NormalizationRule[]
} | null> {
  const [units, rules] = await Promise.all([
    db('units', `building_id=eq.${buildingId}&select=unit_code,tower,canonical_key,finca`),
    db('building_normalization', `building_id=eq.${buildingId}&is_active=eq.true&select=source_pattern,tower_strategy,canonical_template,priority&order=priority.asc`),
  ])
  if (units === null) return null
  return {
    units: (units as UnitFinca[]),
    rules: (rules as NormalizationRule[]) || [],
  }
}

/**
 * Resolve a building_id from a PH name when the skeleton doesn't carry one.
 * Matching is tolerant: the transcription says "PH VENEZIA TOWER" while the DB
 * row is "Venezia Tower". We compare on a normalized core (strip "PH"/"P.H.",
 * punctuation, accents, lowercase) and require a containment match.
 * Returns null if no confident single match (caller surfaces as warning).
 */
export async function resolveBuildingId(phName: string): Promise<string | null> {
  if (!phName) return null
  const rows = await db('buildings', 'select=id,name')
  if (!rows) return null
  // Normalize to significant tokens: drop PH/P.H./Don, accents, punctuation.
  const tokens = (s: string) => s
    .toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/\bp\.?h\.?\b/g, ' ').replace(/\bdon\b/g, ' ').replace(/\benrique\b/g, ' ')
    .replace(/\btowers?\b/g, ' ')                 // "Tower(s)" is noise across names
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/).filter(t => t.length > 1)
  const target = new Set(tokens(phName))
  if (target.size === 0) return null
  // A building matches if every significant token of the SHORTER name set is
  // present in the other — distinctive identifiers (luxor, 300, venezia) must align.
  const matches = (rows as { id: string; name: string }[]).filter(b => {
    const bset = new Set(tokens(b.name))
    if (bset.size === 0) return false
    const [small, big] = target.size <= bset.size ? [target, bset] : [bset, target]
    let all = true
    for (const t of small) if (!big.has(t)) { all = false; break }
    return all
  })
  return matches.length === 1 ? matches[0].id : null
}

/**
 * Deterministic total-units lookup. The total number of units in a PH is a
 * REGISTRY fact (buildings.total_units, from the Registro Público), NOT something
 * to derive from a parsed attendance sheet. Same master rule as finca: an exact
 * datum that exists in the DB must come from the DB — never from the document.
 *
 * Returns the building's total_units, or null if unavailable (caller falls back
 * to the parsed/skeleton value only as a last resort). A null here is preferable
 * to trusting a bad parse: it's what produced the 254% quorum bug (Luxor 300
 * parsed 46, DB has 143).
 */
export async function getBuildingTotalUnits(buildingId: string): Promise<number | null> {
  if (!buildingId) return null
  const rows = await db('buildings', `id=eq.${buildingId}&select=total_units&limit=1`)
  if (!rows || rows.length === 0) return null
  const tu = (rows[0] as { total_units?: number | null }).total_units
  return typeof tu === 'number' && tu > 0 ? tu : null
}

/**
 * Convenience: resolve fincas for a list of attendance units in one shot.
 * Returns the enriched records plus the list of unresolved units (for ICR
 * warnings). Pure orchestration over loadBuildingFincas + resolveFinca.
 */
export async function enrichAttendanceWithFincas(
  buildingId: string,
  attendance: { unit: string; tower?: string | null }[],
): Promise<{
  fincaByUnit: Record<string, string>
  pendientes: string[]
} | null> {
  const data = await loadBuildingFincas(buildingId)
  if (!data) return null
  const fincaByUnit: Record<string, string> = {}
  const pendientes: string[] = []
  for (const rec of attendance) {
    const res = resolveFinca(rec.unit, rec.tower ?? null, data)
    fincaByUnit[rec.unit] = res.finca
    if (!res.matched) pendientes.push(rec.unit)
  }
  return { fincaByUnit, pendientes }
}

/**
 * Resolve a transcribed unit string to its finca via canonical_key.
 * Pure/deterministic given the loaded building data — no network, no agent.
 */
export function resolveFinca(
  rawUnit: string,
  tower: string | null,
  data: { units: UnitFinca[]; rules: NormalizationRule[] },
): FincaResolution {
  const ck = normalizeUnitTS(rawUnit, tower, data.rules)
  if (!ck) return { finca: FINCA_PENDIENTE, matched: false, canonical_key: null, reason: 'no_canonical' }

  const hit = data.units.find(u => u.canonical_key === ck)
  if (!hit) return { finca: FINCA_PENDIENTE, matched: false, canonical_key: ck, reason: 'no_unit_match' }
  if (!hit.finca) return { finca: FINCA_PENDIENTE, matched: false, canonical_key: ck, reason: 'null_finca' }

  return { finca: hit.finca, matched: true, canonical_key: ck }
}
