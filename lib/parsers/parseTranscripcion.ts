/**
 * parseTranscripcion.ts
 * Parses the Zoom/Hypal transcription docx (already extracted to text)
 * into DebateBlock[] — one block per speaker turn.
 */

import type { DebateBlock } from '../types'

// ---- Constants ----

const SKIP_EXACT = new Set([
  'sí', 'si', 'no', 'okay', 'ok', 'perfecto', 'claro', 'correcto', 'listo',
  'ya', 'bien', 'gracias', 'entendido', 'de acuerdo', 'exacto', 'adelante',
  'mhm', 'ajá', 'uh', 'uhm', 'ah', 'eh', 'este', 'bueno',
])

const SKIP_CONTAINS = [
  'abrir micrófono', 'cerrar micrófono', 'compartir pantalla',
  'me desconect', 'problema de audio', 'me escuchan', '¿me ven',
  'podemos continuar', 'un momentito', 'permítame un segundo',
  'voy a compartir', 'compartiendo pantalla',
]

const PREAMBLE_NOISE = /^(okay[,.]?\s+|sí[,.]?\s+|si[,.]?\s+|buenas tardes[,.]?\s+|buenas noches[,.]?\s+|buenas[,.]?\s+|claro[,.]?\s+|perfecto[,.]?\s+|bien[,.]?\s+|mhm[,.]?\s+|este[,.]?\s+|ah[,.]?\s+|eh[,.]?\s+)+/i

// FPH-015: Logistica — Hypal/Zoom coordinators + Daniel Puentes skip
const LOGISTICA_NAMES = ['hipal', 'hypal', 'zoom', 'moderador', 'técnico', 'soporte',
  'daniel puentes', 'daniel p', 'puentes']

// Administration staff — should NOT be labeled as propietario/a
const ADMIN_NAMES = [
  'ivette', 'iveth', 'flores', 'saldaña', 'irja', 'administraci',
  'administrador', 'administradora', 'gerente', 'conserje',
  'daniel puentes', 'puentes', 'hypal', 'hipal',
]

const NOMBRES_FEMENINOS = new Set([
  'reyna', 'ivette', 'dayana', 'martha', 'marta', 'clara', 'kathia',
  'karen', 'lourdes', 'milkori', 'magda', 'miriam', 'mirian',
  'angela', 'ángela', 'melitza', 'yaraby', 'elizabeth', 'natalia', 'monica',
  'mónica', 'ana', 'maria', 'maría', 'gina', 'andrea', 'samanta', 'katerine',
  'claudia', 'marisol', 'fabiana', 'sarah', 'sara', 'rosa', 'carmen',
  'virginia', 'yamileth', 'liseth', 'ingrid', 'gloria', 'betty', 'diana',
  'luz', 'alba', 'ester', 'esther', 'adriana', 'sonia', 'patricia', 'laura',
  'isabel', 'cristina', 'vanessa', 'alejandra', 'hilda', 'lorena', 'roberta',
  'marlenne', 'yeni', 'sarai', 'lorei', 'griselda', 'karina', 'katerine',
  'melitza', 'lilia', 'cecilia', 'barbara', 'yamara', 'maribel', 'benita',
  'elba', 'evelyn', 'nelly', 'lizbeth', 'jessica', 'angie', 'katerine',
])

// ---- Timestamp formats ----
const TIMESTAMP_RE = /^\d{2}:\d{2}:\d{2}[\.,]\d{3}\s*-->\s*\d{2}:\d{2}:\d{2}[\.,]\d{3}/

// Speaker line: "Name Lastname:" or "Apartamento 7A | John Doe:" or "7A TA | John Doe:"
const SPEAKER_RE = /^([A-ZÁÉÍÓÚÑ][^:]{2,60}):\s*(.*)/

// VTT-style header
const VTT_HEADER = /^WEBVTT|^NOTE|^\d+$/

const NOMBRES_FEMENINOS_ARR = Array.from(NOMBRES_FEMENINOS)

function detectGender(name: string): 'propietaria' | 'propietario' {
  const lower = name.toLowerCase()
  if (NOMBRES_FEMENINOS_ARR.some(f => lower.includes(f))) return 'propietaria'
  return 'propietario'
}

// A Zoom label embedding a building reference, e.g. "P.H Los Álamos", "PH Luxor 300".
// Used to detect host/management accounts (not individual owners).
const PH_BUILDING = /\bp\.?\s?h\.?\s+[A-Za-zÁÉÍÓÚÑ]/i

// Corporate/legal-entity owners (a bank, S.A., foundation…). They own units but do
// not "intervene" in the debate — a representative does. We exclude them from the
// debate narrative (they still appear in the attendance/quorum table from the xlsx).
const ENTITY_KEYWORDS = /\b(?:banco|inmobiliaria|promotora|constructora|fundaci[oó]n|asociaci[oó]n|corporaci[oó]n|sociedad|desarrollos?|holding|fideicomiso|compa[ñn][ií]a|inversiones)\b/i
const ENTITY_SUFFIX = /(?:^|[\s,])(?:s\.?\s?a\.?|s\.?\s?r\.?\s?l\.?|s\.?\s?de\s?r\.?\s?l\.?|ltda\.?|inc\.?|corp\.?)\.?\s*$/i
function isEntity(s: string): boolean {
  const n = (s || '').trim()
  return !!n && (ENTITY_KEYWORDS.test(n) || ENTITY_SUFFIX.test(n))
}

// A label segment that describes a unit (not a person's name). Covers the legacy
// "Apartamento 7A Torre B" / "7A TB" forms and the Luxor tower-first "T3 29D".
function looksLikeUnit(s: string): boolean {
  return /\b(?:apartamento|apto|torre|local|oficina)\b/i.test(s) ||
         /\bT\s*\d{1,3}\b/i.test(s) ||          // tower code T3
         /\b\d{1,4}\s?[A-Za-z]\b/.test(s) ||     // apt code 29D / 7A
         /\bT[AB]\b/i.test(s)                    // TA / TB
}
// A pipe segment that is the person's name (neither a unit nor a building label).
function isNameSegment(s: string): boolean {
  return !looksLikeUnit(s) && !PH_BUILDING.test(s)
}

function detectRole(speakerRaw: string, speakerName: string): DebateBlock['speaker_role'] {
  const raw = speakerRaw.toLowerCase()
  const name = speakerName.toLowerCase()

  // FPH-015: the host account labeled AS the building ("PH Luxor 300", "P.H. Torre Alta")
  // → logistica (skipped). Anchored at the start = it's the building's own account.
  if (/^p\.?\s?h\.?\s+\w/i.test(speakerRaw.trim()) || /^p\.?\s?h\.?\s+\w/i.test(speakerName.trim())) {
    return 'logistica'
  }

  // Corporate/entity owner → exclude from debate (kept in the attendance table).
  if (isEntity(speakerRaw) || isEntity(speakerName)) return 'logistica'

  // Management/administration representative whose label embeds a building reference
  // AFTER a name (e.g. "Sadia De Gonzalez · P.H Los Álamos"). They are external staff,
  // not an owner — render as administración, never as a propietario/a of some unit.
  if (PH_BUILDING.test(speakerRaw) || PH_BUILDING.test(speakerName)) return 'administracion'

  if (LOGISTICA_NAMES.some(l => raw.includes(l) || name.includes(l))) return 'logistica'

  // Ivette / administración — check expanded admin list
  if (ADMIN_NAMES.some(n => name.includes(n) || raw.includes(n))) return 'administracion'

  // Abogado
  if (name.includes('roach') || name.includes('abogad') || raw.includes('abogad')) return 'abogado'

  // Presidente / junta
  if (raw.includes('presidente') || raw.includes('presidenta') ||
      raw.includes('junta direct') || raw.includes('vicepresid') ||
      raw.includes('tesorero') || raw.includes('secretari')) {
    return detectGender(speakerName) === 'propietaria' ? 'propietaria' : 'propietario'
  }

  // Apartamento prefix → propietario/a
  if (raw.includes('apartamento') || raw.includes('apto') || /\d+[a-h]/i.test(raw)) {
    return detectGender(speakerName)
  }

  return detectGender(speakerName)
}

function extractUnit(speakerRaw: string): string | undefined {
  // Hypal/Zoom labels are usually "Unidad | Nombre". With a pipe, only consider the
  // unit-like segment so a name fragment is never mistaken for a unit.
  const parts = speakerRaw.split('|').map(s => s.trim()).filter(Boolean)
  let hay = speakerRaw
  if (parts.length > 1) {
    const u = parts.find(looksLikeUnit)
    if (!u) return undefined
    hay = u
  }

  // Luxor tower-first: "T3 29D", "Torre 3 29D", "Apartamento T3 29D", "T3-29D".
  const mLux = hay.match(/\b(?:Torre\s*|T)\s*(\d{1,3})\s*[-\s]+\s*(\d{1,4}\s?[A-Za-z])\b/i)
  if (mLux) return `T${mLux[1]} ${mLux[2].replace(/\s+/g, '').toUpperCase()}`

  // Legacy: "Apartamento 7A Torre B" / "Apto 7A".
  const m1 = hay.match(/[Aa](?:partamento|pto)\.?\s*(\d+[A-H])\s*(?:Torre|T\.?)?\s*([AB])?/i)
  if (m1) {
    const unit = m1[1]
    const tower = m1[2] ? `T${m1[2].toUpperCase()}-` : ''
    return `${tower}${unit}`
  }
  // Legacy: "7A Torre B" / "7A TB".
  const m2 = hay.match(/(\d+[A-H])\s*(?:Torre|T\.?)?\s*([AB])/i)
  if (m2) return `T${m2[2].toUpperCase()}-${m2[1]}`
  return undefined
}

function extractSpeakerName(speakerRaw: string): string {
  const parts = speakerRaw.split('|').map(s => s.trim()).filter(Boolean)
  let name = speakerRaw
  if (parts.length > 1) {
    // Keep the segment(s) that are the actual name (drop unit / building segments).
    const nameParts = parts.filter(isNameSegment)
    name = (nameParts.length ? nameParts : parts).join(' ')
  } else {
    // No pipe: drop a trailing embedded building reference ("Nombre … P.H Los Álamos").
    name = name.replace(/\bp\.?\s?h\.?\s+.*/i, '').trim() || name
  }
  // Strip any residual unit tokens (covers the no-pipe case and stray prefixes).
  name = name
    .replace(/\b[Aa](?:partamento|pto)\.?\b/gi, '')
    .replace(/\bTorre\s*[A-H0-9]+\b/gi, '')
    .replace(/\bT\s*\d{1,3}\b/gi, '')          // tower code T3
    .replace(/\b\d{1,4}\s?[A-H]\b/gi, '')       // apt code 29D / 7A
    .replace(/\bT[AB]\b/gi, '')
    .replace(/\|/g, ' ')
    .replace(/\s{2,}/g, ' ')
    .trim()
  return name.replace(/\b\w/g, c => c.toUpperCase()).trim()
}

function cleanPreamble(text: string): string {
  return text.replace(PREAMBLE_NOISE, '').trim()
}

function shouldSkip(text: string): { skip: boolean; reason?: string } {
  const t = text.trim().toLowerCase()
  if (!t || t.length < 4) return { skip: true, reason: 'empty' }
  return { skip: false }
}

// ---- VTT/SRT/plain parser ----

interface RawLine {
  timestamp?: string
  speaker: string
  text: string
}

function parseLines(raw: string): RawLine[] {
  const lines = raw.split('\n').map(l => l.trim())
  const result: RawLine[] = []
  let currentTimestamp: string | undefined
  let currentSpeaker: string | undefined
  let currentLines: string[] = []

  function flush() {
    if (currentSpeaker && currentLines.length > 0) {
      result.push({
        timestamp: currentTimestamp,
        speaker: currentSpeaker,
        text: currentLines.join(' ').trim(),
      })
    }
    currentSpeaker = undefined
    currentLines = []
    currentTimestamp = undefined
  }

  for (const line of lines) {
    if (!line || VTT_HEADER.test(line)) continue

    if (TIMESTAMP_RE.test(line)) {
      currentTimestamp = line.split('-->')[0].trim()
      continue
    }

    const speakerMatch = line.match(SPEAKER_RE)
    if (speakerMatch) {
      flush()
      currentSpeaker = speakerMatch[1].trim()
      const rest = speakerMatch[2].trim()
      if (rest) currentLines.push(rest)
      continue
    }

    if (currentSpeaker) {
      currentLines.push(line)
    }
  }
  flush()
  return result
}

// ---- Consolidation: merge consecutive same-speaker lines ----

function consolidate(rawLines: RawLine[]): RawLine[] {
  const merged: RawLine[] = []
  for (const line of rawLines) {
    if (merged.length > 0 && merged[merged.length - 1].speaker === line.speaker) {
      merged[merged.length - 1].text += ' ' + line.text
    } else {
      merged.push({ ...line })
    }
  }
  return merged
}

// ---- Main export ----

export function parseTranscripcion(rawText: string): DebateBlock[] {
  const rawLines = parseLines(rawText)
  const consolidated = consolidate(rawLines)
  const blocks: DebateBlock[] = []

  for (const line of consolidated) {
    const rawCleaned = cleanPreamble(line.text)
    const cleaned = rawCleaned.trim() || line.text.trim()
    const { skip, reason } = shouldSkip(cleaned)

    const speakerName = extractSpeakerName(line.speaker)
    const speakerUnit = extractUnit(line.speaker)
    const role = detectRole(line.speaker, speakerName)

    // Always skip logistica (Hypal/Zoom coordinators + PH name as host)
    if (role === 'logistica') continue

    blocks.push({
      timestamp: line.timestamp,
      speaker_raw: line.speaker,
      speaker_name: speakerName,
      speaker_unit: speakerUnit,
      speaker_role: role,
      text_raw: line.text,
      text_cleaned: cleaned || line.text.trim(),
      skip,
      skip_reason: reason,
    })
  }

  return blocks
}
