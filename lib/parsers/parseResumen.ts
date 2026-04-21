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
  // Format: "Fecha: 07 de abril de 2026" — Hypal resumen header
  const m2b = text.match(/[Ff]echa[:\s]+([\d]{1,2}\s+de\s+\w+\s+de\s+\d{4})/i)
  if (m2b) return m2b[1].trim()
  // Format: "21/04/2025"
  const m3 = text.match(/\d{1,2}[\/\-]\d{1,2}[\/\-]\d{4}/)
  if (m3) return m3[0]
  return '[FECHA PENDIENTE — proveer en Pre-flight]'
}

function extractTime(text: string, type: 'start' | 'end'): string {
  if (type === 'start') {
    const m = text.match(/(?:inicio|inicia|siendo las?|a las?)(?:las?\s+)?(\d{1,2}:\d{2}\s*(?:am|pm|p\.m\.|a\.m\.)?)/i)
    if (m) return m[1].trim()
    const m2 = text.match(/(\d{1,2}:\d{2}\s*(?:am|pm))/i)
    if (m2) return m2[1].trim()
  } else {
    const m = text.match(/(?:siendo las?|terminó|finalizó|se da por terminad[ao]|damos por terminada).{0,30}?(\d{1,2}:\d{2}\s*(?:am|pm|p\.m\.)?)/i)
    if (m) return m[1].trim()
  }
  return type === 'start' ? '[HORA INICIO PENDIENTE]' : '[HORA FIN PENDIENTE]'
}

function extractPHName(text: string): string {
  // "PH VENEZIA TOWER", "P.H. LEFEVRE 75 DON ENRIQUE"
  const m = text.match(/(?:P\.?H\.?\s+)([A-ZÁÉÍÓÚÑa-záéíóúñ][A-ZÁÉÍÓÚÑa-záéíóúñ0-9\s]+?)(?:\n|,|\.|\/|\(|del|de la)/i)
  if (m) return `PH ${m[1].trim().toUpperCase()}`
  return '[NOMBRE PH PENDIENTE]'
}

/**
 * extractQuorum — improved v2
 * Distinguishes between total PH units and present/represented units.
 * Hypal resumen uses patterns like:
 *   "274 unidades inmobiliarias que conforman el PH"
 *   "163 unidades ... presentes o representadas"
 *   "el PH cuenta con 274 propietarios"
 */
function extractQuorum(text: string): { total: number; present: number; pct: number } {
  // ── Total units of the PH ───────────────────────────────────────────────
  // Patterns: "274 unidades que conforman", "cuenta con 274", "total de 274", "PH tiene 274"
  const totalPatterns = [
    /(\d+)\s+(?:unidades|propietarios)\s+(?:inmobiliarias?\s+)?que\s+(?:conforman|componen|integran)/i,
    /(?:cuenta|cuentan)\s+con\s+(\d+)\s+(?:unidades|propietarios)/i,
    /(?:total\s+de|un\s+total\s+de)\s+(\d+)\s+(?:unidades|propietarios)/i,
    /(?:PH|propiedad\s+horizontal)\s+(?:cuenta|tiene|compuesto|conformado)\s+(?:con\s+)?(\d+)/i,
    // Hypal resumen header: "Total Unidades: 274" or "Unidades totales: 274"
    /(?:total\s+unidades?|unidades?\s+totales?)\s*[:\-]\s*(\d+)/i,
  ]
  let total = 0
  for (const pattern of totalPatterns) {
    const m = text.match(pattern)
    if (m) { total = parseInt(m[1]); break }
  }

  // ── Present / represented units ─────────────────────────────────────────
  // Patterns: "206 unidades presentes", "presentes o representadas 206", "206 propietarios presentes"
  const presentPatterns = [
    /(\d+)\s+(?:unidades|propietarios)\s+(?:inmobiliarias?\s+)?(?:presentes?|representad[ao]s?)/i,
    /(?:presentes?\s+o\s+(?:debidamente\s+)?representad[ao]s?)\s+(\d+)/i,
    /se\s+encontraban\s+presentes?\s+(?:o\s+representad[ao]s?\s+)?(\d+)/i,
    /quórum\s+(?:de|con)\s+(\d+)\s+(?:unidades|propietarios)/i,
  ]
  let present = 0
  for (const pattern of presentPatterns) {
    const m = text.match(pattern)
    if (m) { present = parseInt(m[1]); break }
  }

  // ── Percentage ───────────────────────────────────────────────────────────
  const pctM = text.match(/(\d+(?:\.\d+)?)\s*%/)
  const pct = pctM ? parseFloat(pctM[1]) : 0

  // ── Sanity check: if total === present (likely wrong), reset total ───────
  // This prevents the 206/206 bug — if we can't distinguish, leave total = 0
  // so the preflight gap forces Ivette to enter the real number
  if (total > 0 && total === present) total = 0

  return { total, present, pct }
}

/**
 * extractAgendaItems — exported for reuse in parse/route.ts
 * Extracts numbered agenda items from any text block.
 */
export function extractAgendaItems(text: string): AgendaItem[] {
  const items: AgendaItem[] = []
  const lines = text.split('\n')
  let inAgenda = false

  for (const line of lines) {
    const t = line.trim()
    if (/orden del d[ií]a/i.test(t)) { inAgenda = true; continue }
    if (inAgenda && /^\d+[\.\)]\s+(.+)/.test(t)) {
      const m = t.match(/^(\d+)[\.\)]\s+(.+)/)
      if (m) items.push({ number: parseInt(m[1]), title: m[2].trim() })
    }
    // Stop after a long empty stretch
    if (inAgenda && items.length > 0 && /^\s*$/.test(t) && items.length >= 3) {
      // keep going — agenda might have blank lines between items
    }
  }
  return items
}

export function parseResumen(rawText: string): SkeletonData {
  const quorum = extractQuorum(rawText)

  // Extract assembly type
  const isExtraordinaria = /extraordinaria/i.test(rawText)

  // Extract acta number
  const actaM = rawText.match(/[Aa]cta\s*[Nn][oº°]?\.?\s*(\d+)[-–]?(\d{4})?/i)
  const actaNumber = actaM ? `${actaM[1]}${actaM[2] ? '-' + actaM[2] : ''}` : undefined

  // Finca / Código
  const fincaM = rawText.match(/[Ff]inca\s+[Nn]úmero\s+([\d\s]+?)(?:,|\.| con|\n)/i)
  const codigoM = rawText.match(/[Cc]ódigo\s+(?:de\s+ubicación\s+)?[Nn]úmero\s+([\d\s]+?)(?:,|\.| de|\n)/i)

  // Extract president and secretary names
  const presMatch = rawText.match(/[Pp]residente?\s*[:\s]+([A-ZÁÉÍÓÚÑa-záéíóúñ]+(?:\s+[A-ZÁÉÍÓÚÑa-záéíóúñ]+){1,3})/i)
  const secMatch  = rawText.match(/[Ss]ecretari[ao]\s*[:\s]+([A-ZÁÉÍÓÚÑa-záéíóúñ]+(?:\s+[A-ZÁÉÍÓÚÑa-záéíóúñ]+){1,3})/i)

  return {
    ph_name:         extractPHName(rawText),
    ph_finca:        fincaM ? fincaM[1].trim().replace(/\s+/g, '') : undefined,
    ph_codigo:       codigoM ? codigoM[1].trim().replace(/\s+/g, '') : undefined,
    assembly_type:   isExtraordinaria ? 'EXTRAORDINARIA' : 'ORDINARIA',
    acta_number:     actaNumber,
    date_str:        extractDate(rawText),
    time_start:      extractTime(rawText, 'start'),
    time_end:        extractTime(rawText, 'end'),
    total_units:     quorum.total  || 0,
    present_units:   quorum.present || 0,
    quorum_pct:      quorum.pct    || 0,
    agenda_items:    extractAgendaItems(rawText),
    president_name:  presMatch ? presMatch[1].trim() : undefined,
    secretary_name:  secMatch  ? secMatch[1].trim()  : undefined,
    raw_text:        rawText,
  }
}
