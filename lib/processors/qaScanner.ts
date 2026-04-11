/**
 * qaScanner.ts — v2
 * Full document QA. Two layers:
 *
 * LAYER 1 — COMPLETENESS: Does the acta have all required structural elements?
 * LAYER 2 — TEXT QUALITY: Are there first-person, oral artifacts, gender errors, etc.?
 *
 * Word count is reported as-is (no comparison to a reference acta that doesn't exist).
 * Completeness score (0–100) replaces the word-count % metric.
 */

import type { QAReport, QAError, QAErrorType, ParsedHypalZip, DebateBlock } from '../types'

// ---- Text quality error patterns ----

const PATTERNS: Array<{ type: QAErrorType; pattern: RegExp }> = [
  {
    type: 'FIRST_PERSON',
    pattern: /\b(yo\b|tenemos\b|estamos\b|vamos a\b|podemos\b|nuestro\b|nuestra\b|nosotros\b|hemos\b|queremos\b|somos\b|soy\b)\b/gi,
  },
  {
    type: 'ORAL_ARTIFACT',
    pattern: /\b(pues[,\s]|digamos[,\s]|o sea[,\s]|fondear|este[,]|bueno[,\s]|híjole|fíjate que)\b/gi,
  },
  {
    type: 'SPOKEN_WORD',
    pattern: /\b(acá,|porfa\b|ajá\b|mhm\b|uh\b|uhm\b|eh[,\s])\b/gi,
  },
  {
    type: 'REPEATED_WORD',
    pattern: /\b(\w{3,})\s+\1\b/gi,
  },
  {
    type: 'DANGLING_CONJ',
    pattern: /\b(porque|pero|y|o)\.\s*$/gim,
  },
  {
    type: 'INCOMPLETE_SENTENCE',
    pattern: /manifestó que\s+\w{1,5}\./gi,
  },
  {
    type: 'NUMBER_FORMAT',
    pattern: /\b\d{1,2}\s+\d{3}\b/g,
  },
]

const NOMBRES_FEMENINOS = [
  'reyna','ivette','dayana','martha','marta','clara','kathia','karen','lourdes',
  'milkori','magda','miriam','mirian','angela','ángela','melitza','yaraby',
  'elizabeth','natalia','monica','mónica','ana','maria','maría','gina','andrea',
  'samanta','katerine','claudia','marisol','fabiana','sara','rosa','carmen',
  'virginia','yamileth','liseth','ingrid','gloria','betty','diana','luz','alba',
  'ester','esther','adriana','sonia','patricia','laura','isabel','cristina',
  'vanessa','alejandra','hilda','lorena','roberta','marlenne',
]

function isFeminine(name: string): boolean {
  const lower = name.toLowerCase()
  return NOMBRES_FEMENINOS.some(f => lower.includes(f))
}

function checkGenderMismatch(paragraph: string, index: number): QAError[] {
  const errors: QAError[] = []
  const elProp = paragraph.match(/El propietario[^,]*,\s+(?:señor\s+)?([A-ZÁ][a-záéíóúñ]+)/g)
  if (elProp) {
    for (const m of elProp) {
      const nm = m.match(/(?:señor\s+)?([A-ZÁ][a-záéíóúñ]+)$/)
      if (nm && isFeminine(nm[1])) {
        errors.push({ type: 'GENDER_MISMATCH', paragraph_index: index, text_fragment: m.substring(0, 80), suggestion: '"El propietario" → "La propietaria"' })
      }
    }
  }
  const laProp = paragraph.match(/La propietaria[^,]*,\s+(?:señora\s+)?([A-ZÁ][a-záéíóúñ]+)/g)
  if (laProp) {
    for (const m of laProp) {
      const nm = m.match(/(?:señora\s+)?([A-ZÁ][a-záéíóúñ]+)$/)
      if (nm && !isFeminine(nm[1])) {
        errors.push({ type: 'GENDER_MISMATCH', paragraph_index: index, text_fragment: m.substring(0, 80), suggestion: '"La propietaria" → "El propietario"' })
      }
    }
  }
  return errors
}

// ---- LAYER 1: Completeness checks ----

export interface CompletenessItem {
  label: string
  passed: boolean
  detail?: string
}

export interface CompletenessReport {
  score: number  // 0-100
  items: CompletenessItem[]
}

export function checkCompleteness(
  fullText: string,
  parsed: ParsedHypalZip,
  formalizedBlocks: DebateBlock[]
): CompletenessReport {
  const items: CompletenessItem[] = []

  const hasOpening = /registro público|finca número|ley.*284/i.test(fullText)
  items.push({ label: 'Párrafo de apertura con Registro Público', passed: hasOpening })

  const hasQuorum = /art[íi]culo\s+67/i.test(fullText) || /quór?um/i.test(fullText)
  items.push({ label: 'Sección de quórum (Art. 67 Ley 284)', passed: hasQuorum })

  const hasAttendance = parsed.attendance.length === 0 ||
    fullText.includes(parsed.attendance[0]?.owner_name || '___NONE___')
  items.push({
    label: 'Lista de asistentes incluida',
    passed: hasAttendance,
    detail: parsed.attendance.length === 0 ? 'No hay asistentes en el ZIP' : undefined,
  })

  for (const item of parsed.skeleton.agenda_items) {
    const titleWords = item.title.split(' ').slice(0, 3).join(' ')
    const blocksForSection = formalizedBlocks.filter(
      b => b.agenda_section === item.number && !b.skip && b.text_formal
    )
    const hasContent = blocksForSection.length > 0 ||
      new RegExp(titleWords, 'i').test(fullText)
    items.push({
      label: `Punto ${item.number}: ${item.title.substring(0, 40)}`,
      passed: hasContent,
      detail: `${blocksForSection.length} bloques formalizados`,
    })
  }

  for (const vote of parsed.votations) {
    const topicWords = vote.topic.split(' ').slice(0, 3).join(' ')
    const hasVote = new RegExp(topicWords, 'i').test(fullText) ||
      new RegExp(`${vote.yes_votes}\\s+votos`, 'i').test(fullText)
    items.push({
      label: `Votación: "${vote.topic.substring(0, 40)}"`,
      passed: hasVote,
      detail: `${vote.yes_votes} sí / ${vote.no_votes} no`,
    })
  }

  const hasClosing = /damos?\s+por\s+terminada|se\s+da\s+por\s+terminad[ao]/i.test(fullText)
  items.push({ label: 'Cierre con hora de terminación', passed: hasClosing })

  const hasSignatures = /presidente|secretari/i.test(fullText) && /_{10,}/.test(fullText)
  items.push({ label: 'Bloque de firmas', passed: hasSignatures })

  const total = formalizedBlocks.length
  const formalized = formalizedBlocks.filter(b => b.text_formal).length
  const fmtPct = total > 0 ? Math.round((formalized / total) * 100) : 0
  items.push({
    label: 'Bloques formalizados por Claude API',
    passed: fmtPct >= 70,
    detail: `${formalized}/${total} (${fmtPct}%)`,
  })

  const passed = items.filter(i => i.passed).length
  const score = Math.round((passed / items.length) * 100)
  return { score, items }
}

export function countWords(text: string): number {
  return text.trim().split(/\s+/).filter(w => w.length > 0).length
}

export function runQAScan(
  fullText: string,
  parsed?: ParsedHypalZip,
  formalizedBlocks?: DebateBlock[]
): QAReport {
  const paragraphs = fullText.split(/\n+/).filter(p => p.trim().length > 5)
  const errors: QAError[] = []
  const byType: Partial<Record<QAErrorType, number>> = {}

  for (let i = 0; i < paragraphs.length; i++) {
    const para = paragraphs[i]
    for (const { type, pattern } of PATTERNS) {
      const re = new RegExp(pattern.source, pattern.flags)
      let match
      while ((match = re.exec(para)) !== null) {
        errors.push({ type, paragraph_index: i, text_fragment: para.substring(Math.max(0, match.index - 20), match.index + 40) })
        byType[type] = (byType[type] || 0) + 1
        if (match.index === re.lastIndex) re.lastIndex++
      }
    }
    const genderErrors = checkGenderMismatch(para, i)
    for (const e of genderErrors) {
      errors.push(e)
      byType['GENDER_MISMATCH'] = (byType['GENDER_MISMATCH'] || 0) + 1
    }
  }

  const totalErrors = errors.length
  const wordCount = countWords(fullText)
  const completeness = parsed && formalizedBlocks
    ? checkCompleteness(fullText, parsed, formalizedBlocks)
    : undefined

  const completenessOk = !completeness || completeness.score >= 80
  let verdict: QAReport['verdict']
  if (totalErrors <= 10 && completenessOk) verdict = 'PASS'
  else if (totalErrors <= 50) verdict = 'WARN'
  else if (totalErrors <= 100) verdict = 'FAIL'
  else verdict = 'STOP'

  return {
    total_errors: totalErrors,
    by_type: byType,
    errors,
    word_count: wordCount,
    word_count_pct: undefined,
    completeness,
    passed: verdict === 'PASS',
    verdict,
  }
}

export function qaVerdictLabel(verdict: QAReport['verdict']): string {
  switch (verdict) {
    case 'PASS': return '✅ Acta lista para revisión de Ivette'
    case 'WARN': return '⚠️ Errores menores — revisar antes de enviar'
    case 'FAIL': return '❌ Errores significativos — corregir secciones'
    case 'STOP': return '🛑 STOP — revisar completamente'
  }
}
