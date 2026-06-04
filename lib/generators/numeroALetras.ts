/**
 * numeroALetras.ts — Deterministic Spanish (es-PA) number-to-words.
 *
 * The acta GOAL format always writes a significant number in WORDS first,
 * then the digits in parentheses:
 *     "sesenta y siete (67) propietarios"
 *     "setenta y ocho coma cincuenta por ciento (78.50%)"
 *     "seis y veintidós de la tarde (6:22 p.m.)"
 *     "mil dólares ($1,000.00)"
 *
 * This module is the SINGLE SOURCE OF TRUTH for that conversion. Both
 * renderers (lib/generators/actaBuilder.ts for QA text and
 * app/api/generate/route.ts for the DOCX) import from here so the words and
 * the parenthesised digits can never drift apart.
 *
 * Deterministic by design: no inference, no rounding beyond 2 decimals on
 * money/percent. A number that exists is spelled exactly; nothing is invented.
 */

// ── Cardinals ────────────────────────────────────────────────────────────────

const UNIDADES = [
  'cero', 'uno', 'dos', 'tres', 'cuatro', 'cinco', 'seis', 'siete', 'ocho',
  'nueve', 'diez', 'once', 'doce', 'trece', 'catorce', 'quince', 'dieciséis',
  'diecisiete', 'dieciocho', 'diecinueve', 'veinte', 'veintiuno', 'veintidós',
  'veintitrés', 'veinticuatro', 'veinticinco', 'veintiséis', 'veintisiete',
  'veintiocho', 'veintinueve',
]

const DECENAS = [
  '', '', '', 'treinta', 'cuarenta', 'cincuenta', 'sesenta', 'setenta',
  'ochenta', 'noventa',
]

const CENTENAS = [
  '', 'ciento', 'doscientos', 'trescientos', 'cuatrocientos', 'quinientos',
  'seiscientos', 'setecientos', 'ochocientos', 'novecientos',
]

/**
 * Gender/apocope agreement for the digit 1 (and compounds ending in 1):
 *   'masc'  → "un" before noun  (un voto, veintiún votos, treinta y un votos)
 *   'fem'   → "una"             (una unidad, veintiuna unidades, treinta y una)
 *   'none'  → "uno" / "veintiuno" / "treinta y uno" (standalone cardinal)
 */
type Gen = 'masc' | 'fem' | 'none'

function genFromBool(apocope: boolean): Gen {
  return apocope ? 'masc' : 'none'
}

/**
 * Convert an integer 0..999999 to words.
 * `g` controls agreement of the digit 1 (see Gen above). A boolean is still
 * accepted for backward compatibility (true → masc apocope).
 */
function enteroALetras(n: number, g: Gen | boolean = 'none'): string {
  const gen: Gen = typeof g === 'boolean' ? genFromBool(g) : g
  if (!Number.isFinite(n) || n < 0) return String(n)
  n = Math.floor(n)

  if (n === 0) return 'cero'
  if (n < 30) {
    if (n === 1) return gen === 'masc' ? 'un' : gen === 'fem' ? 'una' : 'uno'
    if (n === 21) {
      if (gen === 'masc') return 'veintiún'
      if (gen === 'fem') return 'veintiuna'
      return 'veintiuno'
    }
    return UNIDADES[n]
  }
  if (n < 100) {
    const d = Math.floor(n / 10)
    const u = n % 10
    if (u === 0) return DECENAS[d]
    if (u === 1) {
      if (gen === 'masc') return `${DECENAS[d]} y un`
      if (gen === 'fem') return `${DECENAS[d]} y una`
      return `${DECENAS[d]} y uno`
    }
    return `${DECENAS[d]} y ${UNIDADES[u]}`
  }
  if (n === 100) return 'cien'
  if (n < 1000) {
    const c = Math.floor(n / 100)
    const rest = n % 100
    if (rest === 0) return CENTENAS[c]
    return `${CENTENAS[c]} ${enteroALetras(rest, gen)}`
  }
  if (n < 1000000) {
    const miles = Math.floor(n / 1000)
    const rest = n % 1000
    let milesStr: string
    if (miles === 1) {
      milesStr = 'mil'
    } else {
      // "un" apocope before "mil": veintiún mil, doscientos un mil, etc.
      milesStr = `${enteroALetras(miles, 'masc')} mil`
    }
    if (rest === 0) return milesStr
    return `${milesStr} ${enteroALetras(rest, gen)}`
  }
  // Beyond the acta's realistic range (units, votes, finca digits handled
  // separately). Fall back to digits rather than risk an inexact spelling.
  return String(n)
}

// ── Public API ───────────────────────────────────────────────────────────────

/**
 * Cardinal in words only, no parentheses. e.g. numeroEnLetras(67) → "sesenta y siete"
 * Accepts a gender/apocope hint: 'masc' | 'fem' | 'none' (or boolean for masc).
 */
export function numeroEnLetras(n: number, g: Gen | boolean = 'none'): string {
  return enteroALetras(n, g)
}

/**
 * Canonical acta pattern: words + digits in parentheses.
 *   conLetras(67) → "sesenta y siete (67)"
 *   conLetras(1, 'fem') → "una (1)"
 */
export function conLetras(n: number, g: Gen | boolean = 'none'): string {
  return `${enteroALetras(n, g)} (${n})`
}

/**
 * Votes: "<words> (<n>) votos". Singular "voto" when n === 1.
 *   fmtVotos(78) → "setenta y ocho (78) votos"
 *   fmtVotos(1)  → "un (1) voto"
 */
export function fmtVotos(n: number): string {
  const noun = n === 1 ? 'voto' : 'votos'
  return `${enteroALetras(n, true)} (${n}) ${noun}`
}

/**
 * Units (unidades inmobiliarias): "<words> (<n>) unidad(es) inmobiliaria(s)".
 */
export function fmtUnidades(n: number, withNoun = true): string {
  if (!withNoun) return conLetras(n)
  const noun = n === 1 ? 'unidad inmobiliaria' : 'unidades inmobiliarias'
  return `${enteroALetras(n, 'fem')} (${n}) ${noun}`
}

/**
 * Propietarios count: "<words> (<n>) propietario(s)".
 */
export function fmtPropietarios(n: number): string {
  const noun = n === 1 ? 'propietario' : 'propietarios'
  return `${enteroALetras(n, false)} (${n}) ${noun}`
}

/**
 * Percentage with up to 2 decimals, "coma" for the decimal separator (es).
 *   fmtPorcentaje(51)     → "cincuenta y uno por ciento (51%)"
 *   fmtPorcentaje(54.29)  → "cincuenta y cuatro coma veintinueve por ciento (54.29%)"
 *   fmtPorcentaje(78.5)   → "setenta y ocho coma cincuenta por ciento (78.50%)"
 * The parenthetical keeps the exact numeric form Ivette expects.
 */
export function fmtPorcentaje(n: number): string {
  const rounded = Math.round(n * 100) / 100
  const entero = Math.floor(rounded)
  const decimalsRaw = Math.round((rounded - entero) * 100) // 0..99
  let words = enteroALetras(entero, false)
  let digits: string
  if (decimalsRaw === 0) {
    digits = `${entero}%`
  } else {
    // Two-digit decimal spelling: pad so .5 reads "cincuenta" not "cinco".
    const dStr = decimalsRaw.toString().padStart(2, '0')
    words += ` coma ${enteroALetras(decimalsRaw, false)}`
    digits = `${rounded.toFixed(2)}%`
    void dStr
  }
  return `${words} por ciento (${digits})`
}

/**
 * Money in USD (acta convention for Panama): words + "dólares" + parenthetical
 * with thousands "," and decimals "." (American format per Sam's currency rule).
 *   fmtDinero(70000)    → "setenta mil dólares ($70,000.00)"
 *   fmtDinero(1442.50)  → "mil cuatrocientos cuarenta y dos dólares con cincuenta centavos ($1,442.50)"
 */
export function fmtDinero(n: number): string {
  const rounded = Math.round(n * 100) / 100
  const entero = Math.floor(rounded)
  const centavos = Math.round((rounded - entero) * 100)
  const digits = `$${rounded.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
  let words = `${enteroALetras(entero, false)} ${entero === 1 ? 'dólar' : 'dólares'}`
  if (centavos > 0) {
    words += ` con ${enteroALetras(centavos, false)} ${centavos === 1 ? 'centavo' : 'centavos'}`
  }
  return `${words} (${digits})`
}

/**
 * Time of day: "<hour words> y <minute words> de la <franja> (<h>:<mm> <a.m./p.m.>)".
 * Accepts either a "6:22 pm" style string or (hour, minute) numbers.
 *   fmtHora('6:22 pm')  → "seis y veintidós de la tarde (6:22 p.m.)"
 *   fmtHora('9:04 pm')  → "nueve y cuatro de la noche (9:04 p.m.)"
 *   fmtHora('6:00 am')  → "seis de la mañana (6:00 a.m.)"
 * If the string can't be parsed, it's returned unchanged (deterministic: never
 * guess a time that wasn't given).
 */
export function fmtHora(input: string): string {
  if (!input) return input
  const m = input.trim().toLowerCase().match(/^(\d{1,2})[:.](\d{2})\s*(a\.?m\.?|p\.?m\.?|am|pm)?/)
  if (!m) return input
  const h24raw = parseInt(m[1], 10)
  const min = parseInt(m[2], 10)
  let ampm = (m[3] || '').replace(/\./g, '')
  // Infer franja if am/pm missing using 24h heuristic.
  let h12 = h24raw
  if (!ampm) {
    ampm = h24raw < 12 ? 'am' : 'pm'
    h12 = h24raw % 12 === 0 ? 12 : h24raw % 12
  } else {
    h12 = h24raw % 12 === 0 ? 12 : h24raw % 12
  }
  // franja del día
  let franja: string
  const refHour = ampm === 'am' ? h24raw : (h24raw < 12 ? h24raw + 12 : h24raw)
  if (refHour < 12) franja = 'de la mañana'
  else if (refHour < 19) franja = 'de la tarde'
  else franja = 'de la noche'

  const horaWords = enteroALetras(h12, false)
  let minWords: string
  if (min === 0) minWords = ''
  else if (min === 15) minWords = ' y cuarto'
  else if (min === 30) minWords = ' y media'
  else minWords = ` y ${enteroALetras(min, false)}`

  const ampmDisp = ampm === 'am' ? 'a.m.' : 'p.m.'
  const digits = `${h12}:${min.toString().padStart(2, '0')} ${ampmDisp}`
  return `${horaWords}${minWords} ${franja} (${digits})`
}

/**
 * Finca number → spelled digit-by-digit then parenthesised, matching the GOAL
 * acta convention ("tres cero dos ocho cinco cinco ocho seis (30285586)").
 * Digit-by-digit is intentional: registro público numbers are identifiers, not
 * quantities, and the GOAL actas spell them this way.
 */
export function fmtFinca(finca: string): string {
  if (!finca) return finca
  const digits = finca.replace(/\D/g, '')
  if (!digits) return finca
  const spelled = digits.split('').map(d => UNIDADES[parseInt(d, 10)]).join(' ')
  return `${spelled} (${finca})`
}
