/**
 * genderConsolidation.ts — GAP 3 (generator layer, NOT the EF).
 *
 * The EF resolves gender block-by-block from LOCAL context, so the SAME person
 * can come out "la señora" in one paragraph and "el señor" in another (the Greyz
 * Becerra oscillation). This pass adds the missing step: resolve gender ONCE per
 * person from ALL their blocks' evidence together, then apply that single form to
 * every block of that person. The EF is untouched.
 *
 * Determination rule (Sam's principle — "que LEA más"):
 *   - Count gender signals across ALL of a person's formalized text: resolved
 *     treatments (señora/señor, doña/don) and unit concordance (propietaria/
 *     propietario). Dual templates ("La señora/El señor", "propietario/a") are
 *     stripped first so they never count as both.
 *   - Majority wins. Tie or no signal at all → indeterminate: keep the dual form
 *     and surface a MEDIUM ICR warning (handled by the caller).
 *   - NEVER infer from the name's ending — only aggregated grammatical evidence.
 *
 * Administration/abogado blocks are excluded: their treatment has no
 * "señora/señor" article (the EF renders "**Name**, en representación de la
 * administración,"), so the consolidation does not apply to them.
 */

import type { DebateBlock } from '../types'

type Gender = 'F' | 'M'
const ADMIN_ROLES = new Set(['administracion', 'abogado'])

function normName(s: string): string {
  return (s || '')
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toLowerCase().trim().replace(/\s+/g, ' ')
}

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/** Strip dual templates, then count female vs male grammatical signals. */
function countSignals(text: string): { f: number; m: number } {
  const t = text
    .replace(/la señora\s*\/\s*el señor/gi, ' ')
    .replace(/el señor\s*\/\s*la señora/gi, ' ')
    .replace(/señora\s*\/\s*señor/gi, ' ')
    .replace(/señor\s*\/\s*señora/gi, ' ')
    .replace(/propietario\s*\/\s*a/gi, ' ')
    .replace(/propietaria\s*\/\s*o/gi, ' ')
  const f = (t.match(/\b(señora|doña|propietaria)\b/gi) || []).length
  const m = (t.match(/\b(señor|don|propietario)\b/gi) || []).length
  return { f, m }
}

/** Apply one consolidated gender to a single block's text, anchored to the speaker. */
function applyGender(text: string, name: string, g: Gender): string {
  const art = g === 'F' ? 'La señora' : 'El señor'
  const artLow = g === 'F' ? 'la señora' : 'el señor'
  const prop = g === 'F' ? 'propietaria' : 'propietario'
  const nameRe = escapeRe(name.trim())
  const beforeName = `(\\s+(?:\\*\\*\\s*)?${nameRe})`

  return text
    // 1) dual article right before the speaker name → consolidated
    .replace(new RegExp(`(?:La señora\\s*/\\s*El señor|El señor\\s*/\\s*La señora)${beforeName}`, 'g'), `${art}$1`)
    // 2) wrong-but-resolved article right before the speaker name → consolidated
    .replace(new RegExp(`(?:La señora|El señor)${beforeName}`, 'g'), `${art}$1`)
    .replace(new RegExp(`(?:la señora|el señor)${beforeName}`, 'g'), `${artLow}$1`)
    // 3) any remaining bare dual article in the speaker's own block → consolidated
    .replace(/La señora\s*\/\s*El señor/g, art)
    .replace(/El señor\s*\/\s*La señora/g, art)
    .replace(/la señora\s*\/\s*el señor/g, artLow)
    .replace(/el señor\s*\/\s*la señora/g, artLow)
    // 4) unit concordance: dual then resolved → consolidated
    .replace(/propietario\s*\/\s*a/gi, prop)
    .replace(/propietaria\s*\/\s*o/gi, prop)
    .replace(/\bpropietari[oa]\b(\s+de la unidad)/gi, `${prop}$1`)
}

/**
 * Force a person's blocks to a UNIFORM dual form ("La señora/El señor",
 * "propietario/a"). Used when gender is indeterminate: the acta must not
 * oscillate — every block shows the same dual, and a warning flags it.
 */
function applyDual(text: string, name: string): string {
  const nameRe = escapeRe(name.trim())
  const beforeName = `(\\s+(?:\\*\\*\\s*)?${nameRe})`
  return text
    // resolved or dual article before the speaker name → canonical dual
    .replace(new RegExp(`(?:La señora\\s*/\\s*El señor|El señor\\s*/\\s*La señora|La señora|El señor)${beforeName}`, 'g'), `La señora/El señor$1`)
    .replace(new RegExp(`(?:la señora\\s*/\\s*el señor|el señor\\s*/\\s*la señora|la señora|el señor)${beforeName}`, 'g'), `la señora/el señor$1`)
    // unit concordance → canonical dual
    .replace(/propietaria\s*\/\s*o(\s+de la unidad)/gi, `propietario/a$1`)
    .replace(/\bpropietari[oa]\b(\s+de la unidad)/gi, `propietario/a$1`)
}

export interface GenderConsolidationResult {
  blocks: DebateBlock[]
  indeterminate: string[]   // display speaker_names left in dual form
}

/**
 * Resolve each owner's gender once (from all their blocks' aggregated evidence)
 * and rewrite every block of that person to the single consolidated form.
 */
export function consolidateGender(blocks: DebateBlock[]): GenderConsolidationResult {
  // Group eligible (owner, non-skipped, formalized) blocks by normalized name.
  const groups = new Map<string, { name: string; idx: number[] }>()
  blocks.forEach((b, i) => {
    if (!b || b.skip || !b.text_formal) return
    if (ADMIN_ROLES.has(b.speaker_role)) return
    const key = normName(b.speaker_name)
    if (!key) return
    if (!groups.has(key)) groups.set(key, { name: b.speaker_name, idx: [] })
    groups.get(key)!.idx.push(i)
  })

  const out = [...blocks]
  const indeterminate: string[] = []

  for (const { name, idx } of groups.values()) {
    let f = 0, m = 0
    for (const i of idx) {
      const s = countSignals(out[i].text_formal || '')
      f += s.f; m += s.m
    }
    if (f === m) {
      // Tie or no signal → indeterminate. Normalize to a UNIFORM dual so the
      // acta stops oscillating, and flag the person for manual confirmation.
      indeterminate.push(name)
      for (const i of idx) {
        out[i] = { ...out[i], text_formal: applyDual(out[i].text_formal || '', name) }
      }
      continue
    }
    const g: Gender = f > m ? 'F' : 'M'
    for (const i of idx) {
      out[i] = { ...out[i], text_formal: applyGender(out[i].text_formal || '', name, g) }
    }
  }

  return { blocks: out, indeterminate }
}
