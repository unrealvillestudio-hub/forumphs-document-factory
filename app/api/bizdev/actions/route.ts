/**
 * PATCH /api/bizdev/actions — Sam decide una acción propuesta: { id, estado: 'aprobada' | 'descartada' }.
 * Al aprobarla, pasa a ser la próxima acción del prospecto (con su fecha sugerida, si la trae).
 * Las acciones las propone unrlvl-communications-services vía fphs_bizdev_ingest(); aquí solo se deciden.
 */
import { sb, errorResponse } from '@/lib/bizdev/db'

export const dynamic = 'force-dynamic'
const UUID = /^[0-9a-f-]{36}$/i

export async function PATCH(req: Request) {
  try {
    const b = await req.json() as Record<string, unknown>
    const id = String(b.id ?? '')
    if (!UUID.test(id)) throw new Error('id inválido')
    const estado = String(b.estado ?? '')
    if (estado !== 'aprobada' && estado !== 'descartada') throw new Error(`estado inválido: ${estado}`)
    // Solo se decide lo que sigue pendiente: una segunda decisión no pisa la primera.
    const [a] = await sb<Record<string, unknown>[]>(`fphs_prospect_actions?id=eq.${id}&estado=eq.pendiente`, {
      method: 'PATCH', body: JSON.stringify({ estado, decidida_el: new Date().toISOString() }), prefer: 'return=representation',
    })
    if (!a) return Response.json({ error: 'acción no encontrada o ya decidida' }, { status: 409 })
    if (estado === 'aprobada') {
      const patch: Record<string, unknown> = { proxima_accion: a.accion, updated_at: new Date().toISOString() }
      if (a.fecha_sugerida) patch.proxima_fecha = a.fecha_sugerida
      await sb(`fphs_prospects?id=eq.${String(a.prospect_id)}`, { method: 'PATCH', body: JSON.stringify(patch) })
    }
    return Response.json({ action: a })
  } catch (e) { return errorResponse(e) }
}
