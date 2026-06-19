/**
 * icrReportDocx.ts — serializes a structured ICR report to a standalone .docx
 * for Ivette. Faithful render only: it never edits, corrects, or invents a
 * finding — it lays out exactly what the ICR produced, so the marks (cifras a
 * verificar, [ROL NO VERIFICADO], etc.) reach her review unchanged.
 *
 * Reused by /api/icr-docx (the "Descargar reporte ICR (.docx)" button) and by
 * one-off report generation. Same color scheme as the ICR screen, mapped to the
 * print palette below.
 */

import type { ICRReport, ICRFinding } from '../types'

// Print palette (w:shd fills) per severity.
const LEVEL: Record<ICRFinding['severity'], { fill: string; label: string }> = {
  CRITICAL: { fill: 'C00000', label: 'CRÍTICO' },
  HIGH:     { fill: 'E36C09', label: 'ALTO'    },
  MEDIUM:   { fill: 'BF9000', label: 'MEDIO'   },
  LOW:      { fill: '808080', label: 'BAJO'    },
}

const CATEGORY_LABEL: Record<ICRFinding['category'], string> = {
  VOTE_INCONSISTENCY: 'Votos inconsistentes',
  ROLE_ERROR:         'Rol no verificado',
  LEGAL_COMPLIANCE:   'Cumplimiento legal',
  DATA_MISMATCH:      'Datos a verificar',
  NARRATIVE_QUALITY:  'Calidad narrativa',
  STRUCTURAL:         'Estructura',
}

const VERDICT_LABEL: Record<ICRReport['verdict'], string> = {
  APPROVED:             'APROBADO — Listo para firma',
  APPROVED_WITH_NOTES:  'APROBADO CON NOTAS — Revisar observaciones',
  REQUIRES_CORRECTION:  'REQUIERE CORRECCIÓN — Resolver antes de firmar',
  BLOCKED:              'BLOQUEADO — El acta no puede firmarse en este estado',
}

const SEV_ORDER: ICRFinding['severity'][] = ['CRITICAL', 'HIGH', 'MEDIUM', 'LOW']

export interface ICRReportMeta {
  phName: string
  actaLabel: string   // e.g. "ACTA OR 1-2026"
  dateStr: string
}

/** Build the ICR report .docx and return it as a Buffer. */
export async function buildICRReportDocx(report: ICRReport, meta: ICRReportMeta): Promise<Buffer> {
  const {
    Document, Paragraph, TextRun, Table, TableRow, TableCell,
    AlignmentType, WidthType, BorderStyle, ShadingType, Packer, UnderlineType, Footer,
  } = await import('docx')

  const TNR = 'Times New Roman'
  const NB = { style: BorderStyle.NONE, size: 0, color: 'FFFFFF' }
  const NO_BORDERS = { top: NB, bottom: NB, left: NB, right: NB }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const children: any[] = []

  // ── Title ──────────────────────────────────────────────────────────────────
  children.push(new Paragraph({
    children: [new TextRun({ text: 'REPORTE ICR — Industrial Consistency Review', bold: true, underline: { type: UnderlineType.SINGLE }, size: 28, font: TNR })],
    alignment: AlignmentType.CENTER, spacing: { after: 120 },
  }))
  children.push(new Paragraph({
    children: [new TextRun({
      text: `${meta.phName}  ·  ${meta.actaLabel}  ·  Estado: ${VERDICT_LABEL[report.verdict]}  ·  ${meta.dateStr}`,
      size: 19, font: TNR, color: '555555',
    })],
    alignment: AlignmentType.CENTER, spacing: { after: 280 },
  }))

  // ── Note to Ivette ───────────────────────────────────────────────────────────
  children.push(new Paragraph({
    children: [new TextRun({
      text: 'Este reporte mapea lo que la revisión ICR detectó en el acta. El sistema NO corrige cifras ' +
        'ni identidades por sí mismo: las marca aquí para su revisión y decisión. Cada hallazgo indica ' +
        'su ubicación, el problema detectado y una recomendación.',
      size: 22, font: TNR, italics: true,
    })],
    alignment: AlignmentType.JUSTIFIED, spacing: { after: 240, line: 276 },
  }))

  // ── Summary count table ──────────────────────────────────────────────────────
  const sevCounts: { sev: ICRFinding['severity']; count: number }[] = [
    { sev: 'CRITICAL', count: report.critical },
    { sev: 'HIGH', count: report.high },
    { sev: 'MEDIUM', count: report.medium },
    { sev: 'LOW', count: report.low },
  ]
  children.push(new Table({
    width: { size: 9360, type: WidthType.DXA },
    columnWidths: [2340, 2340, 2340, 2340],
    rows: [
      new TableRow({
        children: sevCounts.map(({ sev }) => new TableCell({
          shading: { type: ShadingType.CLEAR, fill: LEVEL[sev].fill, color: LEVEL[sev].fill },
          children: [new Paragraph({
            alignment: AlignmentType.CENTER,
            children: [new TextRun({ text: LEVEL[sev].label, bold: true, size: 18, font: TNR, color: 'FFFFFF' })],
          })],
        })),
      }),
      new TableRow({
        children: sevCounts.map(({ count }) => new TableCell({
          children: [new Paragraph({
            alignment: AlignmentType.CENTER,
            children: [new TextRun({ text: String(count), bold: true, size: 28, font: TNR })],
          })],
        })),
      }),
    ],
  }))
  children.push(new Paragraph({ children: [new TextRun({ text: '', size: 12 })], spacing: { after: 120 } }))

  // ── Auditor summary ──────────────────────────────────────────────────────────
  if (report.auditor_summary) {
    children.push(new Paragraph({
      children: [
        new TextRun({ text: 'Resumen del auditor: ', bold: true, size: 21, font: TNR }),
        new TextRun({ text: report.auditor_summary, size: 21, font: TNR }),
      ],
      alignment: AlignmentType.JUSTIFIED, spacing: { after: 240, line: 276 },
    }))
  }

  // ── Findings, ordered by severity ────────────────────────────────────────────
  const sorted = [...report.findings].sort(
    (a, b) => SEV_ORDER.indexOf(a.severity) - SEV_ORDER.indexOf(b.severity),
  )

  if (sorted.length === 0) {
    children.push(new Paragraph({
      children: [new TextRun({ text: '✓ Sin hallazgos — el acta cumple todos los criterios de consistencia legal.', size: 22, font: TNR })],
      spacing: { before: 120 },
    }))
  }

  for (const f of sorted) {
    const lvl = LEVEL[f.severity]
    children.push(new Table({
      width: { size: 9360, type: WidthType.DXA },
      columnWidths: [9360],
      rows: [
        // Header strip — shaded with the level color, white text.
        new TableRow({
          children: [new TableCell({
            shading: { type: ShadingType.CLEAR, fill: lvl.fill, color: lvl.fill },
            borders: NO_BORDERS,
            children: [new Paragraph({
              spacing: { before: 40, after: 40 },
              children: [
                new TextRun({ text: `${lvl.label}  ·  ${CATEGORY_LABEL[f.category]}`, bold: true, size: 20, font: TNR, color: 'FFFFFF' }),
                ...(f.location ? [new TextRun({ text: `   —   ${f.location}`, size: 18, font: TNR, color: 'FFFFFF' })] : []),
              ],
            })],
          })],
        }),
        // Body — issue + recommendation.
        new TableRow({
          children: [new TableCell({
            borders: {
              top: NB, bottom: { style: BorderStyle.SINGLE, size: 4, color: lvl.fill },
              left: { style: BorderStyle.SINGLE, size: 18, color: lvl.fill }, right: NB,
            },
            children: [
              new Paragraph({
                spacing: { before: 100, after: 60, line: 276 }, alignment: AlignmentType.JUSTIFIED,
                children: [
                  new TextRun({ text: 'Hallazgo: ', bold: true, size: 21, font: TNR }),
                  new TextRun({ text: f.issue || '', size: 21, font: TNR }),
                ],
              }),
              new Paragraph({
                spacing: { before: 0, after: 120, line: 276 }, alignment: AlignmentType.JUSTIFIED,
                children: [
                  new TextRun({ text: 'Recomendación: ', bold: true, size: 20, font: TNR }),
                  new TextRun({ text: f.suggestion || '', size: 20, font: TNR, italics: true }),
                ],
              }),
            ],
          })],
        }),
      ],
    }))
    children.push(new Paragraph({ children: [new TextRun({ text: '', size: 10 })], spacing: { after: 100 } }))
  }

  const doc = new Document({
    sections: [{
      properties: { page: { margin: { top: 1440, right: 1440, bottom: 1440, left: 1440 } } },
      footers: {
        default: new Footer({
          children: [new Paragraph({
            alignment: AlignmentType.CENTER,
            children: [new TextRun({ text: 'Document Factory · ForumPHs · Reporte ICR para uso interno — no forma parte del acta oficial', size: 16, color: '888888', font: 'Arial' })],
          })],
        }),
      },
      children,
    }],
  })

  return Packer.toBuffer(doc)
}

/** Build a safe download filename, e.g. REPORTE_ICR_ACTA_OR_1-2026_PH_VENEZIA_TOWER_E.docx */
export function icrReportFilename(meta: ICRReportMeta): string {
  const slug = `${meta.actaLabel} ${meta.phName}`
    .toUpperCase().replace(/[^A-Z0-9-]+/g, '_').replace(/^_|_$/g, '')
  return `REPORTE_ICR_${slug}.docx`
}
