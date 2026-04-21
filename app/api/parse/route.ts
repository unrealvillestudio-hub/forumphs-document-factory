/**
 * /api/parse/route.ts — v4
 * Accepts pre-extracted text/JSON from the browser (not raw ZIP).
 * Images are passed through to the parsed result.
 *
 * FPH-017: Cross-reference agenda items from ALL documents.
 * Priority: Resumen → Transcripción → Chat
 * If still empty after all sources → ICR warning injected.
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

    const { parseResumen, extractAgendaItems } = await import('@/lib/parsers/parseResumen')
    const { parseAsistencia, parseVotaciones }  = await import('@/lib/parsers/parseAsistencia')
    const { parseTranscripcion }                = await import('@/lib/parsers/parseTranscripcion')
    const { detectPreflightGaps }               = await import('@/lib/processors/preflightDetector')

    const skeleton   = parseResumen(body.resumen || body.transcripcion)
    const attendance = parseAsistencia(body.asistencia_rows || [])
    const votations  = parseVotaciones(body.votaciones_rows || [])
    const debates    = parseTranscripcion(body.transcripcion || '')
    const chatNotes  = (body.chats || '').split('\n').filter(l => l.trim().length > 20)

    // ── FPH-017: Agenda cross-reference ──────────────────────────────────────
    // If the Resumen didn't yield agenda items, try other sources
    if (skeleton.agenda_items.length === 0) {
      // Try transcripción
      if (body.transcripcion) {
        const fromTranscripcion = extractAgendaItems(body.transcripcion)
        if (fromTranscripcion.length > 0) {
          skeleton.agenda_items = fromTranscripcion
          skeleton.raw_text += '\n[agenda extraída de transcripción]'
        }
      }
      // Try chats
      if (skeleton.agenda_items.length === 0 && body.chats) {
        const fromChats = extractAgendaItems(body.chats)
        if (fromChats.length > 0) {
          skeleton.agenda_items = fromChats
          skeleton.raw_text += '\n[agenda extraída de chat]'
        }
      }
    }

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

    // ── FPH-017: ICR warning if agenda still not found after all sources ─────
    // Injected into preflight_gaps as a synthetic warning gap (non-blocking)
    if (skeleton.agenda_items.length === 0) {
      preflight_gaps.push({
        field: '_icr_agenda_warning',
        label: '⚠ ICR — Orden del Día no detectado',
        description:
          'No se encontraron puntos del orden del día en ningún documento del ZIP ' +
          '(Resumen, Transcripción, Chat). El acta se generará sin estructura de secciones. ' +
          'Ingrésalos manualmente en el campo "Orden del Día" del Pre-flight.',
        required: false,
        type: 'text',
        value: '',
      })
    }

    return NextResponse.json({ success: true, parsed, preflight_gaps })
  } catch (err: unknown) {
    console.error('Parse error:', err)
    return NextResponse.json(
      { success: false, error: err instanceof Error ? err.message : 'Unknown parse error' },
      { status: 500 }
    )
  }
}
