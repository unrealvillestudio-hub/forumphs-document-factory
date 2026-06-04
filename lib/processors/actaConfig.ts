/**
 * actaConfig.ts — Loads client-specific acta config from FPHS as DATA.
 *
 * Ecosystem principle: client-specific knowledge lives as data (DB), not code.
 * The admin-personnel list (people who are NEVER unit owners — Ivette, Irja,
 * Hypal logistics, etc.) used to be hardcoded in the ICR prompt. Now it comes
 * from acta_admin_personnel so adding/changing staff is an INSERT, no deploy.
 *
 * Ley 284 rules are NOT here: they are Panamanian law, common to every PH and
 * stable, so they live embedded in the agent (not client-specific data).
 */

const FPHS_URL = process.env.FPHS_SUPABASE_URL || ''
const FPHS_KEY = process.env.FPHS_SERVICE_KEY || ''

export interface AdminPerson {
  name: string
  aliases: string[] | null
  role: string | null
}

async function db(table: string, params: string): Promise<unknown[] | null> {
  if (!FPHS_URL || !FPHS_KEY) return null
  const res = await fetch(`${FPHS_URL}/rest/v1/${table}?${params}`, {
    headers: { apikey: FPHS_KEY, Authorization: `Bearer ${FPHS_KEY}`, 'Content-Type': 'application/json' },
    cache: 'no-store',
  })
  if (!res.ok) return null
  const text = await res.text()
  return text ? JSON.parse(text) : null
}

/**
 * Admin personnel for a building (global rows + per-building overrides).
 * Falls back to a minimal hardcoded list if the DB is unreachable, so the
 * agent never loses the most important exclusions on a transient failure.
 */
export async function loadAdminPersonnel(buildingId?: string): Promise<AdminPerson[]> {
  const filter = buildingId
    ? `or=(building_id.is.null,building_id.eq.${buildingId})`
    : `building_id=is.null`
  const rows = await db('acta_admin_personnel', `is_active=eq.true&${filter}&select=name,aliases,role`)
  if (rows && rows.length > 0) return rows as AdminPerson[]
  // Fallback (DB unreachable): keep the critical exclusions.
  return [
    { name: 'Ivette Flores', aliases: ['Ivette'], role: 'gerente' },
    { name: 'Irja Saldaña', aliases: ['Irja'], role: 'administracion' },
    { name: 'Daniel Puentes', aliases: ['Hypal', 'Hipal'], role: 'logistica' },
  ]
}

/** Flatten names + aliases into a single display string for the audit prompt. */
export function adminPersonnelToPromptList(people: AdminPerson[]): string {
  return people
    .map(p => {
      const al = p.aliases && p.aliases.length > 0 ? ` (${p.aliases.join(', ')})` : ''
      return `${p.name}${al}${p.role ? ` — ${p.role}` : ''}`
    })
    .join('; ')
}
