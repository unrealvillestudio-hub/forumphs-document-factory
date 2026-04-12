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
- USA **negrita** para el nombre + identificación completa la PRIMERA vez. Ej: "La propietaria **María García, del apartamento C100**, manifestó...", o "La administradora **Ivette Flores**, en representación de la administración, indicó..."
- Si es de la junta directiva: "La tesorera **Maruquel Márquez, de la unidad C100**"
- NO uses ningún otro markdown

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

    // Process blocks in parallel chunks of PARALLEL_SIZE
    const PARALLEL_SIZE = 5
    const results: DebateBlock[] = new Array(assignedBlocks.length)

    async function formalizeBlock(block: DebateBlock, idx: number): Promise<void> {
      if (block.skip || block.speaker_role === 'logistica' || !block.text_cleaned) {
        results[idx] = { ...block, skip: true }
        return
      }
      if ((block.text_cleaned || '').trim().length < 30) {
        results[idx] = { ...block, skip: true, skip_reason: 'too_short' }
        return
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
          .map(c => c.text).join('').trim()
        const formalText = responseText === 'NULL' ? null : responseText
        results[idx] = { ...block, text_formal: formalText || undefined, skip: formalText === null, skip_reason: formalText === null ? 'no_content' : undefined }
      } catch (err) {
        results[idx] = { ...block, text_formal: block.text_cleaned || block.text_raw, skip: false }
        console.error(`Block ${idx} error:`, err)
      }
    }

    // Process in parallel chunks
    for (let i = 0; i < assignedBlocks.length; i += PARALLEL_SIZE) {
      const chunk = assignedBlocks.slice(i, i + PARALLEL_SIZE)
      await Promise.allSettled(chunk.map((block, j) => formalizeBlock(block, i + j)))
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
