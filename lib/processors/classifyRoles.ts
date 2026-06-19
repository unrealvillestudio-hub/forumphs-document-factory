/**
 * classifyRoles.ts — GAP 5 (generator layer, NOT the EF).
 *
 * Principle (Sam): the system does NOT guess identities. It classifies each
 * speaker ONLY with deterministic crosses; anything it can't resolve with
 * certainty it MARKS for Ivette via ICR. "Lorena" can be several people — the DF
 * must not choose.
 *
 * Per speaker, in order:
 *   1. Speaker carries a UNIT and that unit is in the acta attendance roster
 *      → PROPIETARIO/A of that unit. (Cross by UNIT, deterministic — never by name.)
 *      Gender consolidation (GAP 3) then applies the treatment.
 *   2. No unit → name/alias EXACT in acta_admin_personnel → verified admin role.
 *   3. Neither → do NOT assert a role: mark [ROL NO VERIFICADO] + ICR finding.
 *      HIGH if it looks like a real uncatalogued person, MEDIUM if it looks like a
 *      transcription error.
 *
 * FORBIDDEN: partial name match against the roster; defaulting to "administración";
 * auto-populating acta_admin_personnel; inferring identity from dubious names.
 */

import type { DebateBlock, AttendanceRecord } from '../types'
import { loadAdminPersonnel, type AdminPerson } from './actaConfig'

export const ROLE_MARK = '[ROL NO VERIFICADO]'

export interface UnverifiedSpeaker {
  name: string
  section?: number
  fragment: string
  severity: 'HIGH' | 'MEDIUM'
}

export interface RoleClassificationResult {
  blocks: DebateBlock[]
  unverified: UnverifiedSpeaker[]
}

function norm(s: string): string {
  return (s || '').normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toLowerCase().trim().replace(/\s+/g, ' ')
}
function esc(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

// A label segment that describes a unit (not a person's name).
function looksLikeUnitSeg(s: string): boolean {
  return /\b(?:apartamento|apto|torre|local|oficina)\b/i.test(s) ||
         /\bt\s*\d{1,3}\b/i.test(s) ||
         /\b\d{1,4}\s?[a-z]\b/i.test(s) ||
         /\bt[ab]\b/i.test(s)
}

// The unit-bearing segment of a Zoom label ("Apartamento 13H TB | Greyz" → that
// left segment), or null when the speaker carries no unit ("Ivette Flores").
function unitSegment(speakerRaw: string): string | null {
  const parts = (speakerRaw || '').split('|').map(x => x.trim()).filter(Boolean)
  if (parts.length > 1) return parts.find(looksLikeUnitSeg) || null
  return looksLikeUnitSeg(speakerRaw || '') ? speakerRaw : null
}

// Comparable unit key. Apartments → "{floor}{letter}" (e.g. "13H"), tower prefix
// and "Apartamento" wording stripped. Others (locales) → alphanumeric upper.
export function unitCoreKey(s: string): string {
  const m = (s || '').match(/(\d{1,3})\s*-?\s*([A-H])\b/i)
  if (m) return `${m[1]}${m[2].toUpperCase()}`
  return (s || '').toUpperCase().replace(/[^A-Z0-9]/g, '')
}

function adminMatch(name: string, admins: AdminPerson[]): boolean {
  const n = norm(name)
  if (!n) return false
  for (const a of admins) {
    if (norm(a.name) === n) return true
    for (const al of a.aliases || []) if (norm(al) === n) return true
  }
  return false
}

// HIGH = looks like a real (multi-token) person not catalogued; MEDIUM = single
// token / likely ASR noise. Triage hint only — every unverified is marked + flagged.
// NOTE: never uses a name dictionary (forbidden) — only token shape.
function severityFor(name: string): 'HIGH' | 'MEDIUM' {
  const tokens = (name || '').trim().split(/\s+/).filter(t => t.replace(/[^a-záéíóúñ]/gi, '').length >= 2)
  return tokens.length >= 2 ? 'HIGH' : 'MEDIUM'
}

// ── Prefix rewrites (anchored on the speaker's name) ────────────────────────
// The EF baked the role treatment into text_formal. When our deterministic cross
// disagrees, rewrite the leading treatment to match — best effort; if Claude
// varied the wording the regex simply no-ops and the ICR finding still fires.

function toOwnerForm(text: string, name: string, unit: string): string {
  const unitClause = unit ? `, propietario/a de la unidad inmobiliaria ${unit}` : ''
  return text.replace(
    new RegExp(`\\*\\*\\s*${esc(name)}\\s*\\*\\*,\\s*en representación de la administración,`, 'g'),
    `La señora/El señor **${name}${unitClause}**,`,
  )
}

function toAdminForm(text: string, name: string): string {
  return text.replace(
    new RegExp(`(?:La señora/El señor|La señora|El señor)\\s+\\*\\*\\s*${esc(name)}[^*]*\\*\\*,`, 'g'),
    `**${name}**, en representación de la administración,`,
  )
}

function markUnverified(text: string, name: string): string {
  let t = text
    // drop the false "en representación de la administración" claim
    .replace(/,?\s*en representación de la administración,?/gi, ', ')
    // drop an unverified ownership descriptor inside the name bold
    .replace(new RegExp(`(\\*\\*\\s*${esc(name)})[^*]*?(\\*\\*)`, 'g'), '$1$2')
    // drop the leading señora/señor treatment article before the name
    .replace(new RegExp(`(?:La señora/El señor|La señora|El señor)\\s+(\\*\\*\\s*${esc(name)})`, 'g'), '$1')
  if (!t.includes(ROLE_MARK)) t = `${ROLE_MARK} ${t}`
  return t.replace(/\s{2,}/g, ' ').trim()
}

/**
 * Classify each speaker deterministically and reconcile the rendered treatment.
 * Pure over its inputs except for the one admin-personnel DB read (cached by
 * caller via buildingId). Runs BEFORE gender consolidation so reclassified owners
 * get their gendered treatment and admins/unverified are excluded from it.
 */
export async function classifyRoles(
  blocks: DebateBlock[],
  attendance: AttendanceRecord[],
  buildingId?: string,
): Promise<RoleClassificationResult> {
  const admins = await loadAdminPersonnel(buildingId)
  const rosterKeys = new Set((attendance || []).map(a => unitCoreKey(a.unit)))
  const rosterByKey = new Map<string, string>()
  for (const a of attendance || []) rosterByKey.set(unitCoreKey(a.unit), a.unit)

  const out = [...blocks]
  const unverified: UnverifiedSpeaker[] = []

  for (let i = 0; i < out.length; i++) {
    const b = out[i]
    if (!b || b.skip || !b.text_formal) continue

    // Step 1 — UNIT cross (deterministic, never by name).
    const seg = unitSegment(b.speaker_raw || '')
    let ownerUnit: string | null = null
    for (const cand of [seg, b.speaker_unit]) {
      if (!cand) continue
      const key = unitCoreKey(cand)
      if (rosterKeys.has(key)) { ownerUnit = rosterByKey.get(key) || cand; break }
    }

    if (ownerUnit) {
      const role = b.speaker_role === 'propietaria' ? 'propietaria' : 'propietario'
      out[i] = { ...b, speaker_role: role, text_formal: toOwnerForm(b.text_formal, b.speaker_name, ownerUnit) }
      continue
    }

    // Step 2 — verified admin (EXACT name/alias).
    if (adminMatch(b.speaker_name, admins)) {
      out[i] = { ...b, speaker_role: 'administracion', text_formal: toAdminForm(b.text_formal, b.speaker_name) }
      continue
    }

    // Step 3 — unresolved: do not assert a role; mark + flag.
    const severity = severityFor(b.speaker_name)
    out[i] = { ...b, speaker_role: 'unknown', text_formal: markUnverified(b.text_formal, b.speaker_name) }
    unverified.push({
      name: b.speaker_name || '(sin nombre)',
      section: b.agenda_section,
      fragment: (b.text_raw || b.text_formal || '').slice(0, 90),
      severity,
    })
  }

  return { blocks: out, unverified }
}
