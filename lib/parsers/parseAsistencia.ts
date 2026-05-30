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

export function parseAsistencia(rows: Record<string, unknown>[]): AttendanceRecord[] {
  const records: AttendanceRecord[] = []

  for (const row of rows) {
    // Unit code. Hypal: 'Unidad'. Luxor: 'Número' (e.g. 'T3 07D').
    const unit =
      String(row['Unidad'] || row['UNIDAD'] || row['unidad'] ||
             row['Número'] || row['NUMERO'] || row['Numero'] ||
             row['Apartamento'] || row['Unit'] || row['APARTAMENTO'] || '').trim()

    const owner =
      String(row['Participante'] || row['PARTICIPANTE'] ||
             row['Propietario'] || row['PROPIETARIO'] ||
             row['Nombre'] || row['NOMBRE'] || row['Owner'] || '').trim()

    let rep =
      String(row['Representado por'] || row['REPRESENTADO POR'] ||
             row['Representante'] || row['REPRESENTANTE'] ||
             row['Apoderado'] || row['APODERADO'] ||
             row['Representative'] || '').trim()

    // Skip header-like rows and empty rows
    if (!unit || !owner) continue
    if (unit.toLowerCase() === 'unidad' || owner.toLowerCase() === 'participante') continue
    if (unit.toLowerCase() === 'apartamento') continue

    // Attendance status. Hypal: 'Asistencia' ("Presente"). Luxor: 'Estado'
    // (ASISTIÓ / REPRESENTADO / AUSENTE). Only absent attendees are excluded.
    const asistencia =
      String(row['Asistencia'] || row['ASISTENCIA'] ||
             row['Estado'] || row['ESTADO'] ||
             'Presente').trim()
    if (asistencia && asistencia.toLowerCase() === 'ausente') continue

    // 'REPRESENTADO' with no representative name found → mark as represented
    if (asistencia.toLowerCase() === 'representado' && !rep) {
      rep = 'Representado'
    }

    records.push({
      unit,
      owner_name: owner,
      represented_by: rep || undefined,
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
  if (/^(s[íi]|s[íi] apruebo|a favor|afavor|favor|aprobad[oa]|apruebo|aprueba|afirmativ[oa]|de acuerdo)$/.test(v)) return 'yes'
  if (/^(no|no apruebo|en contra|contra|rechazad[oa]|negativ[oa]|desaprob[a-z]*)$/.test(v)) return 'no'
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

  // ── Legacy summary rows: __EMPTY_2 = Si/No, __EMPTY_3 = count, __EMPTY_4 = pct ──
  let summaryYes: number | null = null
  let summaryNo: number | null = null
  let summaryPct: number | null = null
  for (const row of rows) {
    const label = String(row['__EMPTY_2'] || '').trim().toLowerCase()
    const cnt = row['__EMPTY_3']
    const pctv = row['__EMPTY_4']
    if ((label === 'si' || label === 'sí') && cnt !== '' && cnt !== undefined) {
      const n = Number(cnt)
      if (!isNaN(n) && n > 0) {
        summaryYes = n
        if (pctv !== '' && pctv !== undefined) summaryPct = Math.round(Number(pctv) * 10000) / 100
      }
    }
    if (label === 'no' && cnt !== '' && cnt !== undefined) {
      const n = Number(cnt)
      if (!isNaN(n)) summaryNo = n
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

