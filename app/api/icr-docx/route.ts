/**
 * /api/icr-docx — serializes a structured ICR report to a downloadable .docx.
 * Powers the "Descargar reporte ICR (.docx)" button. Renders faithfully: the
 * findings are laid out exactly as the ICR produced them, never edited.
 */
import { NextRequest, NextResponse } from 'next/server'
import type { ICRReport } from '@/lib/types'

export const runtime = 'nodejs'
export const maxDuration = 60

export async function POST(req: NextRequest): Promise<NextResponse> {
  try {
    const body = await req.json() as {
      report: ICRReport
      ph_name?: string
      acta_number?: string
      assembly_type?: string
      date_str?: string
    }
    const report = body.report
    if (!report || !Array.isArray(report.findings)) {
      return NextResponse.json({ success: false, error: 'report requerido' }, { status: 400 })
    }

    const phName   = body.ph_name || 'PH'
    const actaNum  = body.acta_number || '1'
    const typeCode = body.assembly_type === 'EXTRAORDINARIA' ? 'EX' : 'OR'
    const year     = new Date().getFullYear()
    const dateStr  = body.date_str || ''

    const { buildICRReportDocx, icrReportFilename } = await import('@/lib/generators/icrReportDocx')
    const meta = { phName, actaLabel: `ACTA ${typeCode} ${actaNum}-${year}`, dateStr }
    const buffer = await buildICRReportDocx(report, meta)

    return NextResponse.json({
      success: true,
      docx_base64: buffer.toString('base64'),
      filename: icrReportFilename(meta),
    })
  } catch (err: unknown) {
    console.error('ICR docx error:', err)
    return NextResponse.json(
      { success: false, error: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    )
  }
}
