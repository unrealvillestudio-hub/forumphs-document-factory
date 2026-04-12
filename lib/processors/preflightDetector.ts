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

  // 5a. Total units (if not found)
  if (!s.total_units || s.total_units === 0) {
    gaps.push({
      field: 'total_units',
      label: 'Total de unidades del PH',
      description: 'Número total de unidades inmobiliarias que conforman el PH (ej: 274)',
      required: true,
      type: 'number',
      value: parsed.attendance.length || 0,
    })
  }

  // 5b. Date (if not found)
  if (!s.date_str || s.date_str.includes('PENDIENTE') || s.date_str.includes('NO ENCONTRADA')) {
    gaps.push({
      field: 'confirmed_date',
      label: 'Fecha de la Asamblea',
      description: 'Fecha en que se celebró la asamblea (ej: lunes, 21 de abril de 2025)',
      required: true,
      type: 'text',
    })
  }

  // 6. President and Secretary names for signatures
  gaps.push({
    field: 'president_name',
    label: 'Nombre del/la Presidente/a de la JD',
    description: 'Nombre completo para la firma del acta (ej: Alex Piña)',
    required: false,
    type: 'text',
    value: s.president_name || '',
  })
  gaps.push({
    field: 'secretary_name',
    label: 'Nombre del/la Secretario/a de la JD',
    description: 'Nombre completo para la firma del acta (ej: Laura Gaviria)',
    required: false,
    type: 'text',
    value: s.secretary_name || '',
  })

  // 7. Time end (if not found)
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
  if (answers.total_units) {
    updated.skeleton.total_units = Number(answers.total_units)
  }
  if (answers.president_name) {
    updated.skeleton.president_name = String(answers.president_name)
  }
  if (answers.secretary_name) {
    updated.skeleton.secretary_name = String(answers.secretary_name)
  }

  return updated
}
