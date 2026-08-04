/**
 * imageCuration.ts — Mano B del Agente Experto: curaduría visual de imágenes.
 *
 * Hoy /api/generate vuelca parsed.images COMPLETO al anexo (incluye screenshots
 * de Zoom, avatares, logo Hypal). El filtro por nombre de archivo es frágil.
 * Esta capa usa visión para decidir QUÉ imagen pertenece al acta, en qué orden,
 * y con qué pie de imagen legal.
 *
 * Regla del sprint: la decisión visual es CRITERIO → agente. El recorte/inserción
 * en el DOCX sigue siendo código (en /api/generate).
 *
 * No-fatal: si la visión falla, el caller cae al comportamiento actual (incluir
 * con filtro por nombre) en vez de romper la generación.
 */

import Anthropic from '@anthropic-ai/sdk'
import type { ExtractedImage } from '@/lib/types'
import { logLedger } from '@/lib/server/ledger'

export interface ImageDecision {
  index: number                          // index into the original images array
  decision: 'INCLUDE' | 'EXCLUDE' | 'MAYBE'
  order: number                          // display order among INCLUDE/MAYBE
  caption_legal: string                  // formal caption for the acta
  reason: string                         // why this decision (for ICR/debug)
}

export interface CurationResult {
  decisions: ImageDecision[]
  included: ImageDecision[]              // INCLUDE + MAYBE, sorted by order
  excluded_count: number
  curated: boolean                       // false = vision failed, caller falls back
}

const CURATION_SYSTEM = `Eres el curador visual del Agente Experto ForumPHs. Recibes las imágenes extraídas de un paquete de Asamblea de Propiedad Horizontal y decides cuáles pertenecen al acta legal.

CRITERIO:
- INCLUDE: gráficos de resultados de votación, tablas de resultados, encuestas con conteos, documentos de respaldo legalmente relevantes (p.ej. la convocatoria publicada).
- EXCLUDE: capturas de pantalla de Zoom/galería de participantes, avatares, fotos de caras, logos de la plataforma (Hypal), pantallas de "compartir", barras de herramientas, imágenes decorativas o irrelevantes.
- MAYBE: documentos de respaldo ambiguos; inclúyelos solo si aportan valor legal (aviso del ascensor, carta). Ante la duda entre EXCLUDE y MAYBE, prefiere EXCLUDE para imágenes que sean claramente capturas de la reunión.

Para cada imagen incluida, redacta un caption_legal formal en español (p.ej. "Resultado de la votación sobre la aprobación del presupuesto 2025", "Aviso de convocatoria publicado"). Asigna 'order' secuencial empezando en 1 solo a las INCLUDE/MAYBE.

RESPONDE ÚNICAMENTE con JSON válido, sin markdown.`

/**
 * Curate a set of extracted images using vision.
 * `context` is a short description of the assembly (votes, agenda) to help the
 * model write accurate captions.
 */
export async function curateImages(
  images: ExtractedImage[],
  context: string,
  jobId?: string | null,
): Promise<CurationResult> {
  const empty: CurationResult = { decisions: [], included: [], excluded_count: 0, curated: false }
  if (!images || images.length === 0) return { ...empty, curated: true }

  const apiKey = process.env.forumphs_document_factory || process.env.ANTHROPIC_API_KEY
  if (!apiKey) return empty  // no key → caller falls back

  const startedAt = Date.now()
  // usage se hoista para poder registrar el consumo (status='error') si la visión
  // respondió pero algo posterior falló (§6.4).
  let usage: { input_tokens: number; output_tokens: number } | null = null
  try {
    const client = new Anthropic({ apiKey })

    // Build a multimodal message: each image followed by its index label.
    // Cap at 40 images to bound cost/latency; beyond that, the tail is excluded
    // by default (rare — and the caller still renders nothing worse than today).
    const MAX_IMAGES = 40
    const slice = images.slice(0, MAX_IMAGES)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const content: any[] = [{
      type: 'text',
      text: `Contexto de la asamblea:\n${context}\n\nA continuación ${slice.length} imágenes numeradas desde 0. Clasifícalas.`,
    }]
    slice.forEach((img, i) => {
      content.push({
        type: 'image',
        source: { type: 'base64', media_type: img.type, data: img.data },
      })
      content.push({ type: 'text', text: `^ imagen índice ${i} (archivo: ${img.filename})` })
    })
    content.push({
      type: 'text',
      text: `Responde SOLO con este JSON:
{"decisions":[{"index":0,"decision":"INCLUDE|EXCLUDE|MAYBE","order":1,"caption_legal":"...","reason":"..."}]}`,
    })

    const msg = await client.messages.create({
      model: 'claude-sonnet-5',
      max_tokens: 2700, // PR-C §5 — +35% headroom for Sonnet 5's tokenizer
      // PR-C §5 — disable Sonnet 5's default adaptive thinking (deterministic
      // INCLUDE/EXCLUDE classification). Passthrough because the pinned SDK
      // (0.24.x) predates the `thinking` param; it's serialized into the body.
      ...({ thinking: { type: 'disabled' } } as object),
      system: CURATION_SYSTEM,
      messages: [{ role: 'user', content }],
    })

    usage = msg.usage ? { input_tokens: msg.usage.input_tokens, output_tokens: msg.usage.output_tokens } : null

    const raw = msg.content.filter((c): c is Anthropic.TextBlock => c.type === 'text').map(c => c.text).join('').trim()
    const clean = raw.replace(/```json\n?|\n?```/g, '').trim()
    const parsed = JSON.parse(clean) as { decisions: ImageDecision[] }
    const decisions = (parsed.decisions || []).filter(d => typeof d.index === 'number')

    const included = decisions
      .filter(d => d.decision === 'INCLUDE' || d.decision === 'MAYBE')
      .sort((a, b) => (a.order ?? 999) - (b.order ?? 999))
    const excluded_count = decisions.filter(d => d.decision === 'EXCLUDE').length

    // §6.2/§6.3 — asiento con el consumo real de la visión, agrupado por acta (job_id).
    await logLedger({
      lab: 'document-factory',
      sourceApp: 'fphs-image-curation',
      modelId: 'claude-sonnet-5',
      inputUnits: usage?.input_tokens ?? 0,
      outputUnits: usage?.output_tokens ?? 0,
      jobId,
      outputType: 'image_curation',
      durationMs: Date.now() - startedAt,
      status: 'success',
      apiKeyRef: 'forumphs_document_factory',
    })

    return { decisions, included, excluded_count, curated: true }
  } catch (e) {
    console.error('Image curation failed (non-fatal, caller falls back):', e)
    // §6.4 — si la visión consumió tokens y falló después (p. ej. JSON.parse),
    // registramos el consumo con status='error' en vez de perderlo. No cambia el
    // fallback del caller (curated:false → incluir por nombre de archivo).
    if (usage) {
      console.error(`[fphs-image-curation] fallo tras consumir tokens (in=${usage.input_tokens}, out=${usage.output_tokens}); registrando asiento status=error.`)
      await logLedger({
        lab: 'document-factory',
        sourceApp: 'fphs-image-curation',
        modelId: 'claude-sonnet-5',
        inputUnits: usage.input_tokens,
        outputUnits: usage.output_tokens,
        jobId,
        outputType: 'image_curation',
        durationMs: Date.now() - startedAt,
        status: 'error',
        errorMsg: e instanceof Error ? e.message : String(e),
        apiKeyRef: 'forumphs_document_factory',
      })
    }
    return empty
  }
}
