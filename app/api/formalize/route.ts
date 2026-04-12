/**
 * /api/formalize/route.ts — v3
 * JSON response (not streaming) per batch — more reliable across Vercel 60s limit.
 * Returns { blocks: DebateBlock[], total_formalized, total_skipped }
 */

import { NextRequest, NextResponse } from 'next/server'
import Anthropic from '@anthropic-ai/sdk'
import type { DebateBlock } from '@/lib/types'

export const runtime = 'nodejs'
export const maxDuration = 55

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

EJEMPLOS:
Oral: "Pues mira, yo creo que deberíamos revisar el presupuesto porque no me parece que los números cuadren"
Formal: "El propietario del apartamento TB-15D, señor Wilson Torres, manifestó que los números del presupuesto no le parecían consistentes y solicitó una revisión detallada de las partidas."

Oral: "Sí, de acuerdo, perfecto."
Respuesta: NULL`

export async function POST(req: NextRequest) {
  try {
    const client = new Anthropic({ 
      apiKey: process.env.forumphs_document_factory || process.env.ANTHROPIC_API_KEY 
    })

    const { blocks, skeleton }: { 
      blocks: DebateBlock[]
      skeleton?: { agenda_items?: { number: number; title: string }[] }
    } = await req.json()

    const { assignBlocksToSections } = await import('@/lib/processors/sectionAssigner')
    const agendaItems = skeleton?.agenda_items || []
    const assignedBlocks = assignBlocksToSections(blocks, agendaItems)

    const results: DebateBlock[] = []

    for (let i = 0; i < assignedBlocks.length; i++) {
      const block = assignedBlocks[i]

      if (block.skip || block.speaker_role === 'logistica' || !block.text_cleaned) {
        results.push({ ...block, skip: true })
        continue
      }
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
          .filter((c): c is Anthropic.TextBlock => c.type === 'text')
          .map(c => c.text)
          .join('')
          .trim()

        const formalText = responseText === 'NULL' ? null : responseText
        results.push({
          ...block,
          text_formal: formalText || undefined,
          skip: formalText === null,
          skip_reason: formalText === null ? 'no_content' : undefined,
        })
      } catch (err) {
        // On error, use cleaned text as fallback — don't stop the batch
        results.push({ ...block, text_formal: block.text_cleaned, skip: false })
        console.error(`Block ${i} error:`, err)
      }

      // No delay — API handles rate limiting
    }

    return NextResponse.json({
      success: true,
      blocks: results,
      total_formalized: results.filter(b => b.text_formal).length,
      total_skipped: results.filter(b => b.skip).length,
    })
  } catch (err) {
    return NextResponse.json({ 
      success: false, 
      error: err instanceof Error ? err.message : String(err) 
    }, { status: 500 })
  }
}
