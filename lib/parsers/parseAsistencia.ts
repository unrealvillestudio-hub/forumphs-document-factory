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
    // Hypal format: Unidad, Participante
    const unit =
      String(row['Unidad'] || row['UNIDAD'] || row['unidad'] ||
             row['Apartamento'] || row['Unit'] || row['APARTAMENTO'] || '').trim()

    const owner =
      String(row['Participante'] || row['PARTICIPANTE'] ||
             row['Propietario'] || row['PROPIETARIO'] ||
             row['Nombre'] || row['NOMBRE'] || row['Owner'] || '').trim()

    const rep =
      String(row['Representado por'] || row['REPRESENTADO POR'] ||
             row['Representante'] || row['Representative'] || '').trim()

    // Skip header-like rows and empty rows
    if (!unit || !owner) continue
    if (unit.toLowerCase() === 'unidad' || owner.toLowerCase() === 'participante') continue
    if (unit.toLowerCase() === 'apartamento') continue

    // Only include present attendees (Hypal marks as "Presente")
    const asistencia = String(row['Asistencia'] || row['ASISTENCIA'] || 'Presente').trim()
    if (asistencia && asistencia.toLowerCase() === 'ausente') continue

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

  // The question is encoded in the first column's key name
  // e.g. "Pregunta:¿Aprueba la asamblea el orden del dia propuesto para esta reunión?"
  const firstKey = Object.keys(rows[0] || {})[0] || ''
  const questionMatch = firstKey.match(/Pregunta[:\s]*(.+)/i)
  const topic = questionMatch ? questionMatch[1].trim() : firstKey.trim()

  if (!topic) return []

  // Count votes from individual rows
  let yesCount = 0
  let noCount = 0
  let summaryYes: number | null = null
  let summaryNo: number | null = null
  let summaryPct: number | null = null

  for (const row of rows) {
    const apt = String(row[firstKey] || '').trim()
    const voto = String(row['__EMPTY'] || '').trim().toLowerCase()
    const summaryLabel = String(row['__EMPTY_2'] || '').trim().toLowerCase()
    const summaryCount = row['__EMPTY_3']
    const summaryPctVal = row['__EMPTY_4']

    // Skip header rows
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

  // Prefer summary counts (more reliable) over individual count
  const finalYes = summaryYes !== null ? summaryYes : yesCount
  const finalNo = summaryNo !== null ? summaryNo : noCount
  const finalPct = summaryPct !== null ? summaryPct : (finalYes + finalNo > 0 ? Math.round((finalYes / (finalYes + finalNo)) * 10000) / 100 : 0)

  records.push({
    topic,
    yes_votes: finalYes,
    no_votes: finalNo,
    pct_yes: finalPct,
    approved: finalYes > finalNo,
  })

  return records
}

