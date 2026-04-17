/**
 * /api/parse/route.ts — v3
 * Accepts pre-extracted text/JSON from the browser (not raw ZIP).
 * Images are passed through to the parsed result.
 */

import { NextRequest, NextResponse } from 'next/server'
import type { ParseResponse, ExtractedImage } from '@/lib/types'

export const runtime = 'nodejs'
export const maxDuration = 60

export async function POST(req: NextRequest): Promise<NextResponse<ParseResponse>> {
  try {
    const body = await req.json() as {
      resumen: string
      asistencia_rows: Record<string, string>[]
      votaciones_rows: Record<string, string>[]
      transcripcion: string
      chats: string
      images?: Array<{ filename: string; data: string; type: string }>
    }

    const { parseResumen }                     = await import('@/lib/parsers/parseResumen')
    const { parseAsistencia, parseVotaciones } = await import('@/lib/parsers/parseAsistencia')
    const { parseTranscripcion }               = await import('@/lib/parsers/parseTranscripcion')
    const { detectPreflightGaps }              = await import('@/lib/processors/preflightDetector')

    const skeleton   = parseResumen(body.resumen || body.transcripcion)
    const attendance = parseAsistencia(body.asistencia_rows || [])
    const votations  = parseVotaciones(body.votaciones_rows || [])
    const debates    = parseTranscripcion(body.transcripcion || '')
    const chatNotes  = (body.chats || '').split('\n').filter(l => l.trim().length > 20)

    // FPH-016: type field arrives as generic string — coerce to union
    const images: ExtractedImage[] = (body.images || []).map(img => ({
      filename: img.filename,
      data:     img.data,
      type:     (img.type === 'image/png' ? 'image/png' : 'image/jpeg') as ExtractedImage['type'],
    }))

    const parsed = {
      skeleton,
      attendance,
      votations,
      debates,
      chat_notes: chatNotes,
      images,
      raw_files: {
        resumen:       body.resumen       || '',
        transcripcion: body.transcripcion || '',
        chats:         body.chats         || '',
      },
    }

    const preflight_gaps = detectPreflightGaps(parsed)

    return NextResponse.json({ success: true, parsed, preflight_gaps })
  } catch (err: unknown) {
    console.error('Parse error:', err)
    return NextResponse.json(
      { success: false, error: err instanceof Error ? err.message : 'Unknown parse error' },
      { status: 500 }
    )
  }
}
