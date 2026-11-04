/**
 * POST /api/bizdev/contacts/historial — { contact_id }
 * Pide a unrlvl-communications-services que revise los correos de los últimos 12 meses desde y hacia ese
 * contacto, y registre en el prospecto los que encuentre (vía fphs_bizdev_ingest, idempotente por mensaje).
 *
 * Esta ruta NO lee ningún buzón: marca la revisión como «en_curso» y le pasa al servicio la marca, la
 * dirección, el tope de meses y un `ref` opaco (el id del contacto). El servicio trabaja en segundo plano y
 * avisa del final con fphs_bizdev_historial_done(ref), que deja el resultado en el contacto
 * (supabase/migrations/09_bizdev_historial_archivo_prueba.sql).
 *
 * Env del servidor (las carga Sam en Vercel; los valores nunca van por chat ni al repo):
 *   COMM_CARRIL_URL     → URL de la Edge Function del servicio (comm-services-carril)
 *   COMM_CARRIL_SECRET  → el secreto con el que el servicio autoriza llamadas (x-cron-secret)
 */
import { sb, errorResponse, DbError, COMM_BRAND_ID } from '@/lib/bizdev/db'
import { HISTORIAL_MESES, HISTORIAL_TIMEOUT_MIN, type Contacto } from '@/lib/bizdev/insights'

export const dynamic = 'force-dynamic'
const UUID = /^[0-9a-f-]{36}$/i

async function marcarError(id: string, error: string) {
  await sb(`fphs_prospect_contacts?id=eq.${id}`, {
    method: 'PATCH',
    body: JSON.stringify({ historial_estado: 'error', historial_terminado_el: new Date().toISOString(), historial_resultado: { error } }),
  }).catch(() => {})
}

export async function POST(req: Request) {
  try {
    const b = await req.json() as Record<string, unknown>
    const id = String(b.contact_id ?? '')
    if (!UUID.test(id)) throw new Error('contact_id inválido')

    const url = process.env.COMM_CARRIL_URL ?? ''
    const secret = process.env.COMM_CARRIL_SECRET ?? ''
    if (!url || !secret) {
      throw new DbError('La revisión del historial todavía no está conectada: faltan COMM_CARRIL_URL y COMM_CARRIL_SECRET en Vercel.', 503)
    }

    const [c] = await sb<Contacto[]>(`fphs_prospect_contacts?id=eq.${id}&select=*`)
    if (!c) return Response.json({ error: 'contacto no encontrado' }, { status: 404 })
    if (c.historial_estado === 'en_curso' && c.historial_solicitado_el &&
        Date.now() - Date.parse(c.historial_solicitado_el) < HISTORIAL_TIMEOUT_MIN * 60000) {
      return Response.json({ error: 'Ya hay una revisión en curso para este contacto.' }, { status: 409 })
    }

    const ahora = new Date().toISOString()
    await sb(`fphs_prospect_contacts?id=eq.${id}`, {
      method: 'PATCH',
      body: JSON.stringify({ historial_estado: 'en_curso', historial_solicitado_el: ahora, historial_terminado_el: null, historial_resultado: null }),
    })

    let res: Response
    try {
      res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-cron-secret': secret },
        body: JSON.stringify({ modo: 'historial', brand_id: COMM_BRAND_ID, tipo: c.tipo, direccion: c.valor, meses: HISTORIAL_MESES, ref: c.id }),
        signal: AbortSignal.timeout(20000),
      })
    } catch (e) {
      const msg = `el servicio no respondió (${e instanceof Error ? e.message : String(e)})`
      await marcarError(id, msg)
      throw new DbError(`No se pudo pedir la revisión: ${msg}.`, 502)
    }
    const text = await res.text()
    if (!res.ok) {
      const msg = `el servicio respondió ${res.status}: ${text.slice(0, 200)}`
      await marcarError(id, msg)
      throw new DbError(`No se pudo pedir la revisión: ${msg}`, 502)
    }
    return Response.json({ ok: true, estado: 'en_curso', solicitado_el: ahora }, { status: 202 })
  } catch (e) { return errorResponse(e) }
}
