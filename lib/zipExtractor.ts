/**
 * lib/zipExtractor.ts
 * Browser-side extraction of Hypal ZIP packages.
 * Runs entirely client-side — ZIP never leaves the user's machine.
 *
 * Extracts:
 *   - Resumen_de_la_Asamblea.docx  → plain text
 *   - Transcripcion_*.docx / *.vtt → plain text
 *   - Asistencia_*.xlsx            → row array
 *   - Votaciones_*.xlsx            → row array
 *   - *chat*.txt                   → plain text
 *   - *.png / *.jpg / *.jpeg       → base64 images
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
  // metadata for UI
  stats: {
    resumen_found: boolean
    transcripcion_found: boolean
    asistencia_rows_count: number
    votaciones_rows_count: number
    images_count: number
    chat_found: boolean
  }
}

// ── File pattern matchers ──────────────────────────────────────────────────

function isResumen(name: string): boolean {
  const n = name.toLowerCase()
  return n.includes('resumen') && n.endsWith('.docx')
}

function isTranscripcion(name: string): boolean {
  const n = name.toLowerCase()
  return (n.includes('transcripci') || n.includes('transcript') || n.endsWith('.vtt')) &&
    !n.includes('resumen')
}

function isAsistencia(name: string): boolean {
  const n = name.toLowerCase()
  return (n.includes('asistencia') || n.includes('attendance') || n.includes('lista')) &&
    (n.endsWith('.xlsx') || n.endsWith('.xls'))
}

function isVotaciones(name: string): boolean {
  const n = name.toLowerCase()
  return (n.includes('votaci') || n.includes('voto') || n.includes('voting') || n.includes('poll')) &&
    (n.endsWith('.xlsx') || n.endsWith('.xls'))
}

function isChat(name: string): boolean {
  const n = name.toLowerCase()
  return (n.includes('chat') || n.includes('mensaje')) &&
    (n.endsWith('.txt') || n.endsWith('.docx'))
}

function isImage(name: string): boolean {
  const n = name.toLowerCase()
  return n.endsWith('.png') || n.endsWith('.jpg') || n.endsWith('.jpeg')
}

// ── DOCX text extraction (via word/document.xml) ──────────────────────────

async function extractDocxText(arrayBuffer: ArrayBuffer): Promise<string> {
  try {
    // Dynamic import to avoid SSR issues
    const JSZip = (await import('jszip')).default
    const zip = await JSZip.loadAsync(arrayBuffer)
    const docXml = zip.file('word/document.xml')
    if (!docXml) return ''
    const xml = await docXml.async('string')
    // Strip XML tags, normalize whitespace, preserve line breaks
    return xml
      .replace(/<w:br[^/]*/g, '\n')
      .replace(/<w:p[ />]/g, '\n')
      .replace(/<\/w:p>/g, '\n')
      .replace(/<[^>]+>/g, '')
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&apos;/g, "'")
      .replace(/&quot;/g, '"')
      .replace(/\n{3,}/g, '\n\n')
      .trim()
  } catch {
    return ''
  }
}

// ── XLSX row extraction ───────────────────────────────────────────────────

async function extractXlsxRows(arrayBuffer: ArrayBuffer): Promise<Record<string, string>[]> {
  try {
    const XLSX = await import('xlsx')
    const wb = XLSX.read(arrayBuffer, { type: 'array' })
    const ws = wb.Sheets[wb.SheetNames[0]]
    // Use header row (first row) as keys
    const rows = XLSX.utils.sheet_to_json<Record<string, string>>(ws, {
      defval: '',
      raw: false,
    })
    return rows
  } catch {
    return []
  }
}

// ── Image extraction ──────────────────────────────────────────────────────

async function extractImageBase64(
  arrayBuffer: ArrayBuffer,
  filename: string
): Promise<ExtractedImage> {
  const bytes = new Uint8Array(arrayBuffer)
  let binary = ''
  for (let i = 0; i < bytes.byteLength; i++) {
    binary += String.fromCharCode(bytes[i])
  }
  const base64 = btoa(binary)
  const type = filename.toLowerCase().endsWith('.png') ? 'image/png' : 'image/jpeg'
  return { filename, data: base64, type }
}

// ── Progress callback ─────────────────────────────────────────────────────

export type ProgressCallback = (step: string, pct: number) => void

// ── Main export ───────────────────────────────────────────────────────────

export async function extractZip(
  file: File,
  onProgress?: ProgressCallback
): Promise<ExtractedData> {
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
    },
  }

  // Classify all files in ZIP
  const files = Object.values(zip.files).filter(f => !f.dir)
  const total = files.length

  for (let i = 0; i < files.length; i++) {
    const f = files[i]
    const name = f.name.split('/').pop() || f.name  // strip folder prefix
    const pct = Math.round(10 + (i / total) * 80)

    if (isResumen(name)) {
      onProgress?.(`Extrayendo resumen…`, pct)
      const buf = await f.async('arraybuffer')
      result.resumen = await extractDocxText(buf)
      result.stats.resumen_found = result.resumen.length > 50

    } else if (isTranscripcion(name)) {
      onProgress?.(`Extrayendo transcripción…`, pct)
      if (name.endsWith('.vtt') || name.endsWith('.txt')) {
        result.transcripcion = await f.async('string')
      } else {
        const buf = await f.async('arraybuffer')
        result.transcripcion = await extractDocxText(buf)
      }
      result.stats.transcripcion_found = result.transcripcion.length > 100

    } else if (isAsistencia(name)) {
      onProgress?.(`Extrayendo lista de asistencia…`, pct)
      const buf = await f.async('arraybuffer')
      result.asistencia_rows = await extractXlsxRows(buf)
      result.stats.asistencia_rows_count = result.asistencia_rows.length

    } else if (isVotaciones(name)) {
      onProgress?.(`Extrayendo votaciones…`, pct)
      const buf = await f.async('arraybuffer')
      result.votaciones_rows = await extractXlsxRows(buf)
      result.stats.votaciones_rows_count = result.votaciones_rows.length

    } else if (isChat(name)) {
      onProgress?.(`Extrayendo chat…`, pct)
      if (name.endsWith('.txt')) {
        result.chats = await f.async('string')
      } else {
        const buf = await f.async('arraybuffer')
        result.chats = await extractDocxText(buf)
      }
      result.stats.chat_found = result.chats.length > 10

    } else if (isImage(name)) {
      onProgress?.(`Extrayendo imagen: ${name}`, pct)
      const buf = await f.async('arraybuffer')
      const img = await extractImageBase64(buf, name)
      result.images.push(img)
      result.stats.images_count++
    }
  }

  onProgress?.('Extracción completada ✓', 100)
  return result
}
