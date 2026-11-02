/**
 * POST /api/bizdev/comms — comunicación registrada a mano por Sam.
 * origen = 'manual' siempre: esta ruta no lee ni importa ningún buzón (MAIL_PRIVACY_RULE.md).
 */
import { sb, errorResponse, CANALES, SENTIDOS } from '@/lib/bizdev/db'

export const dynamic = 'force-dynamic'

export async function POST(req: Request) {
  try {
    const b = await req.json() as Record<string, unknown>
    const prospect_id = String(b.prospect_id ?? '')
    if (!/^[0-9a-f-]{36}$/i.test(prospect_id)) throw new Error('prospect_id inválido')
    if (!CANALES.includes(b.canal as typeof CANALES[number])) throw new Error(`canal inválido: ${String(b.canal)}`)
    if (!SENTIDOS.includes(b.sentido as typeof SENTIDOS[number])) throw new Error(`sentido inválido: ${String(b.sentido)}`)
    const resumen = String(b.resumen ?? '').trim()
    if (!resumen) throw new Error('resumen es obligatorio')
    const row = {
      prospect_id, canal: b.canal, sentido: b.sentido, origen: 'manual', resumen,
      fecha: b.fecha ? new Date(String(b.fecha)).toISOString() : new Date().toISOString(),
      doc_ref: b.doc_ref ? String(b.doc_ref) : null,
    }
    const [created] = await sb<unknown[]>('fphs_prospect_comms', {
      method: 'POST', body: JSON.stringify(row), prefer: 'return=representation',
    })
    await sb(`fphs_prospects?id=eq.${prospect_id}`, {
      method: 'PATCH', body: JSON.stringify({ updated_at: new Date().toISOString() }),
    })
    return Response.json({ comm: created }, { status: 201 })
  } catch (e) { return errorResponse(e) }
}
