/**
 * /api/bizdev/prospects
 *   GET   → lista de prospectos con cotizaciones, comunicaciones, contactos de seguimiento, lecturas de
 *           correo y acciones propuestas (08_bizdev_analisis_de_correos.sql), más recientes primero.
 *   POST  → crea un prospecto. El código FPHS-P-NNNN lo asigna la base.
 *   PATCH → { id, etapa?, proxima_accion?, proxima_fecha?, notas?, contacto_nombre?, contacto_rol?, archivado? }.
 *           archivado: true | false archiva o desarchiva (09_bizdev_historial_archivo_prueba.sql). Archivar no
 *           cambia la etapa ni borra nada; el prospecto sale del dashboard y de los indicadores.
 */
import { sb, errorResponse, ETAPAS } from '@/lib/bizdev/db'

export const dynamic = 'force-dynamic'

const EDITABLES = ['short_name', 'full_name', 'unidades', 'm2_privados', 'es_casas', 'fuente_tamano',
  'clase_evidencia', 'etapa', 'contacto_nombre', 'contacto_rol', 'proxima_accion', 'proxima_fecha', 'notas'] as const

function pick(body: Record<string, unknown>) {
  const out: Record<string, unknown> = {}
  for (const k of EDITABLES) if (k in body) out[k] = body[k] === '' ? null : body[k]
  if ('etapa' in out && !ETAPAS.includes(out.etapa as typeof ETAPAS[number])) {
    throw new Error(`etapa inválida: ${String(out.etapa)}`)
  }
  return out
}

export async function GET() {
  try {
    const rows = await sb(
      'fphs_prospects?select=*,quotes:fphs_quotes(*),comms:fphs_prospect_comms(*)' +
      ',contacts:fphs_prospect_contacts(*),insights:fphs_prospect_insights(*),actions:fphs_prospect_actions(*)' +
      '&order=updated_at.desc&quotes.order=created_at.desc&comms.order=fecha.desc' +
      '&contacts.order=created_at.asc&insights.order=created_at.desc&actions.order=created_at.desc')
    return Response.json({ prospects: rows })
  } catch (e) { return errorResponse(e) }
}

export async function POST(req: Request) {
  try {
    const body = await req.json() as Record<string, unknown>
    const row = pick(body)
    if (!row.short_name || typeof row.short_name !== 'string') throw new Error('short_name es obligatorio')
    const [created] = await sb<unknown[]>('fphs_prospects', {
      method: 'POST', body: JSON.stringify(row), prefer: 'return=representation',
    })
    return Response.json({ prospect: created }, { status: 201 })
  } catch (e) { return errorResponse(e) }
}

export async function PATCH(req: Request) {
  try {
    const body = await req.json() as Record<string, unknown>
    const id = String(body.id ?? '')
    if (!/^[0-9a-f-]{36}$/i.test(id)) throw new Error('id inválido')
    const row: Record<string, unknown> = { ...pick(body), updated_at: new Date().toISOString() }
    if ('archivado' in body) {
      if (typeof body.archivado !== 'boolean') throw new Error('archivado debe ser true o false')
      row.archivado_el = body.archivado ? new Date().toISOString() : null
    }
    const [updated] = await sb<unknown[]>(`fphs_prospects?id=eq.${id}`, {
      method: 'PATCH', body: JSON.stringify(row), prefer: 'return=representation',
    })
    if (!updated) return Response.json({ error: 'prospecto no encontrado' }, { status: 404 })
    return Response.json({ prospect: updated })
  } catch (e) { return errorResponse(e) }
}
