/**
 * preflightDetector.ts
 * Detects what information is missing from the parsed Hypal data
 * and generates the gaps list for the user to fill in.
 */

import type { ParsedHypalZip, PreflightGap } from '../types'

export function detectPreflightGaps(parsed: ParsedHypalZip): PreflightGap[] {
  const gaps: PreflightGap[] = []
  const s = parsed.skeleton

  // 1. Registro Público — Finca
  if (!s.ph_finca) {
    gaps.push({
      field: 'finca',
      label: 'Finca del Registro Público',
      description: 'Número de Finca de la Sección de Propiedad Horizontal (ej: 30285586)',
      required: true,
      type: 'text',
    })
  }

  // 2. Código de ubicación
  if (!s.ph_codigo) {
    gaps.push({
      field: 'codigo',
      label: 'Código de Ubicación',
      description: 'Código del Registro Público (ej: 8706)',
      required: true,
      type: 'text',
    })
  }

  // 3. Convocatoria text
  gaps.push({
    field: 'convocatoria_text',
    label: 'Texto literal de la Convocatoria',
    description: 'El texto exacto de la convocatoria enviada a los propietarios (para incluir en el acta)',
    required: false,
    type: 'textarea',
  })

  // 4. Informe de Gestión (for JD reports)
  gaps.push({
    field: 'has_informe_gestion',
    label: '¿Hay Informe de Gestión de la JD?',
    description: 'Si la Junta Directiva preparó un informe formal escrito (no solo lo verbal en transcripción)',
    required: false,
    type: 'boolean',
    value: false,
  })

  // 5. Confirmed present units (Hypal snapshot vs session-verified)
  gaps.push({
    field: 'confirmed_present_units',
    label: 'Unidades presentes verificadas en sesión',
    description: `Hypal capturó ${parsed.attendance.length} unidades. ¿Cuál es el número verificado durante la sesión?`,
    required: false,
    type: 'number',
    value: parsed.attendance.length,
  })

  // 6. Time end (if not found)
  if (!s.time_end || s.time_end.includes('PENDIENTE')) {
    gaps.push({
      field: 'confirmed_time_end',
      label: 'Hora de cierre de la Asamblea',
      description: 'Hora exacta en que se dio por terminada la sesión (ej: 9:04 pm)',
      required: true,
      type: 'text',
    })
  }

  return gaps
}

export function applyPreflightAnswers(
  parsed: ParsedHypalZip,
  answers: Record<string, string | number | boolean>
): ParsedHypalZip {
  const updated = { ...parsed, skeleton: { ...parsed.skeleton } }

  if (answers.finca) updated.skeleton.ph_finca = String(answers.finca)
  if (answers.codigo) updated.skeleton.ph_codigo = String(answers.codigo)
  if (answers.confirmed_present_units) {
    updated.skeleton.present_units = Number(answers.confirmed_present_units)
  }
  if (answers.confirmed_time_end) {
    updated.skeleton.time_end = String(answers.confirmed_time_end)
  }

  return updated
}
