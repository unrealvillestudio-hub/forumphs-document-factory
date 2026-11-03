/**
 * /api/bizdev/contacts — correos y dominios de un prospecto para el seguimiento de correo.
 *   POST   → { prospect_id, tipo: 'email' | 'dominio', valor, rol? }
 *   DELETE → ?id=<uuid>
 * Los carga Sam a mano. unrlvl-communications-services los usa (vía fphs_bizdev_match) para saber
 * qué hilos seguir; esta ruta no lee ningún buzón.
 */
import { sb, errorResponse, DbError } from '@/lib/bizdev/db'
import { normalizarContacto } from '@/lib/bizdev/insights'

export const dynamic = 'force-dynamic'
const UUID = /^[0-9a-f-]{36}$/i

export async function POST(req: Request) {
  try {
    const b = await req.json() as Record<string, unknown>
    const prospect_id = String(b.prospect_id ?? '')
    if (!UUID.test(prospect_id)) throw new Error('prospect_id inválido')
    const c = normalizarContacto(String(b.tipo ?? ''), String(b.valor ?? ''))
    const rol = b.rol ? String(b.rol).trim() || null : null
    try {
      const [created] = await sb<unknown[]>('fphs_prospect_contacts', {
        method: 'POST', body: JSON.stringify({ prospect_id, ...c, rol }), prefer: 'return=representation',
      })
      return Response.json({ contact: created }, { status: 201 })
    } catch (e) {
      // 23505: la dirección o el dominio ya pertenece a un prospecto (cada uno es de uno solo).
      if (e instanceof DbError && /23505/.test(e.message)) {
        throw new DbError(`${c.valor} ya está asignado a un prospecto: cada correo o dominio pertenece a uno solo.`, 409)
      }
      throw e
    }
  } catch (e) { return errorResponse(e) }
}

export async function DELETE(req: Request) {
  try {
    const id = new URL(req.url).searchParams.get('id') ?? ''
    if (!UUID.test(id)) throw new Error('id inválido')
    const rows = await sb<unknown[]>(`fphs_prospect_contacts?id=eq.${id}`, { method: 'DELETE', prefer: 'return=representation' })
    if (!rows?.length) return Response.json({ error: 'contacto no encontrado' }, { status: 404 })
    return Response.json({ ok: true })
  } catch (e) { return errorResponse(e) }
}
