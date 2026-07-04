/**
 * parseResumen.ts
 * Extracts structured metadata from Resumen_de_la_Asamblea.docx text
 */

import type { SkeletonData, AgendaItem } from '../types'

const MONTH_MAP: Record<string, number> = {
  enero: 1, febrero: 2, marzo: 3, abril: 4, mayo: 5, junio: 6,
  julio: 7, agosto: 8, septiembre: 9, octubre: 10, noviembre: 11, diciembre: 12,
}

const WEEKDAY = '(?:lunes|martes|mi[eé]rcoles|jueves|viernes|s[aá]bado|domingo)'
const MONTH_RE = '(?:enero|febrero|marzo|abril|mayo|junio|julio|agosto|septiembre|octubre|noviembre|diciembre)'
// A concrete date: optional weekday + numeric day + named month + 4-digit year.
// "de" before the month is optional; the year connector may be "de" or "del".
const DATE_CORE = `(?:${WEEKDAY},?\\s*)?\\d{1,2}\\s+(?:de\\s+)?${MONTH_RE}\\s+del?\\s+\\d{4}`

/**
 * extractDate — BUG 3
 * Extracts the ASSEMBLY date, not merely the first date in the text. Priority:
 *   1. Dates anchored to a celebration marker ("celebrada el …", "reunidos … el …",
 *      "siendo el día …", "Fecha: …") — this is the real meeting date.
 *   2. The spelled-out day with the digit in parentheses
 *      ("domingo veintiocho (28) de junio de dos mil veintiséis (2026)").
 *   3. A date in the header (first ~500 chars), near the title.
 *   4. Last resort: the first loose date anywhere (old behaviour), then DD/MM/AAAA.
 */
function extractDate(text: string): string {
  // 1 · Celebration-anchored dates.
  const markers = [
    'celebrad[ao]s?\\s+(?:el\\s+)?(?:d[ií]a\\s+)?',
    'reunid[ao]s?[^\\n]{0,40}?\\bel\\s+(?:d[ií]a\\s+)?',
    'siendo\\s+el\\s+d[ií]a\\s+',
    'siendo\\s+las?[^\\n]{0,50}?\\bdel?\\s+(?:d[ií]a\\s+)?',
    'fecha\\s*[:\\-]?\\s*',
  ]
  for (const mk of markers) {
    const m = text.match(new RegExp(mk + '(' + DATE_CORE + ')', 'i'))
    if (m) return m[1].trim()
  }

  // 2 · Day spelled out with the digit in parentheses.
  const spelled = text.match(
    new RegExp(`(?:${WEEKDAY}\\s+)?[a-záéíóú]+\\s*\\((\\d{1,2})\\)\\s+(?:de\\s+)?(${MONTH_RE})\\s+(?:de\\s+)?[a-záéíóú\\s]+?\\((\\d{4})\\)`, 'i')
  )
  if (spelled) return `${spelled[1]} de ${spelled[2].toLowerCase()} de ${spelled[3]}`

  // 3 · Header date (first ~500 chars).
  const headerMatch = text.slice(0, 500).match(new RegExp(DATE_CORE, 'i'))
  if (headerMatch) return headerMatch[0].trim()

  // 4 · Fallbacks — first loose date anywhere, then DD/MM/AAAA.
  const loose = text.match(new RegExp(DATE_CORE, 'i'))
  if (loose) return loose[0].trim()
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

// Words that mark the end of a PH name (registry/legal tokens that follow it).
const PH_STOP_WORD = /^(?:r\.?u\.?c\.?|ruc|finca|c[oó]digo|n[uú]mero|nit|rup|ubicaci[oó]n)$/i

/**
 * findPHNameIn — locate a PH name inside a single scope of text.
 * Recognises three equivalent forms as a REAL token (never a substring):
 *   "PROPIEDAD HORIZONTAL <Nombre>" · "P.H. <Nombre>" · "PH <Nombre>"
 * The left anchor is start-of-string or a whitespace/punctuation char — NOT a
 * letter — so "Joseph Ayala" (…jose·PH·…) can never match.
 */
function findPHNameIn(scope: string): string | null {
  const anchor = /(?:^|[\s.,;:(“"'])(?:propiedad\s+horizontal|p\.?h\.?)\s+/i
  const m = anchor.exec(scope)
  if (!m) return null

  // Only look at the remainder of the SAME line — the name never wraps.
  const line = scope.slice(m.index + m[0].length).split(/[\n\r]/)[0]

  const tokens: string[] = []
  for (const raw of line.split(/\s+/)) {
    // Strip surrounding separators (— – - , . ; : ( ) " “ ”) but keep them internal.
    const tok = raw.replace(/^[—–\-,.;:()"“”'']+|[—–\-,.;:()"“”'']+$/g, '')
    if (tok === '') continue                    // pure separator (e.g. "—") → skip, keep scanning
    if (PH_STOP_WORD.test(tok)) break           // R.U.C., FINCA, CÓDIGO… → name ended
    if (!/^[A-ZÁÉÍÓÚÑ0-9]/.test(tok)) break      // lowercase-initial word → prose, name ended
    tokens.push(tok)
    if (tokens.length >= 6) break               // safety cap
  }

  if (tokens.length === 0) return null
  return `PH ${tokens.join(' ').replace(/\s+/g, ' ').toUpperCase()}`
}

/**
 * extractPHName — BUG 1
 * Prefer the document header (first ~500 chars, where the official name lives)
 * before falling back to the whole body, so incidental "PH …" mentions in the
 * text don't win. Returns the PENDIENTE sentinel rather than guessing.
 */
function extractPHName(text: string): string {
  return findPHNameIn(text.slice(0, 500))
      ?? findPHNameIn(text)
      ?? '[NOMBRE PH PENDIENTE]'
}

/**
 * extractAssemblyType — BUG 2
 * Tolerates up to 2 intermediate words between "asamblea" and the type keyword
 * (e.g. "ASAMBLEA GENERAL EXTRAORDINARIA", "ASAMBLEA GENERAL PRIMERA ORDINARIA"),
 * but never across a line/paragraph break (`[^\S\r\n]` = whitespace minus newline).
 * EXTRAORDINARIA is checked first so "asamblea general extraordinaria" can never be
 * read as ordinaria. When NEITHER form is explicit, returns 'INDETERMINADA' instead
 * of a silent 'ORDINARIA' default — the caller flags it for Pre-flight confirmation.
 */
function extractAssemblyType(text: string): 'ORDINARIA' | 'EXTRAORDINARIA' | 'INDETERMINADA' {
  const gap = '(?:[^\\S\\r\\n]+[a-záéíóúñ]+){0,2}[^\\S\\r\\n]+'
  const EXTRA = new RegExp(`asamblea${gap}extraordinaria`, 'i')
  const ORDIN = new RegExp(`asamblea${gap}ordinaria`, 'i')
  if (EXTRA.test(text)) return 'EXTRAORDINARIA'
  if (ORDIN.test(text)) return 'ORDINARIA'
  return 'INDETERMINADA'
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

  // Assembly type: keep the SkeletonData union unchanged, but when the designation
  // is indeterminate, display a safe ORDINARIA and raise a flag so the Pre-flight
  // asks the operator to confirm (no more silent-ORDINARIA misclassification).
  const typeResult = extractAssemblyType(rawText)
  const assemblyType: 'ORDINARIA' | 'EXTRAORDINARIA' =
    typeResult === 'INDETERMINADA' ? 'ORDINARIA' : typeResult

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
    assembly_type:   assemblyType,
    assembly_type_uncertain: typeResult === 'INDETERMINADA',
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
