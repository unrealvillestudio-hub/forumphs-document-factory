/**
 * parseResumen.ts
 * Extracts structured metadata from Resumen_de_la_Asamblea.docx text
 */

import type { SkeletonData, AgendaItem } from '../types'

const MONTH_MAP: Record<string, number> = {
  enero: 1, febrero: 2, marzo: 3, abril: 4, mayo: 5, junio: 6,
  julio: 7, agosto: 8, septiembre: 9, octubre: 10, noviembre: 11, diciembre: 12,
}

function extractDate(text: string): string {
  // Format: "lunes, 21 de abril de 2025"
  const m1 = text.match(/(?:lunes|martes|mi[eé]rcoles|jueves|viernes|s[aá]bado|domingo),?\s*\d{1,2}\s+de\s+\w+\s+de\s+\d{4}/i)
  if (m1) return m1[0]
  // Format: "21 de abril de 2025" (no weekday)
  const m2 = text.match(/\d{1,2}\s+de\s+(?:enero|febrero|marzo|abril|mayo|junio|julio|agosto|septiembre|octubre|noviembre|diciembre)\s+de\s+\d{4}/i)
  if (m2) return m2[0]
  // Format: "abril 21, 2025" or "21/04/2025"
  const m3 = text.match(/\d{1,2}[\/\-]\d{1,2}[\/\-]\d{4}/)
  if (m3) return m3[0]
  return '[FECHA PENDIENTE — proveer en Pre-flight]'
}

function extractTime(text: string, type: 'start' | 'end'): string {
  // Look for time patterns like "6:22 pm", "18:22", "las seis"
  if (type === 'start') {
    const m = text.match(/(?:inicio|inicia|siendo las?|a las?)\s+(?:las?\s+)?(\d{1,2}:\d{2}\s*(?:am|pm|p\.m\.|a\.m\.)?)/i)
    if (m) return m[1].trim()
    // Try "6:22 pm" anywhere in opening
    const m2 = text.match(/(\d{1,2}:\d{2}\s*(?:am|pm))/i)
    if (m2) return m2[1].trim()
  } else {
    const m = text.match(/(?:siendo las?|terminó|finalizó|se da por terminad[ao]|damos por terminada).*?(\d{1,2}:\d{2}\s*(?:am|pm|p\.m\.)?)/i)
    if (m) return m[1].trim()
  }
  return type === 'start' ? '[HORA INICIO PENDIENTE]' : '[HORA FIN PENDIENTE]'
}

function extractPHName(text: string): string {
  // "PH VENEZIA TOWER", "P.H. LEFEVRE 75 DON ENRIQUE"
  const m = text.match(/(?:P\.?H\.?\s+)([A-ZÁÉÍÓÚÑ][A-ZÁÉÍÓÚÑ0-9\s]+?)(?:\n|,|\.|\(|del|de la)/i)
  if (m) return `PH ${m[1].trim().toUpperCase()}`
  return '[NOMBRE PH PENDIENTE]'
}

function extractQuorum(text: string): { total: number; present: number; pct: number } {
  const totalM = text.match(/(\d+)\s+(?:propietarios|unidades)\s+(?:en total|que conforman)/i)
  const presentM = text.match(/(\d+)\s+(?:propietarios|unidades)\s+(?:presentes|representados)/i)
  const pctM = text.match(/(\d+(?:\.\d+)?)\s*%/)

  return {
    total: totalM ? parseInt(totalM[1]) : 0,
    present: presentM ? parseInt(presentM[1]) : 0,
    pct: pctM ? parseFloat(pctM[1]) : 0,
  }
}

function extractAgendaItems(text: string): AgendaItem[] {
  const items: AgendaItem[] = []
  // Look for numbered list items
  const lines = text.split('\n')
  let inAgenda = false

  for (const line of lines) {
    const t = line.trim()
    if (/orden del día/i.test(t)) { inAgenda = true; continue }
    if (inAgenda && /^\d+[\.\)]\s+(.+)/.test(t)) {
      const m = t.match(/^(\d+)[\.\)]\s+(.+)/)
      if (m) {
        items.push({ number: parseInt(m[1]), title: m[2].trim() })
      }
    }
    if (inAgenda && items.length > 0 && /^\s*$/.test(t) && items.length >= 3) {
      // end of agenda section
    }
  }
  return items
}

export function parseResumen(rawText: string): SkeletonData {
  const quorum = extractQuorum(rawText)

  // Extract assembly type
  const isExtraordinaria = /extraordinaria/i.test(rawText)

  // Extract acta number
  const actaM = rawText.match(/[Aa]cta\s*[Nn][o°º]?\.?\s*(\d+)[-–]?(\d{4})?/i)
  const actaNumber = actaM ? `${actaM[1]}${actaM[2] ? '-' + actaM[2] : ''}` : undefined

  // Finca / Código
  const fincaM = rawText.match(/[Ff]inca\s+[Nn]úmero\s+([\d\s]+?)(?:,|\.|con|\n)/i)
  const codigoM = rawText.match(/[Cc]ódigo\s+(?:de\s+ubicación\s+)?[Nn]úmero\s+([\d\s]+?)(?:,|\.|de|\n)/i)

  return {
    ph_name: extractPHName(rawText),
    ph_finca: fincaM ? fincaM[1].trim().replace(/\s+/g, '') : undefined,
    ph_codigo: codigoM ? codigoM[1].trim().replace(/\s+/g, '') : undefined,
    assembly_type: isExtraordinaria ? 'EXTRAORDINARIA' : 'ORDINARIA',
    acta_number: actaNumber,
    date_str: extractDate(rawText),
    time_start: extractTime(rawText, 'start'),
    time_end: extractTime(rawText, 'end'),
    total_units: quorum.total || 0,
    present_units: quorum.present || 0,
    quorum_pct: quorum.pct || 0,
    agenda_items: extractAgendaItems(rawText),
    raw_text: rawText,
  }
}
