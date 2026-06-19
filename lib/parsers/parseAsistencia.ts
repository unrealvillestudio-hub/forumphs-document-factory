/**
 * parseAsistencia.ts — v2
 * Handles Hypal's actual XLSX format:
 * Headers: 247 | Unidad | Participante | Ingreso | Salida | Asistencia | ...
 *
 * parseVotaciones — v2
 * Hypal votaciones format: one sheet per question.
 * The question is the first column header key.
 * Each row = one apartment vote (Si/No).
 * Summary rows have __EMPTY_2=Si/No, __EMPTY_3=count, __EMPTY_4=pct
 */

import type { AttendanceRecord, VotationRecord } from '../types'

// ── Header-tolerant column lookup ───────────────────────────────────────────
// Hypal/Zoom exports vary the exact header text per PH ("Unidad" vs "Unidades",
// "Asistencia" vs "Asistente", "Número"…). Matching exact literals is brittle —
// it broke ingesta three times (torre, votaciones, and the Venezia quórum-0).
// We normalize each header (trim + lowercase + strip accents) and match by
// stem/inclusion, so a new header variant resolves WITHOUT a code change. The
// stems are a superset of the old exact literals, so previously-working PHs
// (Castilla, Lefevre…) keep matching.
function normHeader(s: string): string {
  return s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim()
}

// First NON-EMPTY value among columns whose normalized header matches `pred`.
// Preserves the old `row['A'] || row['B'] || …` "first non-empty wins" behavior.
function pickField(row: Record<string, unknown>, pred: (nk: string) => boolean): string {
  for (const k of Object.keys(row)) {
    if (!pred(normHeader(k))) continue
    const v = row[k]
    if (v !== null && v !== undefined && String(v).trim() !== '') return String(v).trim()
  }
  return ''
}

const isUnitHeader   = (nk: string) => nk.startsWith('unidad') || nk.startsWith('unit') || nk.startsWith('numero') || nk.startsWith('apartamento') || nk.startsWith('apto')
const isOwnerHeader  = (nk: string) => nk.startsWith('participante') || nk.startsWith('propietario') || nk.startsWith('nombre') || nk.startsWith('owner')
const isRepHeader    = (nk: string) => nk.startsWith('representado') || nk.startsWith('representante') || nk.startsWith('representative') || nk.startsWith('apoderad')
const isStatusHeader = (nk: string) => nk.includes('asist') || nk.includes('estado')

// ── Tower suffix extraction ─────────────────────────────────────────────────
// Some PHs encode the tower as a suffix inside the unit cell: "10A TA" (Torre A),
// "9H TB" (Torre B), and for commercial units "Local 1 TA" / "2 TB".
// We ALWAYS capture the tower (→ AttendanceRecord.tower, used by the acta table
// and by buildings whose normalization is tower-aware). We only STRIP the suffix
// from RESIDENTIAL codes ("10A TA" → "10A") so the per-letter normalization rules
// match. For locales the raw string is PRESERVED, because their DB rules
// (e.g. `^(?:Local\s*)?\d+\s+T(?<unit>[AB])$`) need the suffix to derive the tower.
function splitUnitTower(raw: string): { unit: string; tower?: string } {
  const m = raw.match(/^(.+?)\s+T([A-H])$/i)
  if (!m) return { unit: raw }
  const tower = m[2].toUpperCase()
  const stripped = m[1].trim()
  if (/^\d{1,2}[A-H]$/i.test(stripped)) return { unit: stripped, tower }
  return { unit: raw, tower }   // local: keep raw string for the locale rules
}

export function parseAsistencia(rows: Record<string, unknown>[]): AttendanceRecord[] {
  const records: AttendanceRecord[] = []

  for (const row of rows) {
    // Header-tolerant lookup. Hypal: 'Unidades'/'Asistente'. Luxor: 'Número'/'Estado'.
    const rawUnit = pickField(row, isUnitHeader)
    const owner   = pickField(row, isOwnerHeader)
    let rep       = pickField(row, isRepHeader)

    // Skip header-like rows and empty rows
    if (!rawUnit || !owner) continue
    const lu = rawUnit.toLowerCase()
    if (lu === 'unidad' || lu === 'unidades' || lu === 'apartamento') continue
    if (owner.toLowerCase() === 'participante') continue

    // Attendance status. Hypal: 'Asistencia'/'Asistente' ("Presente"/"Apoderado").
    // Luxor: 'Estado' (ASISTIÓ / REPRESENTADO / AUSENTE). Only absent are excluded;
    // 'Apoderado'/'Representado' count toward the quorum (represented by proxy).
    const asistencia = pickField(row, isStatusHeader) || 'Presente'
    if (asistencia.toLowerCase() === 'ausente') continue

    // 'REPRESENTADO' with no representative name found → mark as represented
    if (asistencia.toLowerCase() === 'representado' && !rep) {
      rep = 'Representado'
    }

    // Split the tower suffix ("10A TA") and clean residential codes for lookup.
    const { unit, tower } = splitUnitTower(rawUnit)

    records.push({
      unit,
      owner_name: owner,
      represented_by: rep || undefined,
      tower,
    })
  }

  return records
}

// ── Vote-value classification ───────────────────────────────────────────────
// Robust to wording variations across Hypal exports (Sí/No, A favor/En contra,
// Aprobado/Rechazado, abstención…). Vote cells are short labels, never sentences.
function classifyVote(raw: unknown): 'yes' | 'no' | 'abstain' | null {
  const v = String(raw ?? '').trim().toLowerCase().replace(/\s+/g, ' ').replace(/[.,;:]+$/, '').trim()
  if (!v || v.length > 25) return null
  if (/^(s[íi]|si aprueba|s[íi] aprueba|s[íi] apruebo|a favor|afavor|favor|aprobad[oa]|apruebo|aprueba|afirmativ[oa]|de acuerdo)$/.test(v)) return 'yes'
  if (/^(no|no aprueba|no apruebo|en contra|contra|rechazad[oa]|negativ[oa]|desaprob[a-z]*)$/.test(v)) return 'no'
  if (/^(abstenci[oó]n|abstencion|abstenid[oa]|abstien[a-z]*|en blanco|blanco|nul[oa])$/.test(v)) return 'abstain'
  return null
}

interface VoteBlock { topic: string; rows: Record<string, unknown>[] }

function tallyBlock(sheetTopic: string, rows: Record<string, unknown>[]): VotationRecord | null {
  if (rows.length === 0) return null

  // ── Topic ──────────────────────────────────────────────────────────────────
  // Legacy Hypal encodes the question in the first column's key ("Pregunta:¿…?").
  // Offset-header sheets put the question directly in that key. Otherwise fall back
  // to the sheet name supplied by the multi-sheet sentinel.
  const keys = Object.keys(rows[0]).filter(k => k !== '__SHEET_NAME' && k !== '__IS_SHEET_HEADER')
  const firstKey = keys[0] || ''
  const qMatch = firstKey.match(/Pregunta[:\s]*(.+)/i)
  let topic = qMatch ? qMatch[1].trim() : ''
  if (!topic && (/[¿?]/.test(firstKey) || firstKey.trim().split(/\s+/).length >= 4)) topic = firstKey.trim()
  if (!topic) topic = (sheetTopic || firstKey).trim()
  if (!topic) return null

  // ── Dynamic summary row scan ───────────────────────────────────────────────
  // Finds vote label in any __EMPTY_N column, reads count from __EMPTY_N+1.
  // Handles both legacy (label in __EMPTY_2) and Venezia (label in __EMPTY_3)
  // without hardcoding the offset. Safe against per-vote rows: their adjacent
  // cells are empty so Number("") = 0 fails the > 0 guard.
  let summaryYes: number | null = null
  let summaryNo: number | null = null
  let summaryPct: number | null = null
  for (const row of rows) {
    for (const k of Object.keys(row)) {
      if (!k.startsWith('__EMPTY_')) continue
      const vote = classifyVote(row[k])
      if (vote !== 'yes' && vote !== 'no') continue
      const keyNum = parseInt(k.slice('__EMPTY_'.length), 10)
      if (isNaN(keyNum)) continue
      const cnt = row[`__EMPTY_${keyNum + 1}`]
      const n = cnt !== '' && cnt !== undefined ? Number(cnt) : NaN
      if (!isNaN(n) && n > 0) {
        if (vote === 'yes') {
          summaryYes = n
          const pctv = row[`__EMPTY_${keyNum + 2}`]
          if (pctv !== '' && pctv !== undefined && !isNaN(Number(pctv)))
            summaryPct = Math.round(Number(pctv) * 10000) / 100
        } else {
          summaryNo = n
        }
      }
    }
  }

  // ── Auto-detect the vote column ──────────────────────────────────────────────
  // The vote column is the one whose cells most often read as a vote. This is robust
  // to arbitrary column names ('Resultado', 'Voto', '__EMPTY_n'…) and to title/offset
  // header rows, which the old fixed-column lookup could not handle.
  const colHits = new Map<string, number>()
  for (const row of rows) {
    for (const k of Object.keys(row)) {
      if (k === '__SHEET_NAME' || k === '__IS_SHEET_HEADER') continue
      if (classifyVote(row[k])) colHits.set(k, (colHits.get(k) || 0) + 1)
    }
  }
  let voteKey = ''
  let bestHits = 0
  for (const [k, c] of colHits) { if (c > bestHits) { bestHits = c; voteKey = k } }

  let yes = 0, no = 0, abstain = 0
  if (voteKey) {
    for (const row of rows) {
      const v = classifyVote(row[voteKey])
      if (v === 'yes') yes++
      else if (v === 'no') no++
      else if (v === 'abstain') abstain++
    }
  }

  // ── Multi-candidate election detection (F5-placeholder) ─────────────────────
  // When no binary vote column was detected and the summary scan also failed,
  // check if any __EMPTY_* column has non-trivial string values (candidate names).
  // If so, this is a multi-candidate election — don't emit a false "0/0 → NO APROBADO".
  if (!voteKey && summaryYes === null) {
    const hasCandidateContent = rows.some(r =>
      Object.keys(r).some(k => {
        if (!k.startsWith('__EMPTY_')) return false
        const s = String(r[k] ?? '').trim()
        return s.length > 5 && s.length <= 80
      })
    )
    if (hasCandidateContent) {
      return {
        topic,
        yes_votes: 0,
        no_votes: 0,
        pct_yes: 0,
        approved: false,
        candidate_election: true,
      }
    }
  }

  // Prefer explicit summary counts when present; otherwise use the per-row tally.
  const finalYes = summaryYes !== null ? summaryYes : yes
  const finalNo = summaryNo !== null ? summaryNo : no
  const finalPct = summaryPct !== null
    ? summaryPct
    : (finalYes + finalNo > 0 ? Math.round((finalYes / (finalYes + finalNo)) * 10000) / 100 : 0)

  return {
    topic,
    yes_votes: finalYes,
    no_votes: finalNo,
    abstentions: abstain || undefined,
    pct_yes: finalPct,
    approved: finalYes > finalNo,
  }
}

export function parseVotaciones(rows: Record<string, unknown>[]): VotationRecord[] {
  if (!rows || rows.length === 0) return []

  // Multi-sheet: zipExtractor prefixes each sheet's rows with a sentinel
  // { __SHEET_NAME, __IS_SHEET_HEADER }. Split into one block (question) per sheet.
  // Legacy single-sheet input arrives with no sentinel → a single block.
  const blocks: VoteBlock[] = []
  let current: VoteBlock | null = null
  for (const row of rows) {
    if (String(row['__IS_SHEET_HEADER'] || '') === 'true') {
      if (current) blocks.push(current)
      current = { topic: String(row['__SHEET_NAME'] || '').trim(), rows: [] }
    } else {
      if (!current) current = { topic: '', rows: [] }
      current.rows.push(row)
    }
  }
  if (current) blocks.push(current)

  const records: VotationRecord[] = []
  for (const block of blocks) {
    const rec = tallyBlock(block.topic, block.rows)
    if (rec) records.push(rec)
  }
  return records
}

