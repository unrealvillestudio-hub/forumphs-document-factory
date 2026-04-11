/**
 * actaBuilder.ts
 * Builds the final .docx Acta from formalized blocks + skeleton data.
 * Follows ForumPHs Document Factory v1.4 format rules exactly.
 */

import type { ParsedHypalZip, PreflightData, DebateBlock } from '../types'

// ---- Helper: number formatting ----

function fmtVotes(n: number): string {
  return `${n} votos`
}

function fmtPct(n: number): string {
  return `${n.toFixed(2)}%`
}

function fmtMoney(n: number): string {
  return `$${n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}

// ---- Section assembler ----

interface Section {
  number?: number
  title: string
  content: string[]  // paragraphs
}

function buildHeaderSection(
  parsed: ParsedHypalZip,
  preflight: PreflightData
): string[] {
  const s = parsed.skeleton
  const finca = preflight.finca || s.ph_finca || '[FINCA PENDIENTE]'
  const codigo = preflight.codigo || s.ph_codigo || '[CÓDIGO PENDIENTE]'
  const phName = s.ph_name || '[NOMBRE PH PENDIENTE]'
  const typeLabel = s.assembly_type === 'EXTRAORDINARIA' ? 'Asamblea Extraordinaria' : 'Asamblea Ordinaria'

  const paragraphs: string[] = []

  paragraphs.push(
    `En la ciudad de Panamá, siendo las ${s.time_start} del ${s.date_str}, se reunieron previa ` +
    `convocatoria los copropietarios del **${phName}**, que se encuentra debidamente inscrita bajo ` +
    `la Finca número ${finca}, con Código de ubicación número ${codigo} de la Sección de ` +
    `Propiedad Horizontal del Registro Público, conforme a lo establecido en la Ley No. 284 ` +
    `de 14 de febrero de 2022 de Propiedad Horizontal, dicha reunión se llevó a cabo de manera virtual.`
  )

  if (preflight.convocatoria_text) {
    paragraphs.push('A fin de celebrar esta Asamblea se comunicó a todos los propietarios mediante convocatoria cuyo texto se transcribe a continuación:')
    paragraphs.push(preflight.convocatoria_text)
  }

  return paragraphs
}

function buildQuorumSection(
  parsed: ParsedHypalZip,
  preflight: PreflightData,
  formalizedBlocks: DebateBlock[]
): Section {
  const s = parsed.skeleton
  const presentUnits = preflight.confirmed_present_units ?? s.present_units ?? parsed.attendance.length
  const totalUnits = s.total_units || 0
  const pct = totalUnits > 0 ? ((presentUnits / totalUnits) * 100).toFixed(2) : '0'

  const paragraphs: string[] = []

  // Check if there was a first call without quorum
  const hasFirstCallGap = false // TODO: detect from transcription

  paragraphs.push(
    `Siendo las ${s.time_start}, la administración procedió a validar el quórum, ` +
    `encontrándose presentes o representadas ${presentUnits} unidades inmobiliarias de las ` +
    `${totalUnits} del total del PH, lo que representa el ${pct}% del total, ` +
    `cumpliendo con el requisito de la mitad más uno (${Math.floor(totalUnits / 2) + 1} unidades), ` +
    `por lo que en atención a lo dispuesto en el artículo 67 de la Ley 284 de 2022, ` +
    `se da inicio a la Asamblea de Propietarios.`
  )

  // Attendance table note
  if (parsed.attendance.length > 0) {
    paragraphs.push(
      `Se encontraban presentes o debidamente representadas [${presentUnits} unidades inmobiliarias]{.mark}, a saber:`
    )
  }

  return {
    number: 1,
    title: 'VERIFICACIÓN DEL QUORUM',
    content: paragraphs,
  }
}

function buildDebateSections(
  parsed: ParsedHypalZip,
  formalizedBlocks: DebateBlock[]
): Section[] {
  const s = parsed.skeleton
  const sections: Section[] = []

  // Group blocks by agenda section
  const agendaItems = s.agenda_items.length > 0
    ? s.agenda_items
    : [{ number: 2, title: 'DESARROLLO DE LA ASAMBLEA' }]

  for (const item of agendaItems) {
    const paragraphs: string[] = []
    const sectionBlocks = formalizedBlocks.filter(
      b => b.agenda_section === item.number && !b.skip && b.text_formal
    )

    for (const block of sectionBlocks) {
      if (block.text_formal) {
        paragraphs.push(block.text_formal)
      }
    }

    // Add votation results if available
    const relatedVotes = parsed.votations.filter((v, i) => {
      // Simple heuristic: distribute votes across agenda items
      return i === (item.number - 2)
    })

    for (const vote of relatedVotes) {
      paragraphs.push(
        `Se sometió a votación ${vote.topic}. Los resultados fueron los siguientes:\n\n` +
        `${vote.yes_votes} votos a favor de ${vote.topic}\n\n` +
        `${vote.no_votes} votos en contra de ${vote.topic}` +
        (vote.abstentions ? `\n\n${vote.abstentions} abstenciones` : '') +
        `\n\n${vote.approved
          ? `✅ **Se aprobó** ${vote.topic} con ${vote.yes_votes} votos que representan el ${vote.pct_yes?.toFixed(2)}%.`
          : `❌ **No se aprobó** ${vote.topic}. Los votos en contra (${vote.no_votes}) superaron los votos a favor (${vote.yes_votes}).`
        }`
      )
    }

    if (paragraphs.length > 0) {
      sections.push({
        number: item.number,
        title: item.title.toUpperCase(),
        content: paragraphs,
      })
    }
  }

  return sections
}

function buildClosingSection(
  parsed: ParsedHypalZip,
  preflight: PreflightData
): Section {
  const s = parsed.skeleton
  const timeEnd = preflight.confirmed_time_end || s.time_end || '[HORA FIN PENDIENTE]'

  return {
    title: 'CIERRE',
    content: [
      `Siendo, el ${s.date_str} a las ${timeEnd}, damos por terminada la sesión de la ${
        s.assembly_type === 'EXTRAORDINARIA' ? 'Asamblea Extraordinaria' : 'Asamblea Ordinaria'
      } de Propietarios.`
    ]
  }
}

// ---- Full text assembler (for QA and generation) ----

export function buildActaText(
  parsed: ParsedHypalZip,
  preflight: PreflightData,
  formalizedBlocks: DebateBlock[]
): string {
  const s = parsed.skeleton
  const phName = s.ph_name || '[NOMBRE PH]'
  const actaNum = s.acta_number || '?'
  const typeLabel = s.assembly_type === 'EXTRAORDINARIA' ? 'ASAMBLEA EXTRAORDINARIA' : 'ASAMBLEA ORDINARIA'

  const lines: string[] = []

  // Header
  lines.push(`ACTA No_${actaNum}`)
  lines.push('')
  lines.push(`${typeLabel} DE PROPIETARIOS DEL ${phName}`)
  lines.push('')
  lines.push(s.date_str.toUpperCase())
  lines.push('')

  // Intro paragraph
  const headerParas = buildHeaderSection(parsed, preflight)
  lines.push(...headerParas)
  lines.push('')

  // Quorum section
  const quorumSection = buildQuorumSection(parsed, preflight, formalizedBlocks)
  lines.push(`1. ${quorumSection.title}`)
  lines.push('')
  lines.push(...quorumSection.content)
  lines.push('')

  // Debate sections
  const debateSections = buildDebateSections(parsed, formalizedBlocks)
  for (const section of debateSections) {
    lines.push(`${section.number}. ${section.title}`)
    lines.push('')
    lines.push(...section.content)
    lines.push('')
  }

  // Closing
  const closingSection = buildClosingSection(parsed, preflight)
  lines.push(closingSection.content[0])
  lines.push('')

  // Signatures
  lines.push('Para constancia se firma la presente acta,')
  lines.push('')
  lines.push(`Junta Directiva, DEL ${phName}`)
  lines.push('')
  lines.push('________________________________________________________________')
  lines.push('')
  lines.push('[PRESIDENTE]                    [SECRETARIO/A]')
  lines.push('')
  lines.push('PRESIDENTE/A                    SECRETARIO/A')

  return lines.join('\n')
}

// ---- Attendance table builder ----

export function buildAttendanceTable(records: import('../types').AttendanceRecord[]): string {
  if (records.length === 0) return ''

  const rows = records.map(r => {
    const rep = r.represented_by ? `Representado por: ${r.represented_by}` : ''
    return `${r.unit} | ${r.owner_name}${rep ? ` | ${rep}` : ''}`
  })

  return rows.join('\n')
}
