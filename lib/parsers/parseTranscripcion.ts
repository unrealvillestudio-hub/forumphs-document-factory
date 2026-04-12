/**
 * parse_transcripcion.ts
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

const LOGISTICA_NAMES = ['hipal', 'hypal', 'zoom', 'moderador', 'técnico', 'soporte']

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
// HH:MM:SS.mmm --> HH:MM:SS.mmm or HH:MM:SS
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

function detectRole(speakerRaw: string, speakerName: string): DebateBlock['speaker_role'] {
  const raw = speakerRaw.toLowerCase()
  const name = speakerName.toLowerCase()

  if (LOGISTICA_NAMES.some(l => raw.includes(l) || name.includes(l))) return 'logistica'

  // Ivette / administración — check expanded admin list
  if (ADMIN_NAMES.some(n => name.includes(n) || raw.includes(n))) return 'administracion'

  // Abogado
  if (name.includes('roach') || name.includes('abogad') || raw.includes('abogad')) return 'abogado'

  // Presidente / junta
  if (raw.includes('presidente') || raw.includes('presidenta') ||
      raw.includes('junta direct') || raw.includes('vicepresid') ||
      raw.includes('tesorero') || raw.includes('secretari')) {
    // Determine sub-role
    return detectGender(speakerName) === 'propietaria' ? 'propietaria' : 'propietario'
  }

  // Apartamento prefix → propietario/a
  if (raw.includes('apartamento') || raw.includes('apto') || /\d+[a-h]/i.test(raw)) {
    return detectGender(speakerName)
  }

  return detectGender(speakerName)
}

function extractUnit(speakerRaw: string): string | undefined {
  // "Apartamento 15B Torre A" → "TA-15B"
  // "15B TA" → "TA-15B"
  // "Apt. 20F TB" → "TB-20F"
  const m1 = speakerRaw.match(/[Aa](?:partamento|pto)\.?\s*(\d+[A-H])\s*(?:Torre|T\.?)?\s*([AB])?/i)
  if (m1) {
    const unit = m1[1]
    const tower = m1[2] ? `T${m1[2].toUpperCase()}-` : ''
    return `${tower}${unit}`
  }
  const m2 = speakerRaw.match(/(\d+[A-H])\s*(?:Torre|T\.?)?\s*([AB])/i)
  if (m2) return `T${m2[2].toUpperCase()}-${m2[1]}`
  return undefined
}

function extractSpeakerName(speakerRaw: string): string {
  // Remove apartment prefixes
  let name = speakerRaw
    .replace(/[Aa]partamento\s+\d+[A-H]?\s*(?:[|]\s*)?/i, '')
    .replace(/[Aa]pto\.?\s*\d+[A-H]?\s*(?:[|]\s*)?/i, '')
    .replace(/Torre\s*[AB]\s*(?:[|]\s*)?/i, '')
    .replace(/\bT[AB]\b\s*(?:[|]\s*)?/g, '')
    .replace(/\d+[A-H]\s*(?:[|]\s*)?/g, '')
    .replace(/\|/g, '')
    .trim()
  // Capitalize properly
  return name.replace(/\b\w/g, c => c.toUpperCase()).trim()
}

function cleanPreamble(text: string): string {
  return text.replace(PREAMBLE_NOISE, '').trim()
}

function shouldSkip(text: string): { skip: boolean; reason?: string } {
  const t = text.trim().toLowerCase()
  // Only skip completely empty text — Claude decides everything else
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
    const cleaned = rawCleaned.trim() || line.text.trim()  // fallback to raw if cleaning empties
    const { skip, reason } = shouldSkip(cleaned)

    const speakerName = extractSpeakerName(line.speaker)
    const speakerUnit = extractUnit(line.speaker)
    const role = detectRole(line.speaker, speakerName)

    // Always skip logistica (Hypal/Zoom coordinators)
    if (role === 'logistica') continue

    blocks.push({
      timestamp: line.timestamp,
      speaker_raw: line.speaker,
      speaker_name: speakerName,
      speaker_unit: speakerUnit,
      speaker_role: role,
      text_raw: line.text,
      text_cleaned: cleaned || line.text.trim(),
      skip: skip,
      skip_reason: reason,
    })
  }

  return blocks
}
