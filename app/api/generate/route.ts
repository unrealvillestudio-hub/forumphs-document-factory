/**
 * /api/generate/route.ts
 * Assembles the final .docx Acta from all processed data.
 * Uses the `docx` npm package for professional Word document output.
 */

import { NextRequest, NextResponse } from 'next/server'
import type { GenerateResponse, ParsedHypalZip, PreflightData, DebateBlock } from '@/lib/types'

export const runtime = 'nodejs'
export const maxDuration = 120

export async function POST(req: NextRequest): Promise<NextResponse<GenerateResponse>> {
  try {
    const {
      parsed,
      preflight,
      formalizedBlocks,
    }: {
      parsed: ParsedHypalZip
      preflight: PreflightData
      formalizedBlocks: DebateBlock[]
    } = await req.json()

    const {
      Document, Paragraph, TextRun, Table, TableRow, TableCell,
      HeadingLevel, AlignmentType, BorderStyle, WidthType,
      Packer, UnderlineType,
    } = await import('docx')

    const { buildActaText, buildAttendanceTable } = await import('@/lib/generators/actaBuilder')
    const { runQAScan } = await import('@/lib/processors/qaScanner')

    const s = parsed.skeleton
    const phName = s.ph_name || 'PH'
    const actaNum = s.acta_number || '1'
    const typeLabel = s.assembly_type === 'EXTRAORDINARIA' ? 'ASAMBLEA EXTRAORDINARIA' : 'ASAMBLEA ORDINARIA'
    const finca = preflight.finca || s.ph_finca || '[FINCA PENDIENTE]'
    const codigo = preflight.codigo || s.ph_codigo || '[CÓDIGO PENDIENTE]'
    const presentUnits = preflight.confirmed_present_units ?? s.present_units ?? parsed.attendance.length
    const totalUnits = s.total_units || 0
    const timeEnd = preflight.confirmed_time_end || s.time_end || '[HORA FIN]'

    // ---- Helper builders ----

    const heading = (text: string) => new Paragraph({
      children: [
        new TextRun({
          text,
          bold: true,
          underline: { type: UnderlineType.SINGLE },
          size: 24,
          font: 'Times New Roman',
        }),
      ],
      spacing: { before: 360, after: 160 },
    })

    const normal = (text: string, opts: { bold?: boolean; italic?: boolean; indent?: boolean; before?: number } = {}) =>
      new Paragraph({
        children: [
          new TextRun({
            text,
            bold: opts.bold,
            italics: opts.italic,
            size: 22,
            font: 'Times New Roman',
          }),
        ],
        alignment: AlignmentType.JUSTIFIED,
        indent: opts.indent ? { left: 720 } : undefined,
        spacing: { before: opts.before ?? 120, after: 120, line: 276 },
      })

    const sectionTitle = (num: number | undefined, title: string) => new Paragraph({
      children: [
        new TextRun({
          text: num ? `${num}.  ` : '',
          bold: true,
          size: 22,
          font: 'Times New Roman',
        }),
        new TextRun({
          text: title,
          bold: true,
          underline: { type: UnderlineType.SINGLE },
          size: 22,
          font: 'Times New Roman',
        }),
      ],
      spacing: { before: 360, after: 160 },
    })

    const approval = (text: string, approved: boolean) => new Paragraph({
      children: [
        new TextRun({
          text: `${approved ? '✅' : '❌'} `,
          size: 22,
          font: 'Times New Roman',
        }),
        new TextRun({
          text,
          bold: true,
          size: 22,
          font: 'Times New Roman',
        }),
      ],
      spacing: { before: 160, after: 160 },
    })

    const emptyLine = () => new Paragraph({ children: [new TextRun({ text: '' })] })

    // ---- Build document sections ----

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const docChildren: any[] = []

    // === TITLE BLOCK ===
    docChildren.push(new Paragraph({
      children: [
        new TextRun({
          text: `ACTA No_${actaNum}-${new Date().getFullYear()}`,
          bold: true,
          underline: { type: UnderlineType.SINGLE },
          size: 28,
          font: 'Times New Roman',
        }),
      ],
      alignment: AlignmentType.CENTER,
      spacing: { before: 0, after: 240 },
    }))

    docChildren.push(new Paragraph({
      children: [
        new TextRun({
          text: `${typeLabel} DE PROPIETARIOS DEL ${phName}`,
          bold: true,
          size: 24,
          font: 'Times New Roman',
        }),
      ],
      alignment: AlignmentType.CENTER,
      spacing: { after: 160 },
    }))

    docChildren.push(new Paragraph({
      children: [
        new TextRun({
          text: s.date_str,
          bold: true,
          size: 24,
          font: 'Times New Roman',
        }),
      ],
      alignment: AlignmentType.CENTER,
      spacing: { after: 360 },
    }))

    // === INTRO PARAGRAPH ===
    docChildren.push(normal(
      `En la ciudad de Panamá, siendo las ${s.time_start} del ${s.date_str}, ` +
      `se reunieron previa convocatoria los copropietarios del ${phName}, que se encuentra ` +
      `debidamente inscrita bajo la Finca número ${finca}, con Código de ubicación número ` +
      `${codigo} de la Sección de Propiedad Horizontal del Registro Público, conforme a lo ` +
      `establecido en la Ley No. 284 de 14 de febrero de 2022 de Propiedad Horizontal, ` +
      `dicha reunión se llevó a cabo de manera virtual.`
    ))

    // Convocatoria
    if (preflight.convocatoria_text) {
      docChildren.push(normal(
        'A fin de celebrar esta Asamblea se comunicó a todos los propietarios mediante convocatoria cuyo texto se transcribe a continuación:'
      ))
      docChildren.push(normal(preflight.convocatoria_text, { italic: true, indent: true }))
    }

    docChildren.push(emptyLine())

    // === SECTION 1: QUORUM ===
    docChildren.push(sectionTitle(1, 'VERIFICACIÓN DEL QUORUM'))

    const pct = totalUnits > 0 ? ((presentUnits / totalUnits) * 100).toFixed(2) : '0'
    const minQuorum = Math.floor(totalUnits / 2) + 1

    docChildren.push(normal(
      `Siendo las ${s.time_start}, la administración procedió a validar el quórum. ` +
      `El ${phName} cuenta con ${totalUnits} unidades inmobiliarias. Para establecer ` +
      `quórum en primer llamado se requiere la presencia de más de la mitad de los propietarios, ` +
      `lo cual equivale a ${minQuorum} unidades. Se verificó la cantidad de unidades presentes, ` +
      `encontrándose presentes o debidamente representadas ${presentUnits} unidades inmobiliarias ` +
      `que representan el ${pct}% del total, por lo que en atención a lo dispuesto en el ` +
      `artículo 67 de la Ley 284 de 2022, se dio inicio a la Asamblea de Propietarios.`
    ))

    // Attendance table
    if (parsed.attendance.length > 0) {
      docChildren.push(normal(
        `Se encontraban presentes o debidamente representadas ${presentUnits} unidades inmobiliarias, a saber:`
      ))

      // Build table
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const tableRows: any[] = [
        new TableRow({
          children: [
            new TableCell({ children: [new Paragraph({ children: [new TextRun({ text: 'UNIDAD', bold: true, size: 18, font: 'Times New Roman' })] })] }),
            new TableCell({ children: [new Paragraph({ children: [new TextRun({ text: 'PROPIETARIO/A', bold: true, size: 18, font: 'Times New Roman' })] })] }),
            new TableCell({ children: [new Paragraph({ children: [new TextRun({ text: 'REPRESENTADO POR', bold: true, size: 18, font: 'Times New Roman' })] })] }),
          ],
          tableHeader: true,
        }),
        ...parsed.attendance.slice(0, 200).map(rec =>
          new TableRow({
            children: [
              new TableCell({ children: [new Paragraph({ children: [new TextRun({ text: rec.unit, size: 18, font: 'Times New Roman' })] })] }),
              new TableCell({ children: [new Paragraph({ children: [new TextRun({ text: rec.owner_name, size: 18, font: 'Times New Roman' })] })] }),
              new TableCell({ children: [new Paragraph({ children: [new TextRun({ text: rec.represented_by || '', size: 18, font: 'Times New Roman' })] })] }),
            ],
          })
        ),
      ]

      docChildren.push(new Table({
        rows: tableRows,
        width: { size: 100, type: WidthType.PERCENTAGE },
      }))
      docChildren.push(emptyLine())
    }

    // === AGENDA SECTIONS ===
    const agendaItems = s.agenda_items.length > 0 ? s.agenda_items : []
    let sectionNum = 2

    for (const item of agendaItems) {
      docChildren.push(sectionTitle(sectionNum, item.title.toUpperCase()))

      // Get formalized blocks for this section
      const sectionBlocks = formalizedBlocks.filter(
        b => b.agenda_section === item.number && !b.skip && b.text_formal
      )

      if (sectionBlocks.length === 0) {
        // Try to include all non-assigned blocks in first section
        if (sectionNum === 2) {
          const unassigned = formalizedBlocks.filter(b => !b.skip && b.text_formal && !b.agenda_section)
          for (const block of unassigned) {
            if (block.text_formal) docChildren.push(normal(block.text_formal, { before: 200 }))
          }
        }
      } else {
        for (const block of sectionBlocks) {
          if (block.text_formal) docChildren.push(normal(block.text_formal, { before: 200 }))
        }
      }

      // Add votation for this section if available
      const vote = parsed.votations[sectionNum - 2]
      if (vote) {
        docChildren.push(normal(`Se sometió a votación ${vote.topic}. Los resultados fueron los siguientes:`))
        docChildren.push(normal(`${vote.yes_votes} votos a favor de ${vote.topic}`, { indent: true }))
        docChildren.push(normal(`${vote.no_votes} votos en contra de ${vote.topic}`, { indent: true }))
        if (vote.abstentions) {
          docChildren.push(normal(`${vote.abstentions} abstenciones`, { indent: true }))
        }
        docChildren.push(approval(
          vote.approved
            ? `Se aprobó ${vote.topic} con ${vote.yes_votes} votos que representan el ${vote.pct_yes?.toFixed(2)}%.`
            : `No se aprobó ${vote.topic}. Los votos en contra (${vote.no_votes}) superaron los votos a favor (${vote.yes_votes}).`,
          vote.approved
        ))
      }

      sectionNum++
    }

    // If no agenda items, add all blocks under one section
    if (agendaItems.length === 0) {
      docChildren.push(sectionTitle(2, 'DESARROLLO DE LA ASAMBLEA'))
      const allBlocks = formalizedBlocks.filter(b => !b.skip && b.text_formal)
      for (const block of allBlocks) {
        if (block.text_formal) docChildren.push(normal(block.text_formal, { before: 200 }))
      }
      // Add all votes
      for (const vote of parsed.votations) {
        docChildren.push(normal(`Se sometió a votación ${vote.topic}. Los resultados fueron los siguientes:`))
        docChildren.push(normal(`${vote.yes_votes} votos a favor`, { indent: true }))
        docChildren.push(normal(`${vote.no_votes} votos en contra`, { indent: true }))
        if (vote.abstentions) docChildren.push(normal(`${vote.abstentions} abstenciones`, { indent: true }))
        docChildren.push(approval(
          vote.approved
            ? `Se aprobó con ${vote.yes_votes} votos (${vote.pct_yes?.toFixed(2)}%).`
            : `No se aprobó. Votos en contra: ${vote.no_votes}.`,
          vote.approved
        ))
      }
    }

    // === CLOSING ===
    docChildren.push(emptyLine())
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

    // Signature line
    docChildren.push(new Paragraph({
      children: [
        new TextRun({ text: '________________________________________________     ________________________________________________', size: 22, font: 'Times New Roman' }),
      ],
    }))
    docChildren.push(emptyLine())

    const presidentName = s.president_name || '[PRESIDENTE/A]'
    const secretaryName = s.secretary_name || '[SECRETARIO/A]'
    docChildren.push(new Paragraph({
      children: [
        new TextRun({ text: `${presidentName.toUpperCase()}`, bold: true, size: 22, font: 'Times New Roman' }),
        new TextRun({ text: '          ', size: 22 }),
        new TextRun({ text: `${secretaryName.toUpperCase()}`, bold: true, size: 22, font: 'Times New Roman' }),
      ],
    }))
    docChildren.push(new Paragraph({
      children: [
        new TextRun({ text: 'PRESIDENTE/A', bold: true, size: 22, font: 'Times New Roman' }),
        new TextRun({ text: '          ', size: 22 }),
        new TextRun({ text: 'SECRETARIO/A', bold: true, size: 22, font: 'Times New Roman' }),
      ],
    }))

    // === BUILD DOC ===
    const doc = new Document({
      sections: [{
        properties: {
          page: {
            margin: { top: 1440, right: 1440, bottom: 1440, left: 1440 },
          },
        },
        children: docChildren,
      }],
    })

    const buffer = await Packer.toBuffer(doc)
    const base64 = buffer.toString('base64')

    // QA scan
    const actaText = buildActaText(parsed, preflight, formalizedBlocks)
    const qa_report = runQAScan(actaText)

    // Generate filename
    const slug = phName.replace(/[^A-Z0-9]/gi, '_').toUpperCase()
    const filename = `ACTA_${actaNum}-${new Date().getFullYear()}_${slug}_df_v1.docx`

    // Word count estimate
    const wordCount = actaText.split(/\s+/).length

    return NextResponse.json({
      success: true,
      docx_base64: base64,
      filename,
      word_count: wordCount,
      qa_report,
    })
  } catch (err: unknown) {
    console.error('Generate error:', err)
    return NextResponse.json({
      success: false,
      error: err instanceof Error ? err.message : 'Unknown generation error',
    }, { status: 500 })
  }
}
