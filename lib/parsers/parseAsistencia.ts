/**
 * parseAsistencia.ts
 * Parses Lista_de_Asistencia.xlsx (SheetJS output as JSON rows)
 */

import type { AttendanceRecord } from '../types'

export function parseAsistencia(rows: Record<string, string>[]): AttendanceRecord[] {
  const records: AttendanceRecord[] = []

  for (const row of rows) {
    // Try to find unit column (various header names)
    const unit = row['UNIDAD'] || row['Unidad'] || row['APARTAMENTO'] || row['Apt'] || row['Unit'] || ''
    const owner = row['PROPIETARIO'] || row['Propietario'] || row['NOMBRE'] || row['Nombre'] || row['Owner'] || ''
    const rep = row['REPRESENTADO POR'] || row['Representante'] || row['Representative'] || ''
    const tower = row['TORRE'] || row['Torre'] || ''

    if (!unit && !owner) continue

    records.push({
      unit: unit.toString().trim(),
      owner_name: owner.toString().trim(),
      represented_by: rep ? rep.toString().trim() : undefined,
      tower: tower ? tower.toString().trim() : undefined,
    })
  }

  return records
}

/**
 * parseVotaciones.ts
 * Parses Resultados_de_las_votaciones.xlsx
 */

import type { VotationRecord } from '../types'

export function parseVotaciones(rows: Record<string, string>[]): VotationRecord[] {
  const records: VotationRecord[] = []

  for (const row of rows) {
    const topic = row['TEMA'] || row['Tema'] || row['PUNTO'] || row['Asunto'] || row['Description'] || ''
    const yes = parseInt(String(row['SI'] || row['Sí'] || row['YES'] || row['A FAVOR'] || '0'))
    const no = parseInt(String(row['NO'] || row['EN CONTRA'] || '0'))
    const abs = parseInt(String(row['ABSTENCIONES'] || row['Abstenciones'] || '0'))
    const total = parseInt(String(row['TOTAL'] || row['HABILITADOS'] || '0'))

    if (!topic && isNaN(yes)) continue
    if (!String(topic).trim()) continue  // skip empty topic rows

    const pct = total > 0 ? (yes / total) * 100 : yes + no > 0 ? (yes / (yes + no)) * 100 : 0

    records.push({
      topic: topic.toString().trim(),
      yes_votes: isNaN(yes) ? 0 : yes,
      no_votes: isNaN(no) ? 0 : no,
      abstentions: isNaN(abs) ? undefined : abs,
      total_eligible: isNaN(total) ? undefined : total,
      pct_yes: Math.round(pct * 100) / 100,
      approved: yes > no,
    })
  }

  return records
}
