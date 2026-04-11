/**
 * /api/parse/route.ts
 * Receives the Hypal ZIP, extracts all 6 files, parses each one,
 * returns ParsedHypalZip + PreflightGap[]
 */

import { NextRequest, NextResponse } from 'next/server'
import type { ParseResponse } from '@/lib/types'

export const runtime = 'nodejs'
export const maxDuration = 60

export async function POST(req: NextRequest): Promise<NextResponse<ParseResponse>> {
  try {
    const formData = await req.formData()
    const file = formData.get('zip') as File | null

    if (!file) {
      return NextResponse.json({ success: false, error: 'No ZIP file provided' }, { status: 400 })
    }

    // Dynamic imports for server-only packages
    const JSZip = (await import('jszip')).default
    const mammoth = await import('mammoth')
    const XLSX = await import('xlsx')
    const { parseResumen } = await import('@/lib/parsers/parseResumen')
    const { parseAsistencia, parseVotaciones } = await import('@/lib/parsers/parseAsistencia')
    const { parseTranscripcion } = await import('@/lib/parsers/parseTranscripcion')
    const { detectPreflightGaps } = await import('@/lib/processors/preflightDetector')

    const arrayBuffer = await file.arrayBuffer()
    const zip = await JSZip.loadAsync(arrayBuffer)

    const rawFiles: Record<string, string> = {}
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const fileMap: Record<string, any> = {}

    // Map files by normalized name
    zip.forEach((relativePath, zipEntry) => {
      const name = relativePath.toLowerCase().replace(/[^a-z0-9_.]/g, '_')
      fileMap[name] = zipEntry
      // Also map by original
      const orig = relativePath.split('/').pop() || relativePath
      fileMap[orig.toLowerCase()] = zipEntry
    })

    // Helper: extract docx text
    const extractDocxText = async (entry: { async(type: 'arraybuffer'): Promise<ArrayBuffer> }): Promise<string> => {
      const buf = await entry.async('arraybuffer')
      const result = await mammoth.extractRawText({ arrayBuffer: buf })
      return result.value
    }

    // Helper: extract xlsx rows
    const extractXlsxRows = async (entry: { async(type: 'arraybuffer'): Promise<ArrayBuffer> }): Promise<Record<string, string>[]> => {
      const buf = await entry.async('arraybuffer')
      const workbook = XLSX.read(buf, { type: 'array' })
      const sheetName = workbook.SheetNames[0]
      const worksheet = workbook.Sheets[sheetName]
      return XLSX.utils.sheet_to_json(worksheet, { defval: '' }) as Record<string, string>[]
    }

    // Find files by partial name match
    const findFile = (keywords: string[]): { async(type: 'arraybuffer'): Promise<ArrayBuffer> } | undefined => {
      for (const [name, entry] of Object.entries(fileMap)) {
        if (keywords.some(kw => name.includes(kw))) return entry as { async(type: 'arraybuffer'): Promise<ArrayBuffer> }
      }
      return undefined
    }

    // 1. Resumen
    const resumenEntry = findFile(['resumen', 'summary'])
    let skeletonText = ''
    if (resumenEntry) {
      skeletonText = await extractDocxText(resumenEntry)
      rawFiles['resumen'] = skeletonText
    }

    // 2. Asistencia
    const asistenciaEntry = findFile(['asistencia', 'attendance', 'lista'])
    let attendanceRows: Record<string, string>[] = []
    if (asistenciaEntry) {
      attendanceRows = await extractXlsxRows(asistenciaEntry)
    }

    // 3. Votaciones
    const votacionesEntry = findFile(['votacion', 'votaciones', 'voting', 'resultado'])
    let votacionRows: Record<string, string>[] = []
    if (votacionesEntry) {
      votacionRows = await extractXlsxRows(votacionesEntry)
    }

    // 4. Transcripcion
    const transcripcionEntry = findFile(['transcripcion', 'transcripción', 'transcript'])
    let transcripcionText = ''
    if (transcripcionEntry) {
      transcripcionText = await extractDocxText(transcripcionEntry)
      rawFiles['transcripcion'] = transcripcionText
    }

    // 5. Chats
    const chatsEntry = findFile(['chat', 'chats'])
    let chatText = ''
    if (chatsEntry) {
      chatText = await extractDocxText(chatsEntry)
      rawFiles['chats'] = chatText
    }

    // Parse
    const skeleton = parseResumen(skeletonText || transcripcionText)
    const attendance = parseAsistencia(attendanceRows)
    const votations = parseVotaciones(votacionRows)
    const debates = parseTranscripcion(transcripcionText)
    const chatNotes = chatText.split('\n').filter(l => l.trim().length > 20)

    const parsed = {
      skeleton,
      attendance,
      votations,
      debates,
      chat_notes: chatNotes,
      raw_files: rawFiles,
    }

    const preflight_gaps = detectPreflightGaps(parsed)

    return NextResponse.json({
      success: true,
      parsed,
      preflight_gaps,
    })
  } catch (err: unknown) {
    console.error('Parse error:', err)
    return NextResponse.json({
      success: false,
      error: err instanceof Error ? err.message : 'Unknown parse error',
    }, { status: 500 })
  }
}
