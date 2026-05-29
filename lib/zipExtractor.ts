/**
 * lib/zipExtractor.ts
 * Browser-side extraction of Hypal ZIP packages.
 * Runs entirely client-side — ZIP never leaves the user's machine.
 *
 * Extracts:
 *   - Resumen_de_la_Asamblea.docx  → plain text + embedded images
 *   - Transcripcion_*.docx / *.vtt → plain text + embedded images
 *   - Asistencia_*.xlsx            → row array
 *   - Votaciones_*.xlsx            → row array
 *   - *chat*.txt                   → plain text
 *   - *.png / *.jpg / *.jpeg       → base64 images (standalone)
 *
 * NOTE: DOCX files are themselves ZIPs. Images inside them live at
 * word/media/image1.png, word/media/image2.jpeg, etc.
 * We extract those too so Hypal's quorum charts and voting screenshots
 * appear in the final acta.
 */

export interface ExtractedImage {
  filename: string
  data: string        // base64
  type: 'image/png' | 'image/jpeg'
  source?: string     // which docx it came from, or 'standalone'
}

export interface ExtractedData {
  resumen: string
  transcripcion: string
  asistencia_rows: Record<string, string>[]
  votaciones_rows: Record<string, string>[]
  chats: string
  images: ExtractedImage[]
  stats: {
    resumen_found: boolean
    transcripcion_found: boolean
    asistencia_rows_count: number
    votaciones_rows_count: number
    images_count: number
    chat_found: boolean
    files_detected: string[]
  }
}

// ── File pattern matchers ──────────────────────────────────────────────────

function isResumen(name: string): boolean {
  const n = name.toLowerCase()
  return n.includes('resumen') && (n.endsWith('.docx') || n.endsWith('.doc'))
}

function isTranscripcion(name: string): boolean {
  const n = name.toLowerCase()
  if (n.includes('resumen')) return false
  return (
    n.includes('transcripci') ||
    n.includes('transcript') ||
    n.includes('grabaci') ||
    n.includes('recording') ||
    n.includes('acta') ||
    n.endsWith('.vtt')
  )
}

function isAsistencia(name: string): boolean {
  const n = name.toLowerCase()
  return (
    n.includes('asistencia') ||
    n.includes('attendance') ||
    n.includes('participantes') ||
    n.includes('lista')
  ) && (n.endsWith('.xlsx') || n.endsWith('.xls'))
}

function isVotaciones(name: string): boolean {
  const n = name.toLowerCase()
  return (
    n.includes('votaci') ||
    n.includes('voto') ||
    n.includes('voting') ||
    n.includes('encuesta') ||
    n.includes('poll')
  ) && (n.endsWith('.xlsx') || n.endsWith('.xls'))
}

function isChat(name: string): boolean {
  const n = name.toLowerCase()
  return (n.includes('chat') || n.includes('mensaje')) &&
    (n.endsWith('.txt') || n.endsWith('.docx'))
}

function isStandaloneImage(name: string): boolean {
  const n = name.toLowerCase()
  return n.endsWith('.png') || n.endsWith('.jpg') || n.endsWith('.jpeg')
}

function isDocx(name: string): boolean {
  const n = name.toLowerCase()
  return n.endsWith('.docx') || n.endsWith('.doc')
}

function isSpreadsheet(name: string): boolean {
  const n = name.toLowerCase()
  return n.endsWith('.xlsx') || n.endsWith('.xls')
}

// ── Image type detection ──────────────────────────────────────────────────

function mimeFromName(filename: string): 'image/png' | 'image/jpeg' {
  return filename.toLowerCase().endsWith('.png') ? 'image/png' : 'image/jpeg'
}

// ── ArrayBuffer → base64 ──────────────────────────────────────────────────

function arrayBufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer)
  let binary = ''
  // Process in chunks to avoid call stack overflow on large images
  const chunkSize = 8192
  for (let i = 0; i < bytes.byteLength; i += chunkSize) {
    const chunk = bytes.subarray(i, i + chunkSize)
    binary += String.fromCharCode(...chunk)
  }
  return btoa(binary)
}

// ── DOCX text extraction via mammoth ────────────────────────────────────────

async function extractDocxText(arrayBuffer: ArrayBuffer): Promise<string> {
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const mammoth = await import('mammoth') as any
    const result = await mammoth.extractRawText({ arrayBuffer })
    return (result.value || '').trim()
  } catch {
    // Fallback: raw XML stripping
    try {
      const JSZip = (await import('jszip')).default
      const zip = await JSZip.loadAsync(arrayBuffer)
      const docXml = zip.file('word/document.xml')
      if (!docXml) return ''
      const xml = await docXml.async('string')
      return xml
        .replace(/<w:p[ /\>]/g, '\n')
        .replace(/<\/w:p>/g, '\n')
        .replace(/<w:br[^>]*>/g, '\n')
        .replace(/<[^>]+>/g, '')
        .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
        .replace(/&apos;/g, "'").replace(/&quot;/g, '"')
        .replace(/\n{3,}/g, '\n\n').trim()
    } catch {
      return ''
    }
  }
}

// ── DOCX embedded images extraction ──────────────────────────────────────────
// DOCX files are ZIPs. Images live at word/media/image1.png, etc.
// Hypal embeds quorum charts and voting screenshots here.

async function extractDocxImages(
  arrayBuffer: ArrayBuffer,
  sourceLabel: string
): Promise<ExtractedImage[]> {
  const images: ExtractedImage[] = []
  try {
    const JSZip = (await import('jszip')).default
    const docxZip = await JSZip.loadAsync(arrayBuffer)

    // Find all files under word/media/
    const mediaFiles = Object.values(docxZip.files).filter(f => {
      if (f.dir) return false
      const n = f.name.toLowerCase()
      return n.startsWith('word/media/') && (
        n.endsWith('.png') || n.endsWith('.jpg') || n.endsWith('.jpeg') ||
        n.endsWith('.gif') || n.endsWith('.bmp') || n.endsWith('.tiff')
      )
    })

    for (const mediaFile of mediaFiles) {
      try {
        const imgBuffer = await mediaFile.async('arraybuffer')
        const filename = mediaFile.name.split('/').pop() || mediaFile.name
        // Skip tiny images (icons, bullets, etc.) — less than 5KB
        if (imgBuffer.byteLength < 5120) continue
        images.push({
          filename: `${sourceLabel}_${filename}`,
          data: arrayBufferToBase64(imgBuffer),
          type: mimeFromName(filename),
          source: sourceLabel,
        })
      } catch {
        // skip this image
      }
    }
  } catch {
    // not a valid ZIP/DOCX — skip
  }
  return images
}

// ── XLSX row extraction ──────────────────────────────────────────────────────

async function extractXlsxRows(
  arrayBuffer: ArrayBuffer,
  allSheets = false
): Promise<Record<string, string>[]> {
  try {
    const XLSX = await import('xlsx')
    const wb = XLSX.read(arrayBuffer, { type: 'array' })

    // Default: single sheet (asistencia, legacy single-question votaciones).
    if (!allSheets) {
      const ws = wb.Sheets[wb.SheetNames[0]]
      if (!ws) return []
      return XLSX.utils.sheet_to_json<Record<string, string>>(ws, { defval: '', raw: false })
    }

    // Multi-sheet (Luxor votaciones: one sheet per question). Each sheet's rows
    // are prefixed with a sentinel row carrying the sheet name, so the downstream
    // parser can split a single call into one record per sheet/question.
    const out: Record<string, string>[] = []
    for (const sheetName of wb.SheetNames) {
      const ws = wb.Sheets[sheetName]
      if (!ws) continue
      out.push({ __SHEET_NAME: sheetName, __IS_SHEET_HEADER: 'true' })
      const sheetRows = XLSX.utils.sheet_to_json<Record<string, string>>(ws, { defval: '', raw: false })
      out.push(...sheetRows)
    }
    return out
  } catch {
    return []
  }
}

// ── Progress callback ──────────────────────────────────────────────────────────

export type ProgressCallback = (step: string, pct: number) => void

// ── Fallback matching for ZIPs/loose files of any origin ─────────────────────────
// When filenames don't match the Hypal patterns, assign unmatched .docx/.xlsx by
// size so the acta still gets a transcripción, resumen, asistencia and votaciones.

interface UnmatchedEntry {
  name: string
  buf: ArrayBuffer
}

async function applyFallbacks(
  result: ExtractedData,
  unmatchedDocx: UnmatchedEntry[],
  unmatchedXlsx: UnmatchedEntry[],
  onProgress?: ProgressCallback
): Promise<void> {
  const docx = [...unmatchedDocx].sort((a, b) => b.buf.byteLength - a.buf.byteLength)
  const xlsx = [...unmatchedXlsx].sort((a, b) => b.buf.byteLength - a.buf.byteLength)

  // Transcripción ← largest unmatched .docx
  const transcDoc = docx[0]
  if (!result.transcripcion && transcDoc) {
    onProgress?.(`Asignando transcripción: ${transcDoc.name}`, 92)
    result.transcripcion = await extractDocxText(transcDoc.buf)
    result.images.push(...(await extractDocxImages(transcDoc.buf, 'transcripcion')))
    result.stats.transcripcion_found = result.transcripcion.length > 100
  }

  // Resumen ← second-largest unmatched .docx
  const resumenDoc = docx[1]
  if (!result.resumen && resumenDoc) {
    onProgress?.(`Asignando resumen: ${resumenDoc.name}`, 94)
    result.resumen = await extractDocxText(resumenDoc.buf)
    result.images.push(...(await extractDocxImages(resumenDoc.buf, 'resumen')))
    result.stats.resumen_found = result.resumen.length > 50
  }

  // Asistencia ← first unmatched .xlsx
  const asisXls = xlsx[0]
  if (result.asistencia_rows.length === 0 && asisXls) {
    onProgress?.(`Asignando asistencia: ${asisXls.name}`, 96)
    result.asistencia_rows = await extractXlsxRows(asisXls.buf)
    result.stats.asistencia_rows_count = result.asistencia_rows.length
  }

  // Votaciones ← second unmatched .xlsx
  const votoXls = xlsx[1]
  if (result.votaciones_rows.length === 0 && votoXls) {
    onProgress?.(`Asignando votaciones: ${votoXls.name}`, 98)
    result.votaciones_rows = await extractXlsxRows(votoXls.buf, true)
    result.stats.votaciones_rows_count = result.votaciones_rows.length
  }
}

// ── Main export ────────────────────────────────────────────────────────────────

export async function extractZip(file: File, onProgress?: ProgressCallback): Promise<ExtractedData> {
  const JSZip = (await import('jszip')).default

  onProgress?.('Abriendo ZIP…', 5)
  const arrayBuffer = await file.arrayBuffer()
  const zip = await JSZip.loadAsync(arrayBuffer)

  const result: ExtractedData = {
    resumen: '',
    transcripcion: '',
    asistencia_rows: [],
    votaciones_rows: [],
    chats: '',
    images: [],
    stats: {
      resumen_found: false,
      transcripcion_found: false,
      asistencia_rows_count: 0,
      votaciones_rows_count: 0,
      images_count: 0,
      chat_found: false,
      files_detected: [],
    },
  }

  const unmatchedDocx: UnmatchedEntry[] = []
  const unmatchedXlsx: UnmatchedEntry[] = []

  const files = Object.values(zip.files).filter(f => !f.dir)
  const total = files.length
  const filesLog: string[] = []
  files.forEach(f => filesLog.push(f.name.split('/').pop() || f.name))
  result.stats.files_detected = filesLog

  for (let i = 0; i < files.length; i++) {
    const f = files[i]
    const name = f.name.split('/').pop() || f.name
    const pct = Math.round(10 + (i / total) * 80)

    if (isResumen(name)) {
      onProgress?.(`Extrayendo resumen: ${name}`, pct)
      const buf = await f.async('arraybuffer')
      result.resumen = await extractDocxText(buf)
      result.stats.resumen_found = result.resumen.length > 50
      // Extract embedded images from Resumen DOCX
      onProgress?.(`Extrayendo imágenes del resumen…`, pct)
      const resumenImages = await extractDocxImages(buf, 'resumen')
      result.images.push(...resumenImages)

    } else if (isTranscripcion(name)) {
      onProgress?.(`Extrayendo transcripción: ${name}`, pct)
      if (name.endsWith('.vtt') || name.endsWith('.txt')) {
        result.transcripcion = await f.async('string')
      } else {
        const buf = await f.async('arraybuffer')
        result.transcripcion = await extractDocxText(buf)
        // Extract embedded images from Transcripción DOCX (e.g. quorum report)
        const transcImages = await extractDocxImages(buf, 'transcripcion')
        result.images.push(...transcImages)
      }
      result.stats.transcripcion_found = result.transcripcion.length > 100

    } else if (isAsistencia(name)) {
      onProgress?.(`Extrayendo asistencia: ${name}`, pct)
      const buf = await f.async('arraybuffer')
      result.asistencia_rows = await extractXlsxRows(buf)
      result.stats.asistencia_rows_count = result.asistencia_rows.length

    } else if (isVotaciones(name)) {
      onProgress?.(`Extrayendo votaciones: ${name}`, pct)
      const buf = await f.async('arraybuffer')
      result.votaciones_rows = await extractXlsxRows(buf, true)
      result.stats.votaciones_rows_count = result.votaciones_rows.length

    } else if (isChat(name)) {
      onProgress?.(`Extrayendo chat: ${name}`, pct)
      if (name.endsWith('.txt')) {
        result.chats = await f.async('string')
      } else {
        const buf = await f.async('arraybuffer')
        result.chats = await extractDocxText(buf)
      }
      result.stats.chat_found = result.chats.length > 10

    } else if (isStandaloneImage(name)) {
      // Standalone images at the ZIP root level
      onProgress?.(`Extrayendo imagen standalone: ${name}`, pct)
      const buf = await f.async('arraybuffer')
      result.images.push({
        filename: name,
        data: arrayBufferToBase64(buf),
        type: mimeFromName(name),
        source: 'standalone',
      })

    } else if (isDocx(name)) {
      onProgress?.(`Leyendo archivo: ${name}`, pct)
      const buf = await f.async('arraybuffer')
      unmatchedDocx.push({ name, buf })

    } else if (isSpreadsheet(name)) {
      onProgress?.(`Leyendo archivo: ${name}`, pct)
      const buf = await f.async('arraybuffer')
      unmatchedXlsx.push({ name, buf })
    }
  }

  // Smart fallback for ZIPs whose filenames don't match the Hypal patterns
  await applyFallbacks(result, unmatchedDocx, unmatchedXlsx, onProgress)

  // Deduplicate images by filename+size (same image embedded in multiple docs)
  const seen = new Set<string>()
  result.images = result.images.filter(img => {
    const key = `${img.filename}_${img.data.length}`
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })

  result.stats.images_count = result.images.length
  onProgress?.(`Extracción completada ✓ (${result.images.length} imágenes)`, 100)
  return result
}

// ── Loose files export ───────────────────────────────────────────────────────
// Same logic as extractZip but for individual File objects (no JSZip wrapper),
// e.g. files attached to a Gmail thread and dragged in directly.

export async function extractLooseFiles(files: File[], onProgress?: ProgressCallback): Promise<ExtractedData> {
  onProgress?.('Leyendo archivos…', 5)

  const result: ExtractedData = {
    resumen: '',
    transcripcion: '',
    asistencia_rows: [],
    votaciones_rows: [],
    chats: '',
    images: [],
    stats: {
      resumen_found: false,
      transcripcion_found: false,
      asistencia_rows_count: 0,
      votaciones_rows_count: 0,
      images_count: 0,
      chat_found: false,
      files_detected: [],
    },
  }

  const unmatchedDocx: UnmatchedEntry[] = []
  const unmatchedXlsx: UnmatchedEntry[] = []

  const total = files.length
  result.stats.files_detected = files.map(f => f.name)

  for (let i = 0; i < files.length; i++) {
    const f = files[i]
    const name = f.name
    const lower = name.toLowerCase()
    const pct = Math.round(10 + (i / total) * 80)

    if (isResumen(name)) {
      onProgress?.(`Extrayendo resumen: ${name}`, pct)
      const buf = await f.arrayBuffer()
      result.resumen = await extractDocxText(buf)
      result.stats.resumen_found = result.resumen.length > 50
      onProgress?.(`Extrayendo imágenes del resumen…`, pct)
      result.images.push(...(await extractDocxImages(buf, 'resumen')))

    } else if (isTranscripcion(name)) {
      onProgress?.(`Extrayendo transcripción: ${name}`, pct)
      if (lower.endsWith('.vtt') || lower.endsWith('.txt')) {
        result.transcripcion = await f.text()
      } else {
        const buf = await f.arrayBuffer()
        result.transcripcion = await extractDocxText(buf)
        result.images.push(...(await extractDocxImages(buf, 'transcripcion')))
      }
      result.stats.transcripcion_found = result.transcripcion.length > 100

    } else if (isAsistencia(name)) {
      onProgress?.(`Extrayendo asistencia: ${name}`, pct)
      const buf = await f.arrayBuffer()
      result.asistencia_rows = await extractXlsxRows(buf)
      result.stats.asistencia_rows_count = result.asistencia_rows.length

    } else if (isVotaciones(name)) {
      onProgress?.(`Extrayendo votaciones: ${name}`, pct)
      const buf = await f.arrayBuffer()
      result.votaciones_rows = await extractXlsxRows(buf, true)
      result.stats.votaciones_rows_count = result.votaciones_rows.length

    } else if (isChat(name)) {
      onProgress?.(`Extrayendo chat: ${name}`, pct)
      if (lower.endsWith('.txt')) {
        result.chats = await f.text()
      } else {
        const buf = await f.arrayBuffer()
        result.chats = await extractDocxText(buf)
      }
      result.stats.chat_found = result.chats.length > 10

    } else if (isStandaloneImage(name)) {
      onProgress?.(`Extrayendo imagen: ${name}`, pct)
      const buf = await f.arrayBuffer()
      result.images.push({
        filename: name,
        data: arrayBufferToBase64(buf),
        type: mimeFromName(name),
        source: 'standalone',
      })

    } else if (isDocx(name)) {
      onProgress?.(`Leyendo archivo: ${name}`, pct)
      const buf = await f.arrayBuffer()
      unmatchedDocx.push({ name, buf })

    } else if (isSpreadsheet(name)) {
      onProgress?.(`Leyendo archivo: ${name}`, pct)
      const buf = await f.arrayBuffer()
      unmatchedXlsx.push({ name, buf })
    }
  }

  // Smart fallback for loose files whose names don't match the Hypal patterns
  await applyFallbacks(result, unmatchedDocx, unmatchedXlsx, onProgress)

  // Deduplicate images by filename+size (same image embedded in multiple docs)
  const seen = new Set<string>()
  result.images = result.images.filter(img => {
    const key = `${img.filename}_${img.data.length}`
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })

  result.stats.images_count = result.images.length
  onProgress?.(`Extracción completada ✓ (${result.images.length} imágenes)`, 100)
  return result
}
