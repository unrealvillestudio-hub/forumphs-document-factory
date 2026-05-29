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

export function parseVotaciones(rows: Record<string, unknown>[]): VotationRecord[] {
  if (!rows || rows.length === 0) return []

  const records: VotationRecord[] = []

  // Per-question (per-sheet) accumulator. BUG 1 prefixes each sheet's rows with a
  // sentinel { __SHEET_NAME, __IS_SHEET_HEADER }, so one call may carry several
  // questions (Luxor: one sheet each). Legacy single-sheet votaciones arrive with
  // no sentinel and the question encoded in the first column's key name.
  let topic = ''
  let firstKey = ''
  let yesCount = 0
  let noCount = 0
  let summaryYes: number | null = null
  let summaryNo: number | null = null
  let summaryPct: number | null = null

  const startBlock = (sheetTopic: string) => {
    topic = sheetTopic
    firstKey = ''
    yesCount = 0
    noCount = 0
    summaryYes = null
    summaryNo = null
    summaryPct = null
  }

  const flushBlock = () => {
    if (!topic) return
    // Prefer summary counts (more reliable) over the individual tally
    const finalYes = summaryYes !== null ? summaryYes : yesCount
    const finalNo = summaryNo !== null ? summaryNo : noCount
    const finalPct = summaryPct !== null
      ? summaryPct
      : (finalYes + finalNo > 0 ? Math.round((finalYes / (finalYes + finalNo)) * 10000) / 100 : 0)
    records.push({
      topic,
      yes_votes: finalYes,
      no_votes: finalNo,
      pct_yes: finalPct,
      approved: finalYes > finalNo,
    })
  }

  for (const row of rows) {
    // ── Sheet boundary sentinel (BUG 1 multi-sheet) ──────────────────────────
    // Close the question accumulated so far and open a new one named after the sheet.
    if (String(row['__IS_SHEET_HEADER'] || '') === 'true') {
      flushBlock()
      startBlock(String(row['__SHEET_NAME'] || '').trim())
      continue
    }

    // First data column key of the block. Legacy Hypal encodes the question here
    // ("Pregunta:¿…?"); when present it overrides the sheet-name topic.
    if (!firstKey) {
      firstKey = Object.keys(row).find(k => k !== '__SHEET_NAME' && k !== '__IS_SHEET_HEADER') || ''
      const questionMatch = firstKey.match(/Pregunta[:\s]*(.+)/i)
      if (questionMatch) topic = questionMatch[1].trim()
      else if (!topic) topic = firstKey.trim()
    }

    const apt = String(row[firstKey] || '').trim()
    // BUG 2: Luxor stores the vote in 'Resultado'; legacy uses '__EMPTY'
    const voto = String(
      row['Resultado'] || row['__EMPTY'] || row['Voto'] || row['RESULTADO'] || ''
    ).trim().toLowerCase()
    const summaryLabel = String(row['__EMPTY_2'] || '').trim().toLowerCase()
    const summaryCount = row['__EMPTY_3']
    const summaryPctVal = row['__EMPTY_4']

    // Skip header rows / rows whose unit column is blank
    if (apt.toLowerCase() === 'apartamento' || apt === '') continue

    // Extract summary totals (rows with __EMPTY_2 = Si/No and a count)
    if ((summaryLabel === 'si' || summaryLabel === 'sí') && summaryCount !== '' && summaryCount !== undefined) {
      const n = Number(summaryCount)
      if (!isNaN(n) && n > 0) {
        summaryYes = n
        if (summaryPctVal !== '' && summaryPctVal !== undefined) {
          summaryPct = Math.round(Number(summaryPctVal) * 100 * 100) / 100
        }
      }
    }
    if (summaryLabel === 'no' && summaryCount !== '' && summaryCount !== undefined) {
      const n = Number(summaryCount)
      if (!isNaN(n)) summaryNo = n
    }

    // Count individual votes
    if (apt.toLowerCase().includes('apartamento') || apt.match(/^[A-Z]\d+/)) {
      if (voto === 'si' || voto === 'sí') yesCount++
      else if (voto === 'no') noCount++
    }
  }

  // Flush the final (or only) question
  flushBlock()

  return records
}

