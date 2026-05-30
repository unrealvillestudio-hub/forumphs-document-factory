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
  // "lunes, 21 de abril de 2025" / convocatoria "jueves, 21 mayo de 2026" / "… del 2026".
  // The "de" before the month is optional; the year connector may be "de" or "del".
  const m1 = text.match(/(?:lunes|martes|mi[eé]rcoles|jueves|viernes|s[aá]bado|domingo),?\s*\d{1,2}\s+(?:de\s+)?[a-záéíóú]+\s+del?\s+\d{4}/i)
  if (m1) return m1[0].trim()
  // "21 de abril de 2025" / "21 mayo de 2026" / "21 de mayo del 2026" (no weekday).
  const m2 = text.match(/\d{1,2}\s+(?:de\s+)?(?:enero|febrero|marzo|abril|mayo|junio|julio|agosto|septiembre|octubre|noviembre|diciembre)\s+del?\s+\d{4}/i)
  if (m2) return m2[0].trim()
  // "Fecha: 07 de abril de 2026" — Hypal resumen / convocatoria header.
  const m2b = text.match(/[Ff]echa[:\s]+([\d]{1,2}\s+(?:de\s+)?[a-záéíóú]+\s+del?\s+\d{4})/i)
  if (m2b) return m2b[1].trim()
  // "21/04/2025" or "21-04-2025".
  const m3 = text.match(/\d{1,2}[\/\-]\d{1,2}[\/\-]\d{4}/)
  if (m3) return m3[0]
  return '[FECHA PENDIENTE — proveer en Pre-flight]'
}

function extractTime(text: string, type: 'start' | 'end'): string {
  if (type === 'start') {
    const m = text.match(/(?:inicio|inicia|siendo las?|a las?|a partir de las?)(?:\s*las?\s+)?(\d{1,2}:\d{2}\s*(?:a\.?\s?m\.?|p\.?\s?m\.?)?)/i)
    if (m) return m[1].trim()
    // Convocatoria "6:00 p.m." / "6:00 PM" — accept am/pm with or without periods/space
    const m2 = text.match(/(\d{1,2}:\d{2}\s*(?:a\.?\s?m\.?|p\.?\s?m\.?))/i)
    if (m2) return m2[1].trim()
    // "6 p.m." (hour only, with am/pm) and "18:00 horas" (24h)
    const m3 = text.match(/\b(\d{1,2}\s*(?:a\.?\s?m\.?|p\.?\s?m\.?))/i)
    if (m3) return m3[1].trim()
    const m4 = text.match(/\b(\d{1,2}:\d{2})\s*horas?\b/i)
    if (m4) return m4[1].trim()
  } else {
    const m = text.match(/(?:siendo las?|terminó|finalizó|se da por terminad[ao]|damos por terminada).{0,30}?(\d{1,2}:\d{2}\s*(?:am|pm|p\.m\.)?)/i)
    if (m) return m[1].trim()
  }
  return type === 'start' ? '[HORA INICIO PENDIENTE]' : '[HORA FIN PENDIENTE]'
}

function extractPHName(text: string): string {
  // Convocatoria / header style: "el PH LUXOR 300", "P.H. LEFEVRE 75 DON ENRIQUE",
  // "PH VENEZIA TOWER". Capture consecutive ALL-CAPS / numeric tokens (name + tower/
  // number); this stops at the first lowercase word so we don't swallow the sentence.
  const caps = text.match(/\bP\.?H\.?\s+([A-ZÁÉÍÓÚÑ0-9]{2,}(?:\s+[A-ZÁÉÍÓÚÑ0-9]+){0,4})/)
  if (caps) return `PH ${caps[1].trim().replace(/\s+/g, ' ').toUpperCase()}`
  // General fallback for mixed-case names: "PH Nombre" up to a delimiter
  const m = text.match(/(?:P\.?H\.?\s+)([A-ZÁÉÍÓÚÑa-záéíóúñ][A-ZÁÉÍÓÚÑa-záéíóúñ0-9\s]+?)(?:\n|,|\.|\/|\(|del|de la)/i)
  if (m) return `PH ${m[1].trim().toUpperCase()}`
  return '[NOMBRE PH PENDIENTE]'
}

/**
 * extractAssemblyType — BUG 5
 * Convocatorias often contain the word "extraordinaria" in legal boilerplate even
 * when the meeting itself is ordinary, which made a naive /extraordinaria/ test
 * misclassify Luxor as EXTRAORDINARIA. Prefer an explicit "asamblea ordinaria"
 * designation (incl. "PRIMERA ASAMBLEA ORDINARIA"); only flag EXTRAORDINARIA when
 * "asamblea extraordinaria" is explicit. Default ORDINARIA — the vast majority are.
 * Note: `asamblea\s+ordinaria` does NOT match "asamblea extraordinaria" (the "extra"
 * prefix breaks the required whitespace boundary), so the order below is safe.
 */
function extractAssemblyType(text: string): 'ORDINARIA' | 'EXTRAORDINARIA' {
  if (/(?:primera\s+)?asamblea\s+ordinaria/i.test(text)) return 'ORDINARIA'
  if (/asamblea\s+extraordinaria/i.test(text)) return 'EXTRAORDINARIA'
  return 'ORDINARIA'
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
    /(\d+)\s+(?:unidades|propietarios|apartamentos)\s+(?:inmobiliarias?\s+)?(?:que\s+)?(?:conforman|componen|integran|constituyen)/i,
    /(?:cuenta|cuentan)\s+con\s+(\d+)\s+(?:unidades|propietarios|apartamentos)/i,
    /(?:total\s+de|un\s+total\s+de)\s+(\d+)\s+(?:unidades|propietarios|apartamentos)/i,
    /(?:PH|p\.?h\.?|propiedad\s+horizontal|edificio|condominio)\s+(?:cuenta|tiene|compuesto|conformado|consta|integrado)\s+(?:con\s+|de\s+|por\s+)?(\d+)/i,
    /(?:consta|compuesto|conformado|integrado)\s+(?:de|por)\s+(\d+)\s+(?:unidades|apartamentos|propietarios)/i,
    // Convocatoria: number spelled out then "(142) unidades"
    /\(\s*(\d+)\s*\)\s*(?:unidades|apartamentos|propietarios)/i,
    // Convocatoria: "de las 142 unidades que conforman / del PH"
    /(?:de\s+las|las)\s+(\d+)\s+(?:unidades|apartamentos)\s+(?:inmobiliarias?\s+)?(?:que\s+(?:conforman|componen|integran)|del?\s+(?:ph|p\.?h|edificio|condominio|inmueble))/i,
    // Header: "Total Unidades: 274", "Número de unidades: 142"
    /(?:total\s+unidades?|unidades?\s+totales?|n[uú]mero\s+(?:total\s+)?de\s+unidades?)\s*[:\-]?\s*(\d+)/i,
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
    assembly_type:   extractAssemblyType(rawText),
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
