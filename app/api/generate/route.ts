/**
 * /api/generate/route.ts — v3
 * Changes vs v2:
 * - sectionTitle(): removed number prefix (Ivette canonical format)
 * - ICR inline annotations support (banners + annex page)
 */
import { NextRequest, NextResponse } from 'next/server'
import type { GenerateResponse, ParsedHypalZip, PreflightData, DebateBlock, VotationRecord } from '@/lib/types'
export const runtime = 'nodejs'
export const maxDuration = 120
// ── ICR types ─────────────────────────────────────────────────────────────────
interface ICRFinding {
  id?: string
  severity: 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW'
  category?: string
  location: string
  section?: string
  issue?: string
  suggestion?: string
}
const SEV_ORDER = ['CRITICAL', 'HIGH', 'MEDIUM', 'LOW'] as const
const ICR_COLORS: Record<string, { bg: string; accent: string; label: string }> = {
  CRITICAL: { bg: 'FFD7D7', accent: 'FF4444', label: '⚠  CRÍTICO' },
  HIGH:     { bg: 'FFDDB3', accent: 'FF8C00', label: '▲  ALTO'    },
  MEDIUM:   { bg: 'FFF5CC', accent: 'FFC107', label: '●  MEDIO'   },
  LOW:      { bg: 'D6EEFF', accent: '4FC3F7', label: '○  BAJO'    },
}
function getWorstSev(findings: ICRFinding[]): string {
  for (const s of SEV_ORDER) { if (findings.some(f => f.severity === s)) return s }
  return 'LOW'
}
function findingsForSection(findings: ICRFinding[], sectionNum: number): ICRFinding[] {
  return findings.filter(f => {
    const ref = (f.location || f.section || '').toLowerCase()
    return ref.includes(`sección ${sectionNum}`) ||
           ref.includes(`seccion ${sectionNum}`) ||
           ref.includes(`section ${sectionNum}`)
  })
}
// ── Vote-to-section matcher ───────────────────────────────────────────────────
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
// ── First-call-without-quorum detector ───────────────────────────────────────
function detectFirstCallNoQuorum(rawTranscription: string): boolean {
  return /primer\s+llamado|no\s+(?:se\s+)?alcanz[oó].*quór?um|segundo\s+llamado|falta.*quór?um/i.test(rawTranscription)
}
export async function POST(req: NextRequest): Promise<NextResponse<GenerateResponse>> {
  try {
    const body = await req.json()
    const { parsed, preflight, formalizedBlocks }: {
      parsed: ParsedHypalZip
      preflight: PreflightData
      formalizedBlocks: DebateBlock[]
    } = body
    const icrFindings: ICRFinding[] = body.icr_findings || []
    const {
      Document, Paragraph, TextRun, Table, TableRow, TableCell,
      AlignmentType, WidthType, BorderStyle, Packer, UnderlineType, Footer,
      ShadingType,
    } = await import('docx')
    const { assignBlocksToSections } = await import('@/lib/processors/sectionAssigner')
    const { buildActaText }          = await import('@/lib/generators/actaBuilder')
    const { runQAScan }              = await import('@/lib/processors/qaScanner')
    const s            = parsed.skeleton
    const phName       = s.ph_name || 'PH'
    const actaNum      = s.acta_number || '1'
    const year         = new Date().getFullYear()
    const typeLabel    = s.assembly_type === 'EXTRAORDINARIA' ? 'ASAMBLEA EXTRAORDINARIA' : 'ASAMBLEA ORDINARIA'
    const typeCode     = s.assembly_type === 'EXTRAORDINARIA' ? 'EX' : 'OR'
    const finca        = preflight.finca || s.ph_finca || '[FINCA PENDIENTE]'
    const codigo       = preflight.codigo || s.ph_codigo || '[CÓDIGO PENDIENTE]'
    const presentUnits = preflight.confirmed_present_units ?? s.present_units ?? parsed.attendance.length
    const totalUnits   = s.total_units || 0
    const timeEnd      = preflight.confirmed_time_end || s.time_end || '[HORA FIN]'
    const assignedBlocks       = assignBlocksToSections(formalizedBlocks, s.agenda_items)
    const hasFirstCallNoQuorum = detectFirstCallNoQuorum(parsed.raw_files['transcripcion'] || '')
    // ── Helpers ──────────────────────────────────────────────────────────────
    const TNR = 'Times New Roman'
    function mdRuns(text: string, size = 22, italic = false) {
      const parts = text.split(/(\*\*[^*]+\*\*)/)
      return parts.map(part => {
        if (part.startsWith('**') && part.endsWith('**')) {
          return new TextRun({ text: part.slice(2, -2), bold: true, size, font: TNR, italics: italic })
        }
        return new TextRun({ text: part, size, font: TNR, italics: italic })
      }).filter(r => (r as any).options?.text !== '')
    }
    const normal = (text: string, opts: { bold?: boolean; italic?: boolean; indent?: boolean; before?: number } = {}) =>
      new Paragraph({
        children: opts.bold ? [new TextRun({ text, bold: true, size: 22, font: TNR })] : mdRuns(text, 22, opts.italic),
        alignment: AlignmentType.JUSTIFIED,
        indent: opts.indent ? { left: 720 } : undefined,
        spacing: { before: opts.before ?? 120, after: 120, line: 276 },
      })
    // ── sectionTitle — NO number prefix (Ivette canonical) ───────────────────
    const sectionTitle = (_num: number | undefined, title: string) =>
      new Paragraph({
        children: [
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
    // ── ICR inline banner ─────────────────────────────────────────────────────
    const icrSectionBanner = (sFindings: ICRFinding[]) => {
      if (sFindings.length === 0) return null
      const worst = getWorstSev(sFindings)
      const col = ICR_COLORS[worst]
      return new Paragraph({
        shading: { type: ShadingType.CLEAR, fill: col.bg, color: col.bg },
        children: [new TextRun({
          text: `${col.label}  ·  ${sFindings.length} hallazgo${sFindings.length > 1 ? 's' : ''} ICR en esta sección  —  ver Anexo ICR al final del documento`,
          size: 18, font: TNR, color: '333333',
        })],
        spacing: { before: 0, after: 160 },
      })
    }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const docChildren: any[] = []
    // ── TITLE ─────────────────────────────────────────────────────────────────
    docChildren.push(new Paragraph({
      children: [new TextRun({ text: `ACTA No_${actaNum}-${year}`, bold: true, underline: { type: UnderlineType.SINGLE }, size: 28, font: TNR })],
      alignment: AlignmentType.CENTER, spacing: { before: 0, after: 240 },
    }))
    docChildren.push(new Paragraph({
      children: [new TextRun({ text: `${typeLabel} DE PROPIETARIOS DEL ${phName}`, bold: true, size: 24, font: TNR })],
      alignment: AlignmentType.CENTER, spacing: { after: 160 },
    }))
    docChildren.push(new Paragraph({
      children: [new TextRun({ text: s.date_str, bold: true, size: 24, font: TNR })],
      alignment: AlignmentType.CENTER, spacing: { after: 360 },
    }))
    // ── INTRO ─────────────────────────────────────────────────────────────────
    if (icrFindings.length > 0) {
      const headerFindings = icrFindings.filter(f => {
        const ref = (f.location || f.section || '').toLowerCase()
        return ref.includes('encabezado') || ref.includes('título') || ref.includes('header')
      })
      const banner = icrSectionBanner(headerFindings)
      if (banner) docChildren.push(banner)
    }
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
    // ── SECTION 1: QUORUM ─────────────────────────────────────────────────────
    docChildren.push(sectionTitle(1, 'VERIFICACIÓN DEL QUORUM'))
    if (icrFindings.length > 0) {
      const banner = icrSectionBanner(findingsForSection(icrFindings, 1))
      if (banner) docChildren.push(banner)
    }
    const pct       = totalUnits > 0 ? ((presentUnits / totalUnits) * 100).toFixed(2) : '0'
    const minQuorum = Math.floor(totalUnits / 2) + 1
    if (hasFirstCallNoQuorum) {
      docChildren.push(normal(
        `Siendo las ${s.time_start}, se realizó el primer llamado para dar inicio a la Asamblea, ` +
        `verificándose que no se contaba con el quórum requerido de ${minQuorum} unidades. ` +
        `En consecuencia, conforme al artículo 67 de la Ley 284 de 2022, se procedió a realizar un segundo llamado.`
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
      docChildren.push(normal(`Se encontraban presentes o debidamente representadas ${presentUnits} unidades inmobiliarias, a saber:`))
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
        width: { size: 9360, type: WidthType.DXA },
        columnWidths: [1800, 4500, 3060],
      }))
      docChildren.push(emptyLine())
    }
    // ── INFORME DE GESTIÓN ────────────────────────────────────────────────────
    if (preflight.has_informe_gestion && preflight.informe_gestion_text) {
      const informeSectionNum = 2
      docChildren.push(sectionTitle(informeSectionNum, 'INFORME DE GESTIÓN DE LA JUNTA DIRECTIVA'))
      if (icrFindings.length > 0) {
        const banner = icrSectionBanner(findingsForSection(icrFindings, informeSectionNum))
        if (banner) docChildren.push(banner)
      }
      const paragrphs = preflight.informe_gestion_text.split(/\n+/).filter(p => p.trim().length > 10)
      for (const p of paragrphs) docChildren.push(normal(p, { before: 200 }))
      docChildren.push(emptyLine())
    }
    // ── AGENDA SECTIONS ───────────────────────────────────────────────────────
    const agendaItems   = s.agenda_items.length > 0 ? s.agenda_items : []
    const sectionOffset = (preflight.has_informe_gestion && preflight.informe_gestion_text) ? 1 : 0
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
        if (icrFindings.length > 0) {
          const banner = icrSectionBanner(findingsForSection(icrFindings, item.number))
          if (banner) docChildren.push(banner)
        }
        const sectionBlocks = assignedBlocks.filter(b => b.agenda_section === item.number && !b.skip && b.text_formal)
        if (sectionBlocks.length === 0 && item === agendaItems[0]) {
          const unassigned = assignedBlocks.filter(b => !b.skip && b.text_formal && !b.agenda_section)
          for (const block of unassigned) {
            if (block.text_formal) docChildren.push(normal(block.text_formal, { before: 200 }))
          }
        } else {
          for (const block of sectionBlocks) {
            if (block.text_formal) docChildren.push(normal(block.text_formal, { before: 200 }))
          }
        }
        const sectionVotes = votesBySectionMap.get(item.number) || []
        for (const vote of sectionVotes) {
          docChildren.push(normal(`Se sometió a votación ${vote.topic}. Los resultados fueron los siguientes:`))
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
      docChildren.push(sectionTitle(2 + sectionOffset, 'DESARROLLO DE LA ASAMBLEA'))
      if (icrFindings.length > 0) {
        const banner = icrSectionBanner(findingsForSection(icrFindings, 2))
        if (banner) docChildren.push(banner)
      }
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
    // ── CLOSING ───────────────────────────────────────────────────────────────
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
    // ── SIGNATURES ───────────────────────────────────────────────────────────
    const presName = s.president_name?.toUpperCase() || '[NOMBRE PRESIDENTE/A]'
    const secName  = s.secretary_name?.toUpperCase()  || '[NOMBRE SECRETARIO/A]'
    const LINE     = '_'.repeat(46)
    const NB       = { style: BorderStyle.NONE, size: 0, color: 'FFFFFF' }
    const NO_BORDERS = { top: NB, bottom: NB, left: NB, right: NB }
    const sigRow = (left: string, right: string, bold = false) => new TableRow({
      children: [
        new TableCell({
          children: [new Paragraph({ children: [new TextRun({ text: left, bold, size: 22, font: TNR })] })],
          borders: NO_BORDERS, width: { size: 4680, type: WidthType.DXA },
        }),
        new TableCell({
          children: [new Paragraph({ children: [new TextRun({ text: right, bold, size: 22, font: TNR })] })],
          borders: NO_BORDERS, width: { size: 4680, type: WidthType.DXA },
        }),
      ],
    })
    docChildren.push(new Table({
      rows: [sigRow(LINE, LINE), sigRow(presName, secName, true), sigRow('PRESIDENTE/A', 'SECRETARIO/A', true)],
      width: { size: 9360, type: WidthType.DXA }, columnWidths: [4680, 4680],
    }))
    // ── ICR ANNEX ─────────────────────────────────────────────────────────────
    if (icrFindings.length > 0) {
      docChildren.push(new Paragraph({
        children: [new TextRun({ text: '', size: 22, font: TNR })],
        pageBreakBefore: true, spacing: { before: 0, after: 0 },
      }))
      docChildren.push(new Paragraph({
        children: [new TextRun({ text: 'ANEXO ICR — REVISIÓN DE CONSISTENCIA LEGAL', bold: true, underline: { type: UnderlineType.SINGLE }, size: 26, font: TNR })],
        alignment: AlignmentType.CENTER, spacing: { before: 0, after: 120 },
      }))
      docChildren.push(new Paragraph({
        children: [new TextRun({
          text: `ForumPHs Document Factory  ·  ${icrFindings.length} hallazgo${icrFindings.length > 1 ? 's' : ''} detectados  ·  Para uso interno — no forma parte del acta oficial`,
          size: 17, font: TNR, color: '888888', italics: true,
        })],
        alignment: AlignmentType.CENTER, spacing: { before: 0, after: 400 },
      }))
      const sortedFindings = [...icrFindings].sort((a, b) => SEV_ORDER.indexOf(a.severity) - SEV_ORDER.indexOf(b.severity))
      for (const finding of sortedFindings) {
        const col = ICR_COLORS[finding.severity] || ICR_COLORS.LOW
        const noBorder = { style: BorderStyle.NONE, size: 0, color: 'auto' }
        docChildren.push(new Table({
          rows: [new TableRow({
            children: [new TableCell({
              shading: { type: ShadingType.CLEAR, fill: col.bg, color: col.bg },
              borders: { left: { style: BorderStyle.THICK, size: 12, color: col.accent }, top: noBorder, bottom: noBorder, right: noBorder },
              children: [
                new Paragraph({
                  children: [
                    new TextRun({ text: col.label + '  ·  ', bold: true, size: 20, font: TNR, color: '111111' }),
                    new TextRun({ text: finding.category || '', bold: true, size: 20, font: TNR, color: '333333' }),
                  ],
                  spacing: { before: 140, after: 60 },
                }),
                new Paragraph({
                  children: [new TextRun({ text: finding.location || finding.section || '', size: 17, font: TNR, color: '666666', italics: true })],
                  spacing: { before: 0, after: 100 },
                }),
                new Paragraph({
                  children: [new TextRun({ text: finding.issue || '', size: 20, font: TNR, color: '111111' })],
                  spacing: { before: 0, after: 100 },
                }),
                new Paragraph({
                  children: [new TextRun({ text: '→  ' + (finding.suggestion || ''), size: 18, font: TNR, color: '444444' })],
                  spacing: { before: 0, after: 140 },
                }),
              ],
            })],
          })],
          width: { size: 9360, type: WidthType.DXA }, columnWidths: [9360],
        }))
        docChildren.push(emptyLine())
      }
    }
    // ── IMAGES APPENDIX — FPH-016 ──────────────────────────────────────────────
    const docImages = parsed.images || []
    if (docImages.length > 0) {
      const { ImageRun } = await import('docx')
      docChildren.push(new Paragraph({
        children: [new TextRun({ text: '', size: 22, font: TNR })],
        pageBreakBefore: true, spacing: { before: 0, after: 0 },
      }))
      docChildren.push(new Paragraph({
        children: [new TextRun({
          text: 'DOCUMENTOS DE RESPALDO — IMÁGENES',
          bold: true, underline: { type: UnderlineType.SINGLE }, size: 26, font: TNR,
        })],
        alignment: AlignmentType.CENTER, spacing: { before: 0, after: 120 },
      }))
      docChildren.push(new Paragraph({
        children: [new TextRun({
          text: `${docImages.length} imagen${docImages.length > 1 ? 'es' : ''} extraída${docImages.length > 1 ? 's' : ''} del paquete Hypal · Para referencia y respaldo`,
          size: 17, font: TNR, color: '888888', italics: true,
        })],
        alignment: AlignmentType.CENTER, spacing: { before: 0, after: 400 },
      }))
      for (const img of docImages) {
        docChildren.push(new Paragraph({
          children: [new TextRun({ text: img.filename, size: 18, font: TNR, color: '666666', italics: true })],
          spacing: { before: 240, after: 80 },
        }))
        try {
          const imgBuffer = Buffer.from(img.data, 'base64')
          docChildren.push(new Paragraph({
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            children: [new (ImageRun as any)({
              data: imgBuffer,
              transformation: { width: 500, height: 360 },
              type: img.type === 'image/png' ? 'png' : 'jpg',  // ← FPH-016 fix
            })],
            spacing: { before: 0, after: 200 },
          }))
        } catch {
          docChildren.push(new Paragraph({
            children: [new TextRun({ text: `[Imagen no disponible: ${img.filename}]`, size: 17, font: TNR, color: '999999' })],
            spacing: { before: 0, after: 200 },
          }))
        }
      }
    }
    // ── BUILD ─────────────────────────────────────────────────────────────────
    const now = new Date()
    const footerLabel = `Generado por Document Factory · ForumPHs · v1.5 · ${now.toLocaleDateString('es-PA')}`
    const doc = new Document({
      sections: [{
        properties: { page: { margin: { top: 1440, right: 1440, bottom: 1800, left: 1440 } } },
        footers: {
          default: new Footer({
            children: [new Paragraph({
              children: [new TextRun({ text: footerLabel, size: 16, color: '888888', font: 'Arial' })],
              alignment: AlignmentType.CENTER,
            })],
          }),
        },
        children: docChildren,
      }],
    })
    const buffer    = await Packer.toBuffer(doc)
    const base64    = buffer.toString('base64')
    const actaText  = buildActaText(parsed, preflight, assignedBlocks)
    const qa_report = runQAScan(actaText, parsed, assignedBlocks)
    const slug      = phName.replace(/[^A-Z0-9]/gi, '_').toUpperCase().replace(/_+/g, '_').replace(/^_|_$/g, '')
    const annotatedSuffix = icrFindings.length > 0 ? '_ICR' : ''
    const filename  = `ACTA_${typeCode}_${actaNum}-${year}_${slug}_df_v1${annotatedSuffix}.docx`
    const wordCount = actaText.split(/\s+/).length
    return NextResponse.json({ success: true, docx_base64: base64, filename, word_count: wordCount, qa_report, acta_text: actaText })
  } catch (err: unknown) {
    console.error('Generate error:', err)
    return NextResponse.json({ success: false, error: err instanceof Error ? err.message : String(err) }, { status: 500 })
  }
}
