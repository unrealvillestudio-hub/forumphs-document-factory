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
import type { ParseResponse, ExtractedImage, PreflightGap, SkeletonData } from '@/lib/types'

export const runtime = 'nodejs'
export const maxDuration = 60

// ── Filename ↔ content cross-check (suspicion layer, non-blocking) ───────────
// Sam's idea: use the ZIP filenames as a CONTRAST hint — never a source of truth —
// to raise a flag when an extracted field disagrees with what the filename implies.
// It never overwrites the extracted value; it only warns.

const stripAccents = (s: string): string =>
  s.normalize('NFD').replace(/[̀-ͯ]/g, '')

// Generic words carrying no PH identity — dropped before token comparison.
const GENERIC_FILE_WORDS = new Set([
  'acta', 'actas', 'asamblea', 'asambleas', 'transcripcion', 'transcripciones',
  'transcript', 'resumen', 'votacion', 'votaciones', 'lista', 'listado',
  'convocatoria', 'asistencia', 'participantes', 'chat', 'mensajes', 'mensaje',
  'ordinaria', 'extraordinaria', 'general', 'final', 'borrador', 'copia',
  'ph', 'del', 'los', 'las', 'con', 'para', 'grabacion', 'recording',
])

function fileTokens(name: string): string[] {
  const base = stripAccents(name.toLowerCase()).replace(/\.[a-z0-9]+$/, '') // drop extension
  return base
    .split(/[^a-z0-9]+/)
    .filter(t => t.length >= 3 && !/^\d+$/.test(t) && !GENERIC_FILE_WORDS.has(t))
}

function crossCheckGap(field: string, label: string, description: string): PreflightGap {
  return { field, label, description, required: false, type: 'text', value: '' }
}

function buildCrossCheckGaps(skeleton: SkeletonData, filesDetected: string[]): PreflightGap[] {
  const gaps: PreflightGap[] = []
  if (!filesDetected || filesDetected.length === 0) return gaps

  const joined = filesDetected.map(n => stripAccents(n.toLowerCase())).join(' ')

  // 1 · Assembly type mismatch. Check "extraordinaria" first — it contains the
  //     substring "ordinaria", so strip it before probing for a plain ordinaria.
  const suggestsExtra = joined.includes('extraordinaria')
  const suggestsOrdin = joined.replace(/extraordinaria/g, '').includes('ordinaria')
  if (suggestsExtra && skeleton.assembly_type === 'ORDINARIA') {
    gaps.push(crossCheckGap(
      '_xcheck_assembly_type',
      '⚠ Tipo de asamblea — posible discrepancia',
      "El nombre de archivo sugiere 'EXTRAORDINARIA' pero se detectó 'ORDINARIA'. Confirmá el tipo de asamblea.",
    ))
  } else if (suggestsOrdin && skeleton.assembly_type === 'EXTRAORDINARIA') {
    gaps.push(crossCheckGap(
      '_xcheck_assembly_type',
      '⚠ Tipo de asamblea — posible discrepancia',
      "El nombre de archivo sugiere 'ORDINARIA' pero se detectó 'EXTRAORDINARIA'. Confirmá el tipo de asamblea.",
    ))
  }

  // 2 · PH-name mismatch. If NONE of the significant filename tokens appear in the
  //     extracted ph_name, warn. Skip when the name is still the PENDIENTE sentinel
  //     (already surfaced by its own required gap).
  const phNorm = stripAccents((skeleton.ph_name || '').toLowerCase())
  const tokens = [...new Set(filesDetected.flatMap(fileTokens))]
  const phPending = skeleton.ph_name.includes('PENDIENTE')
  if (!phPending && tokens.length > 0 && !tokens.some(t => phNorm.includes(t))) {
    gaps.push(crossCheckGap(
      '_xcheck_ph_name',
      '⚠ Nombre del PH — posible discrepancia',
      `El nombre del PH detectado ('${skeleton.ph_name}') no coincide con los nombres de archivo ` +
      `(${tokens.join(', ')}). Verificá el nombre del PH.`,
    ))
  }

  return gaps
}

export async function POST(req: NextRequest): Promise<NextResponse<ParseResponse>> {
  try {
    const body = await req.json() as {
      resumen: string
      asistencia_rows: Record<string, string>[]
      votaciones_rows: Record<string, string>[]
      transcripcion: string
      chats: string
      images?: Array<{ filename: string; data: string; type: string }>
      files_detected?: string[]
    }

    const { parseResumen, extractAgendaItems } = await import('@/lib/parsers/parseResumen')
    const { parseAsistencia, parseVotaciones }  = await import('@/lib/parsers/parseAsistencia')
    const { parseTranscripcion }                = await import('@/lib/parsers/parseTranscripcion')
    const { detectPreflightGaps }               = await import('@/lib/processors/preflightDetector')
    const { detectPlatform }                    = await import('@/lib/processors/detectPlatform')

    // PR-B: detect the transcription platform (Hypal/Zoom vs TOC/HIF vs …) from
    // config data, then segment with the matching strategy. Degrades to hypal.
    const platform = await detectPlatform(body.transcripcion || '', body.resumen || '')

    const skeleton   = parseResumen(body.resumen || body.transcripcion)
    const attendance = parseAsistencia(body.asistencia_rows || [])
    const votations  = parseVotaciones(body.votaciones_rows || [])
    const debates    = parseTranscripcion(body.transcripcion || '', platform.config)
    skeleton.platform_id = platform.id
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

    // ── Platform detection (informational / fallback warning, non-blocking) ──
    if (platform.source === 'fallback') {
      preflight_gaps.push({
        field: '_platform_config_warning',
        label: '⚠ Config de plataforma no disponible',
        description:
          'No se pudo leer la configuración de plataformas (df_platform_parsing_config). ' +
          'Se usó la estrategia Hypal por defecto. Si la transcripción es de otra plataforma ' +
          '(p. ej. TOC/HIF) revisá la conexión; la generación continúa normalmente.',
        required: false,
        type: 'text',
        value: '',
      })
    } else {
      preflight_gaps.push({
        field: '_platform_detected',
        label: `Plataforma detectada: ${platform.config.display_name || platform.id}`,
        description: 'Detección automática por señales del texto (informativo, no editable).',
        required: false,
        type: 'text',
        value: '',
      })
    }

    // ── Filename ↔ content cross-check (suspicion flags, non-blocking) ───────
    const xcheckGaps = buildCrossCheckGaps(skeleton, body.files_detected || [])
    preflight_gaps.push(...xcheckGaps)

    // Assembly type was indeterminate in the source — ask the operator to confirm,
    // unless the filename cross-check already raised a type discrepancy above.
    const typeAlreadyFlagged = xcheckGaps.some(g => g.field === '_xcheck_assembly_type')
    if (skeleton.assembly_type_uncertain && !typeAlreadyFlagged) {
      preflight_gaps.push({
        field: '_assembly_type_uncertain',
        label: '⚠ Tipo de asamblea — confirmar',
        description:
          'No se encontró una designación clara ("asamblea ordinaria/extraordinaria") en el ' +
          `texto. Se asumió '${skeleton.assembly_type}' por defecto. Confirmá el tipo de asamblea.`,
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
