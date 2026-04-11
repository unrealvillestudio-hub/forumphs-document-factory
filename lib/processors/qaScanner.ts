/**
 * qaScanner.ts
 * 100% document QA scan — reads every sentence of the generated acta
 * and reports all errors before delivery.
 */

import type { QAReport, QAError, QAErrorType } from '../types'

// ---- Error patterns ----

const PATTERNS: Array<{ type: QAErrorType; pattern: RegExp | string[]; description: string }> = [
  {
    type: 'FIRST_PERSON',
    pattern: /\b(yo\b|tenemos\b|estamos\b|vamos a\b|podemos\b|nuestro\b|nuestra\b|nosotros\b|hemos\b|queremos\b|somos\b|soy\b)\b/gi,
    description: 'Primera persona en el texto',
  },
  {
    type: 'ORAL_ARTIFACT',
    pattern: /\b(pues[,\s]|digamos[,\s]|o sea[,\s]|fondear|este[,]|bueno[,\s]|híjole|fíjate que)\b/gi,
    description: 'Palabra coloquial de habla oral',
  },
  {
    type: 'SPOKEN_WORD',
    pattern: /\b(acá,|porfa\b|ajá\b|mhm\b|uh\b|uhm\b|eh[,\s])\b/gi,
    description: 'Muletilla oral detectada',
  },
  {
    type: 'REPEATED_WORD',
    pattern: /\b(\w{3,})\s+\1\b/gi,
    description: 'Palabra repetida consecutiva (ej: "que que", "de de")',
  },
  {
    type: 'DANGLING_CONJ',
    pattern: /\b(porque|pero|y|o)\.\s*$/gim,
    description: 'Conjunción al final de oración',
  },
  {
    type: 'INCOMPLETE_SENTENCE',
    pattern: /manifestó que\s+\w{1,5}\./gi,
    description: 'Fragmento incompleto tras "manifestó que"',
  },
  {
    type: 'NUMBER_FORMAT',
    pattern: /\b\d{1,2}\s+\d{3}\b/g,
    description: 'Número con espacio en vez de coma (ej: "30 000" → "30,000")',
  },
]

// Female names for gender check
const NOMBRES_FEMENINOS = [
  'reyna', 'ivette', 'dayana', 'martha', 'marta', 'clara', 'kathia',
  'karen', 'lourdes', 'milkori', 'magda', 'miriam', 'mirian', 'angela',
  'melitza', 'yaraby', 'elizabeth', 'natalia', 'monica', 'ana', 'maria',
  'gina', 'andrea', 'samanta', 'katerine', 'claudia', 'marisol', 'fabiana',
  'sara', 'sara', 'rosa', 'carmen', 'virginia', 'yamileth', 'liseth',
  'ingrid', 'gloria', 'betty', 'diana', 'luz', 'alba', 'ester', 'esther',
  'adriana', 'sonia', 'patricia', 'laura', 'isabel', 'cristina', 'vanessa',
  'alejandra', 'hilda', 'lorena', 'roberta', 'marlenne',
]

function isFeminineFirstName(name: string): boolean {
  const lower = name.toLowerCase()
  return NOMBRES_FEMENINOS.some(f => lower.includes(f))
}

function checkGenderMismatch(paragraph: string, index: number): QAError[] {
  const errors: QAError[] = []

  // Pattern: "El propietario ... [FeminineName]" or "La propietaria ... [MasculineName]"
  const elPropietarioM = paragraph.match(/El propietario.*?,\s+(?:señor|el señor)?\s+([A-ZÁ][a-záéíóúñ]+)/g)
  if (elPropietarioM) {
    for (const m of elPropietarioM) {
      const nameM = m.match(/señor\s+([A-ZÁ][a-záéíóúñ]+)/)
      if (nameM && isFeminineFirstName(nameM[1])) {
        errors.push({
          type: 'GENDER_MISMATCH',
          paragraph_index: index,
          text_fragment: m.substring(0, 80),
          suggestion: 'Cambiar "El propietario" por "La propietaria"',
        })
      }
    }
  }

  const laPropietariaM = paragraph.match(/La propietaria.*?,\s+(?:señora|la señora)?\s+([A-ZÁ][a-záéíóúñ]+)/g)
  if (laPropietariaM) {
    for (const m of laPropietariaM) {
      const nameM = m.match(/señora\s+([A-ZÁ][a-záéíóúñ]+)/)
      if (nameM && !isFeminineFirstName(nameM[1])) {
        errors.push({
          type: 'GENDER_MISMATCH',
          paragraph_index: index,
          text_fragment: m.substring(0, 80),
          suggestion: 'Cambiar "La propietaria" por "El propietario"',
        })
      }
    }
  }

  return errors
}

// ---- Word count ----

export function countWords(text: string): number {
  return text.trim().split(/\s+/).filter(w => w.length > 0).length
}

// ---- Main QA scan ----

export function runQAScan(fullText: string): QAReport {
  const paragraphs = fullText.split(/\n+/).filter(p => p.trim().length > 5)
  const errors: QAError[] = []
  const byType: Partial<Record<QAErrorType, number>> = {}

  for (let i = 0; i < paragraphs.length; i++) {
    const para = paragraphs[i]

    // Pattern checks
    for (const { type, pattern } of PATTERNS) {
      if (Array.isArray(pattern)) continue
      const re = pattern instanceof RegExp ? new RegExp(pattern.source, pattern.flags) : null
      if (!re) continue

      let match
      while ((match = re.exec(para)) !== null) {
        errors.push({
          type,
          paragraph_index: i,
          text_fragment: para.substring(Math.max(0, match.index - 20), match.index + 40),
        })
        byType[type] = (byType[type] || 0) + 1
        // Prevent infinite loop on zero-length match
        if (match.index === re.lastIndex) re.lastIndex++
      }
    }

    // Gender mismatch check
    const genderErrors = checkGenderMismatch(para, i)
    for (const e of genderErrors) {
      errors.push(e)
      byType['GENDER_MISMATCH'] = (byType['GENDER_MISMATCH'] || 0) + 1
    }
  }

  const totalErrors = errors.length
  const wordCount = countWords(fullText)
  const wordCountPct = Math.round((wordCount / 18000) * 100)

  // Verdict
  let verdict: QAReport['verdict']
  if (totalErrors === 0) verdict = 'PASS'
  else if (totalErrors <= 10) verdict = 'PASS'
  else if (totalErrors <= 50) verdict = 'WARN'
  else if (totalErrors <= 100) verdict = 'FAIL'
  else verdict = 'STOP'

  return {
    total_errors: totalErrors,
    by_type: byType,
    errors,
    word_count: wordCount,
    word_count_pct: wordCountPct,
    passed: totalErrors <= 10,
    verdict,
  }
}

// ---- Error summary for UI ----

export function qaVerdictLabel(verdict: QAReport['verdict']): string {
  switch (verdict) {
    case 'PASS': return '✅ Acta lista para revisión de Ivette'
    case 'WARN': return '⚠️ Errores menores — revisar antes de enviar'
    case 'FAIL': return '❌ Errores significativos — corregir secciones'
    case 'STOP': return '🛑 STOP — activar Paso 0.5 (Claude API completo)'
  }
}
