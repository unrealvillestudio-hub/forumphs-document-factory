/**
 * lib/zipExtractor.ts
 * Browser-side extraction of Hypal ZIP packages.
 * Runs entirely client-side — ZIP never leaves the user's machine.
 */

export interface ExtractedImage {
  filename: string
  data: string        // base64
  type: 'image/png' | 'image/jpeg'
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
    files_detected: string[]   // filenames found — for debugging
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
    n.includes('grabaci') ||      // Hypal sometimes names it "Grabacion_..."
    n.includes('recording') ||
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
  return (n.includes('chat') || n.includes('mensaje')) && (n.endsWith('.txt') || n.endsWith('.docx'))
}

function isImage(name: string): boolean {
  const n = name.toLowerCase()
  return n.endsWith('.png') || n.endsWith('.jpg') || n.endsWith('.jpeg')
}

// ── DOCX text extraction via mammoth ────────────────────────────────────────

async function extractDocxText(arrayBuffer: ArrayBuffer): Promise<string> {
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const mammoth = await import('mammoth') as any
    const result = await mammoth.extractRawText({ arrayBuffer })
    return (result.value || '').trim()
  } catch {
    // Fallback: raw XML stripping (less accurate but always works)
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

// ── XLSX row extraction ──────────────────────────────────────────────────────

async function extractXlsxRows(arrayBuffer: ArrayBuffer): Promise<Record<string, string>[]> {
  try {
    const XLSX = await import('xlsx')
    const wb = XLSX.read(arrayBuffer, { type: 'array' })
    const ws = wb.Sheets[wb.SheetNames[0]]
    return XLSX.utils.sheet_to_json<Record<string, string>>(ws, { defval: '', raw: false })
  } catch {
    return []
  }
}

// ── Image extraction ──────────────────────────────────────────────────────────

async function extractImageBase64(arrayBuffer: ArrayBuffer, filename: string): Promise<ExtractedImage> {
  const bytes = new Uint8Array(arrayBuffer)
  let binary = ''
  for (let i = 0; i < bytes.byteLength; i++) binary += String.fromCharCode(bytes[i])
  return {
    filename,
    data: btoa(binary),
    type: filename.toLowerCase().endsWith('.png') ? 'image/png' : 'image/jpeg',
  }
}

// ── Progress callback ──────────────────────────────────────────────────────────

export type ProgressCallback = (step: string, pct: number) => void

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

  const files = Object.values(zip.files).filter(f => !f.dir)
  const total = files.length
  const filesLog: string[] = []

  // Log all filenames (flattened — no path prefix)
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

    } else if (isTranscripcion(name)) {
      onProgress?.(`Extrayendo transcripción: ${name}`, pct)
      if (name.endsWith('.vtt') || name.endsWith('.txt')) {
        result.transcripcion = await f.async('string')
      } else {
        const buf = await f.async('arraybuffer')
        result.transcripcion = await extractDocxText(buf)
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
      result.votaciones_rows = await extractXlsxRows(buf)
      result.stats.votaciones_rows_count = result.votaciones_rows.length

    } else if (isChat(name)) {
      onProgress?.(`Extrayendo chat: ${name}`, pct)
      result.chats = name.endsWith('.txt') ? await f.async('string') : await extractDocxText(await f.async('arraybuffer'))
      result.stats.chat_found = result.chats.length > 10

    } else if (isImage(name)) {
      onProgress?.(`Extrayendo imagen: ${name}`, pct)
      result.images.push(await extractImageBase64(await f.async('arraybuffer'), name))
      result.stats.images_count++
    }
  }

  onProgress?.('Extracción completada ✓', 100)
  return result
}
