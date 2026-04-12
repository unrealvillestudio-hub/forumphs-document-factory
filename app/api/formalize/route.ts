/**
 * /api/formalize/route.ts
 * Paso 0.5 — Calls Claude API to formalize each debate block.
 * Streams progress back as NDJSON.
 */

import { NextRequest } from 'next/server'
import Anthropic from '@anthropic-ai/sdk'
import type { DebateBlock } from '@/lib/types'

export const runtime = 'nodejs'
export const maxDuration = 60  // Vercel max per request — client batches

const client = new Anthropic({ apiKey: process.env.forumphs_document_factory || process.env.ANTHROPIC_API_KEY })

const SYSTEM_PROMPT = `Eres un redactor especializado en Actas de Asamblea de Propiedad Horizontal en Panamá. 
Tu función es convertir fragmentos de habla oral en párrafos formales de tercera persona para el acta legal.

REGLAS ESTRICTAS:
- Si el fragmento no tiene contenido sustantivo para el acta, responde exactamente: NULL
- Escribe SIEMPRE en tercera persona formal
- Usa el nombre y unidad del hablante proporcionados
- Elimina: muletillas, repeticiones, fragmentos incompletos, coordinación técnica (audio/video)
- Preserva la esencia del argumento, consulta o propuesta
- Máximo 150 palabras de output
- Para cuotas de mantenimiento, usar formato B/.X.XX
- Para otros montos, usar $X,XXX.XX
- NO incluir "señaló que" vacío al final
- El párrafo debe tener sujeto + verbo + objeto claro

EJEMPLOS DE CONVERSIÓN:
Oral: "Pues mira, yo creo que deberíamos... eh... revisar el presupuesto porque no sé, no me parece que los números cuadren bien"
Formal: "El propietario del apartamento TB-15D, señor Wilson Torres, manifestó que los números del presupuesto presentado no le parecían consistentes y solicitó una revisión detallada de las partidas."

Oral: "Sí, de acuerdo, perfecto."
Respuesta: NULL`

export async function POST(req: NextRequest): Promise<Response> {
  const { blocks, skeleton }: { blocks: DebateBlock[], skeleton?: { agenda_items?: { number: number; title: string }[] } } = await req.json()

    // Process max 50 blocks per request to stay within Vercel 60s limit
    const BATCH_SIZE = 50

    // Apply section assigner before formalization so blocks carry agenda_section
    const { assignBlocksToSections } = await import('@/lib/processors/sectionAssigner')
    const agendaItems = skeleton?.agenda_items || []
    const assignedBlocks = assignBlocksToSections(blocks, agendaItems)

  const encoder = new TextEncoder()

  const stream = new ReadableStream({
    async start(controller) {
      const results: DebateBlock[] = []

      for (let i = 0; i < assignedBlocks.length; i++) {
        const block = assignedBlocks[i]

        // Skip logistica, empty, or already-marked-skip
        if (block.skip || block.speaker_role === 'logistica' || !block.text_cleaned) {
          results.push({ ...block, skip: true })
          const progress = {
            type: 'progress',
            index: i,
            total: blocks.length,
            speaker: block.speaker_name,
            unit: block.speaker_unit,
            skipped: true,
          }
          controller.enqueue(encoder.encode(JSON.stringify(progress) + '\n'))
          continue
        }

        // Skip very short blocks
        if ((block.text_cleaned || '').trim().length < 30) {
          results.push({ ...block, skip: true, skip_reason: 'too_short' })
          continue
        }

        try {
          const userPrompt = `Hablante: ${block.speaker_name}
Cargo/rol: ${block.speaker_role}
Unidad: ${block.speaker_unit || 'no especificada'}

Fragmento de habla oral:
"${block.text_cleaned}"

Escribe el párrafo formal para el acta, o responde NULL.`

          const message = await client.messages.create({
            model: 'claude-sonnet-4-6',
            max_tokens: 300,
            system: SYSTEM_PROMPT,
            messages: [{ role: 'user', content: userPrompt }],
          })

          const responseText = message.content
            .filter(c => c.type === 'text')
            .map(c => c.text)
            .join('')
            .trim()

          const formalText = responseText === 'NULL' ? null : responseText
          const updatedBlock: DebateBlock = {
            ...block,
            text_formal: formalText || undefined,
            skip: formalText === null,
            skip_reason: formalText === null ? 'no_content' : undefined,
          }
          results.push(updatedBlock)

          const progress = {
            type: 'progress',
            index: i,
            total: blocks.length,
            speaker: block.speaker_name,
            unit: block.speaker_unit,
            result: formalText?.substring(0, 80) + (formalText && formalText.length > 80 ? '...' : ''),
            skipped: formalText === null,
          }
          controller.enqueue(encoder.encode(JSON.stringify(progress) + '\n'))

        } catch (err) {
          console.error(`Error formalizing block ${i}:`, err)
          const errMsg = err instanceof Error ? err.message : String(err)
          results.push({ ...block, text_formal: block.text_cleaned, skip: false })
          controller.enqueue(encoder.encode(JSON.stringify({
            type: 'error',
            index: i,
            speaker: block.speaker_name,
            error: `API error: ${errMsg.substring(0, 120)}`,
          }) + '\n'))
        }

        // Small delay to respect rate limits
        await new Promise(r => setTimeout(r, 100))
      }

      // Final result
      controller.enqueue(encoder.encode(JSON.stringify({
        type: 'complete',
        blocks: results,
        total_formalized: results.filter(b => b.text_formal).length,
        total_skipped: results.filter(b => b.skip).length,
      }) + '\n'))

      controller.close()
    }
  })

  return new Response(stream, {
    headers: {
      'Content-Type': 'application/x-ndjson',
      'Cache-Control': 'no-cache',
      'Transfer-Encoding': 'chunked',
    },
  })
}
