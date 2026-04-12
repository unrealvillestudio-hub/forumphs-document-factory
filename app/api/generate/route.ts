/**
 * /api/generate/route.ts — v2
 * Full DOCX generation with all fixes:
 * - OR/EX nomenclature in filename
 * - Section assigner applied before building
 * - Informe de Gestión inserted as dedicated section
 * - Vote-to-section semantic linking
 * - First call without quorum detection
 * - Document footer
 * - QA v2 completeness score
 */

import { NextRequest, NextResponse } from 'next/server'
import type { GenerateResponse, ParsedHypalZip, PreflightData, DebateBlock, VotationRecord } from '@/lib/types'

export const runtime = 'nodejs'
export const maxDuration = 120

// ---- Vote-to-section matcher ----
function matchVoteToSection(vote: VotationRecord, agendaItems: { number: number; title: string }[]): number {
  if (agendaItems.length === 0) return 2
  const voteWords = new Set(
    vote.topic.toLowerCase().replace(/[^a-z0-9\s]/g, ' ').split(/\s+/).filter(w => w.length > 4)
  )
  let best = agendaItems[0].number
  let bestScore = 0
  for (const item of agendaItems) {
    const titleWords = item.title.toLowerCase().replace(/[^a-z0-9\s]/g, ' ').split(/\s+/).filter(w => w.length > 4)
    let hits = 0
    for (const tw of titleWords) { if (voteWords.has(tw)) hits++ }
    const score = titleWords.length > 0 ? hits / titleWords.length : 0
    if (score > bestScore) { bestScore = score; best = item.number }
  }
  return best
}

// ---- First-call-without-quorum detector ----
function detectFirstCallNoQuorum(rawTranscription: string): boolean {
  return /primer\s+llamado|no\s+(?:se\s+)?alcanz[oó].*quór?um|segundo\s+llamado|falta.*quór?um/i.test(rawTranscription)
}

export async function POST(req: NextRequest): Promise<NextResponse<GenerateResponse>> {
  try {
    const { parsed, preflight, formalizedBlocks }: {
      parsed: ParsedHypalZip
      preflight: PreflightData
      formalizedBlocks: DebateBlock[]
    } = await req.json()

    const {
      Document, Paragraph, TextRun, Table, TableRow, TableCell,
      AlignmentType, WidthType, Packer, UnderlineType, Footer,
    } = await import('docx')

    const { assignBlocksToSections } = await import('@/lib/processors/sectionAssigner')
    const { buildActaText } = await import('@/lib/generators/actaBuilder')
    const { runQAScan } = await import('@/lib/processors/qaScanner')

    const s = parsed.skeleton
    const phName = s.ph_name || 'PH'
    const actaNum = s.acta_number || '1'
    const year = new Date().getFullYear()
    const typeLabel = s.assembly_type === 'EXTRAORDINARIA' ? 'ASAMBLEA EXTRAORDINARIA' : 'ASAMBLEA ORDINARIA'
    const typeCode = s.assembly_type === 'EXTRAORDINARIA' ? 'EX' : 'OR'
    const finca = preflight.finca || s.ph_finca || '[FINCA PENDIENTE]'
    const codigo = preflight.codigo || s.ph_codigo || '[CÓDIGO PENDIENTE]'
    const presentUnits = preflight.confirmed_present_units ?? s.present_units ?? parsed.attendance.length
    const totalUnits = s.total_units || 0
    const timeEnd = preflight.confirmed_time_end || s.time_end || '[HORA FIN]'

    // Apply section assigner to formalized blocks
    const assignedBlocks = assignBlocksToSections(formalizedBlocks, s.agenda_items)

    // Detect first call without quorum
    const hasFirstCallNoQuorum = detectFirstCallNoQuorum(parsed.raw_files['transcripcion'] || '')

    // ---- Helpers ----
    const TNR = 'Times New Roman'

    const normal = (text: string, opts: { bold?: boolean; italic?: boolean; indent?: boolean; before?: number } = {}) =>
      new Paragraph({
        children: [new TextRun({ text, bold: opts.bold, italics: opts.italic, size: 22, font: TNR })],
        alignment: AlignmentType.JUSTIFIED,
        indent: opts.indent ? { left: 720 } : undefined,
        spacing: { before: opts.before ?? 120, after: 120, line: 276 },
      })

    const sectionTitle = (num: number | undefined, title: string) =>
      new Paragraph({
        children: [
          new TextRun({ text: num ? `${num}.  ` : '', bold: true, size: 22, font: TNR }),
          new TextRun({ text: title, bold: true, underline: { type: UnderlineType.SINGLE }, size: 22, font: TNR }),
        ],
        spacing: { before: 360, after: 160 },
      })

    const approval = (text: string, approved: boolean) =>
      new Paragraph({
        children: [
          new TextRun({ text: approved ? '✅ ' : '❌ ', size: 22, font: TNR }),
          new TextRun({ text, bold: true, size: 22, font: TNR }),
        ],
        spacing: { before: 160, after: 160 },
      })

    const emptyLine = () => new Paragraph({ children: [new TextRun({ text: '', size: 22, font: TNR })] })

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const docChildren: any[] = []

    // === TITLE ===
    docChildren.push(new Paragraph({
      children: [new TextRun({ text: `ACTA No_${actaNum}-${year}`, bold: true, underline: { type: UnderlineType.SINGLE }, size: 28, font: TNR })],
      alignment: AlignmentType.CENTER,
      spacing: { before: 0, after: 240 },
    }))
    docChildren.push(new Paragraph({
      children: [new TextRun({ text: `${typeLabel} DE PROPIETARIOS DEL ${phName}`, bold: true, size: 24, font: TNR })],
      alignment: AlignmentType.CENTER,
      spacing: { after: 160 },
    }))
    docChildren.push(new Paragraph({
      children: [new TextRun({ text: s.date_str, bold: true, size: 24, font: TNR })],
      alignment: AlignmentType.CENTER,
      spacing: { after: 360 },
    }))

    // === INTRO ===
    docChildren.push(normal(
      `En la ciudad de Panamá, siendo las ${s.time_start} del ${s.date_str}, ` +
      `se reunieron previa convocatoria los copropietarios del ${phName}, debidamente inscrito ` +
      `bajo la Finca número ${finca}, Código de ubicación ${codigo}, Sección de ` +
      `Propiedad Horizontal del Registro Público, conforme a la Ley No. 284 de 14 de febrero ` +
      `de 2022 de Propiedad Horizontal, mediante reunión virtual.`
    ))

    if (preflight.convocatoria_text) {
      docChildren.push(normal('A fin de celebrar esta Asamblea se convocó a los propietarios conforme al siguiente aviso:'))
      docChildren.push(normal(preflight.convocatoria_text, { italic: true, indent: true }))
    }
    docChildren.push(emptyLine())

    // === SECTION 1: QUORUM ===
    docChildren.push(sectionTitle(1, 'VERIFICACIÓN DEL QUORUM'))

    const pct = totalUnits > 0 ? ((presentUnits / totalUnits) * 100).toFixed(2) : '0'
    const minQuorum = Math.floor(totalUnits / 2) + 1

    // First call without quorum (if detected)
    if (hasFirstCallNoQuorum) {
      docChildren.push(normal(
        `Siendo las ${s.time_start}, se realizó el primer llamado para dar inicio a la Asamblea, ` +
        `verificándose que no se contaba con el quórum requerido de ${minQuorum} unidades. ` +
        `En consecuencia, conforme al artículo 67 de la Ley 284 de 2022, se procedió a realizar ` +
        `un segundo llamado.`
      ))
    }

    docChildren.push(normal(
      `${hasFirstCallNoQuorum ? 'En el segundo llamado, la' : 'La'} administración procedió a validar el quórum, ` +
      `encontrándose presentes o debidamente representadas ${presentUnits} unidades inmobiliarias ` +
      `de las ${totalUnits} del total del ${phName}, lo que representa el ${pct}% de los propietarios, ` +
      `superando el mínimo requerido de ${minQuorum} unidades. En atención a lo dispuesto en el ` +
      `artículo 67 de la Ley 284 de 2022, se dio inicio a la Asamblea de Propietarios.`
    ))

    if (parsed.attendance.length > 0) {
      docChildren.push(normal(
        `Se encontraban presentes o debidamente representadas ${presentUnits} unidades inmobiliarias, a saber:`
      ))
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const tableRows: any[] = [
        new TableRow({
          children: [
            new TableCell({ children: [new Paragraph({ children: [new TextRun({ text: 'UNIDAD', bold: true, size: 18, font: TNR })] })] }),
            new TableCell({ children: [new Paragraph({ children: [new TextRun({ text: 'PROPIETARIO/A', bold: true, size: 18, font: TNR })] })] }),
            new TableCell({ children: [new Paragraph({ children: [new TextRun({ text: 'REPRESENTADO POR', bold: true, size: 18, font: TNR })] })] }),
          ],
          tableHeader: true,
        }),
        ...parsed.attendance.slice(0, 250).map(rec =>
          new TableRow({
            children: [
              new TableCell({ children: [new Paragraph({ children: [new TextRun({ text: rec.unit, size: 18, font: TNR })] })] }),
              new TableCell({ children: [new Paragraph({ children: [new TextRun({ text: rec.owner_name, size: 18, font: TNR })] })] }),
              new TableCell({ children: [new Paragraph({ children: [new TextRun({ text: rec.represented_by || '', size: 18, font: TNR })] })] }),
            ],
          })
        ),
      ]
      docChildren.push(new Table({
        rows: tableRows,
        width: { size: 9360, type: WidthType.DXA },  // full page width in twips
        columnWidths: [1800, 4500, 3060],  // Unit | Owner | Represented — in twips
      }))
      docChildren.push(emptyLine())
    }

    // === INFORME DE GESTIÓN (if provided) ===
    if (preflight.has_informe_gestion && preflight.informe_gestion_text) {
      const informeSectionNum = 2
      docChildren.push(sectionTitle(informeSectionNum, 'INFORME DE GESTIÓN DE LA JUNTA DIRECTIVA'))
      const paragrphs = preflight.informe_gestion_text.split(/\n+/).filter(p => p.trim().length > 10)
      for (const p of paragrphs) {
        docChildren.push(normal(p, { before: 200 }))
      }
      docChildren.push(emptyLine())
    }

    // === AGENDA SECTIONS ===
    const agendaItems = s.agenda_items.length > 0 ? s.agenda_items : []
    // Offset section numbers if informe was inserted
    const sectionOffset = (preflight.has_informe_gestion && preflight.informe_gestion_text) ? 1 : 0

    // Build vote map by section (semantic matching)
    const votesBySectionMap = new Map<number, VotationRecord[]>()
    for (const vote of parsed.votations) {
      const sectionNum = matchVoteToSection(vote, s.agenda_items)
      if (!votesBySectionMap.has(sectionNum)) votesBySectionMap.set(sectionNum, [])
      votesBySectionMap.get(sectionNum)!.push(vote)
    }

    if (agendaItems.length > 0) {
      for (const item of agendaItems) {
        const displayNum = item.number + sectionOffset
        docChildren.push(sectionTitle(displayNum, item.title.toUpperCase()))

        const sectionBlocks = assignedBlocks.filter(
          b => b.agenda_section === item.number && !b.skip && b.text_formal
        )

        if (sectionBlocks.length === 0 && item === agendaItems[0]) {
          // First section gets all unassigned blocks
          const unassigned = assignedBlocks.filter(b => !b.skip && b.text_formal && !b.agenda_section)
          for (const block of unassigned) {
            if (block.text_formal) docChildren.push(normal(block.text_formal, { before: 200 }))
          }
        } else {
          for (const block of sectionBlocks) {
            if (block.text_formal) docChildren.push(normal(block.text_formal, { before: 200 }))
          }
        }

        // Add votes for this section
        const sectionVotes = votesBySectionMap.get(item.number) || []
        for (const vote of sectionVotes) {
          docChildren.push(normal(
            `Se sometió a votación ${vote.topic}. Los resultados fueron los siguientes:`
          ))
          docChildren.push(normal(`${vote.yes_votes} votos a favor`, { indent: true }))
          docChildren.push(normal(`${vote.no_votes} votos en contra`, { indent: true }))
          if (vote.abstentions) docChildren.push(normal(`${vote.abstentions} abstenciones`, { indent: true }))
          docChildren.push(approval(
            vote.approved
              ? `Se aprobó ${vote.topic} con ${vote.yes_votes} votos que representan el ${vote.pct_yes?.toFixed(2)}%.`
              : `No se aprobó ${vote.topic}. Votos en contra: ${vote.no_votes}.`,
            vote.approved
          ))
        }
        docChildren.push(emptyLine())
      }
    } else {
      // No agenda items — one block with everything
      docChildren.push(sectionTitle(2 + sectionOffset, 'DESARROLLO DE LA ASAMBLEA'))
      for (const block of assignedBlocks.filter(b => !b.skip && b.text_formal)) {
        if (block.text_formal) docChildren.push(normal(block.text_formal, { before: 200 }))
      }
      for (const vote of parsed.votations) {
        docChildren.push(normal(`Se sometió a votación ${vote.topic}. Los resultados fueron:`))
        docChildren.push(normal(`${vote.yes_votes} votos a favor`, { indent: true }))
        docChildren.push(normal(`${vote.no_votes} votos en contra`, { indent: true }))
        if (vote.abstentions) docChildren.push(normal(`${vote.abstentions} abstenciones`, { indent: true }))
        docChildren.push(approval(
          vote.approved ? `Se aprobó con ${vote.yes_votes} votos (${vote.pct_yes?.toFixed(2)}%).` : `No se aprobó.`,
          vote.approved
        ))
      }
    }

    // === CLOSING ===
    docChildren.push(normal(
      `Siendo, el ${s.date_str} a las ${timeEnd}, damos por terminada la sesión de la ` +
      `${typeLabel} de Propietarios.`
    ))
    docChildren.push(emptyLine())
    docChildren.push(normal('Para constancia se firma la presente acta,', { bold: true }))
    docChildren.push(emptyLine())
    docChildren.push(normal(`Junta Directiva, DEL ${phName}`, { bold: true }))
    docChildren.push(emptyLine())
    docChildren.push(emptyLine())

    // Signature block — 2 column table
    const presName = s.president_name?.toUpperCase() || '[NOMBRE PRESIDENTE/A]'
    const secName = s.secretary_name?.toUpperCase() || '[NOMBRE SECRETARIO/A]'
    const LINE = '_'.repeat(48)

    docChildren.push(new Table({
      rows: [
        new TableRow({
          children: [
            new TableCell({
              children: [new Paragraph({ children: [new TextRun({ text: LINE, size: 22, font: TNR })] })],
              borders: { top: { style: 'none' }, bottom: { style: 'none' }, left: { style: 'none' }, right: { style: 'none' } },
            }),
            new TableCell({ children: [new Paragraph({ children: [new TextRun({ text: '' })] })], width: { size: 500, type: WidthType.DXA } }),
            new TableCell({
              children: [new Paragraph({ children: [new TextRun({ text: LINE, size: 22, font: TNR })] })],
              borders: { top: { style: 'none' }, bottom: { style: 'none' }, left: { style: 'none' }, right: { style: 'none' } },
            }),
          ],
        }),
        new TableRow({
          children: [
            new TableCell({
              children: [new Paragraph({ children: [new TextRun({ text: presName, bold: true, size: 22, font: TNR })] })],
              borders: { top: { style: 'none' }, bottom: { style: 'none' }, left: { style: 'none' }, right: { style: 'none' } },
            }),
            new TableCell({ children: [new Paragraph({ children: [new TextRun({ text: '' })] })], width: { size: 500, type: WidthType.DXA } }),
            new TableCell({
              children: [new Paragraph({ children: [new TextRun({ text: secName, bold: true, size: 22, font: TNR })] })],
              borders: { top: { style: 'none' }, bottom: { style: 'none' }, left: { style: 'none' }, right: { style: 'none' } },
            }),
          ],
        }),
        new TableRow({
          children: [
            new TableCell({
              children: [new Paragraph({ children: [new TextRun({ text: 'PRESIDENTE/A', bold: true, size: 22, font: TNR })] })],
              borders: { top: { style: 'none' }, bottom: { style: 'none' }, left: { style: 'none' }, right: { style: 'none' } },
            }),
            new TableCell({ children: [new Paragraph({ children: [new TextRun({ text: '' })] })], width: { size: 500, type: WidthType.DXA } }),
            new TableCell({
              children: [new Paragraph({ children: [new TextRun({ text: 'SECRETARIO/A', bold: true, size: 22, font: TNR })] })],
              borders: { top: { style: 'none' }, bottom: { style: 'none' }, left: { style: 'none' }, right: { style: 'none' } },
            }),
          ],
        }),
      ],
      width: { size: 9360, type: WidthType.DXA },
      columnWidths: [4300, 500, 4560],
    }))

    // === BUILD DOC ===
    const now = new Date()
    const generatedLabel = `Generado por Document Factory · ForumPHs · v1.4 · ${now.toLocaleDateString('es-PA')}`

    const doc = new Document({
      sections: [{
        properties: {
          page: { margin: { top: 1440, right: 1440, bottom: 1800, left: 1440 } },
        },
        footers: {
          default: new Footer({
            children: [
              new Paragraph({
                children: [
                  new TextRun({ text: generatedLabel, size: 16, color: '888888', font: 'Arial' }),
                ],
                alignment: AlignmentType.CENTER,
              }),
            ],
          }),
        },
        children: docChildren,
      }],
    })

    const buffer = await Packer.toBuffer(doc)
    const base64 = buffer.toString('base64')

    // QA v2 with completeness
    const actaText = buildActaText(parsed, preflight, assignedBlocks)
    const qa_report = runQAScan(actaText, parsed, assignedBlocks)

    // Filename: ACTA_OR_1-2026_PH_SLUG_df_v1.docx
    const slug = phName.replace(/[^A-Z0-9]/gi, '_').toUpperCase().replace(/_+/g, '_').replace(/^_|_$/g, '')
    const filename = `ACTA_${typeCode}_${actaNum}-${year}_${slug}_df_v1.docx`

    const wordCount = actaText.split(/\s+/).length

    return NextResponse.json({ success: true, docx_base64: base64, filename, word_count: wordCount, qa_report, acta_text: actaText })
  } catch (err: unknown) {
    console.error('Generate error:', err)
    return NextResponse.json({ success: false, error: err instanceof Error ? err.message : String(err) }, { status: 500 })
  }
}
