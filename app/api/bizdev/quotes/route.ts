/**
 * /api/bizdev/quotes
 *   POST  → guarda una cotización en estado 'borrador'. El servidor RECALCULA con lib/bizdev/feeModel.ts
 *           y los parámetros vigentes de la base: los montos que mande el cliente no se guardan.
 *   PATCH → { id, estado, doc_ref? }. Al pasar a 'enviada' fija enviada_el y crea su fila en
 *           fphs_prospect_comms (canal 'documento', sentido 'enviado', origen 'document_factory').
 */
import { sb, currentParamsRow, errorResponse, ESTADOS_QUOTE } from '@/lib/bizdev/db'
import { calcular, normalizeParams, cents, type PersonalExtra } from '@/lib/bizdev/feeModel'
import { letterAmounts } from '@/lib/bizdev/proposal'

export const dynamic = 'force-dynamic'

const UUID = /^[0-9a-f-]{36}$/i
const usd = (n: number) => n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

function parseExtra(x: unknown): PersonalExtra[] {
  if (!Array.isArray(x)) return []
  return x.map(r => {
    const o = r as Record<string, unknown>
    const tipo: PersonalExtra['tipo'] | null = o.tipo === 'servicios' ? 'servicios' : o.tipo === 'planilla' ? 'planilla' : null
    if (!tipo) throw new Error(`personal_extra.tipo inválido: ${String(o.tipo)}`)
    return { personas: Number(o.personas) || 0, salario: Number(o.salario) || 0, tipo }
  }).filter(r => r.personas > 0 && r.salario > 0)
}

export async function POST(req: Request) {
  try {
    const b = await req.json() as Record<string, unknown>
    const prospect_id = String(b.prospect_id ?? '')
    if (!UUID.test(prospect_id)) throw new Error('prospect_id inválido')
    const params = normalizeParams(await currentParamsRow())
    const margen = Number(b.margen)
    const sel = params.margenes.findIndex(m => Math.abs(m - margen) < 1e-9)
    if (sel < 0) throw new Error(`margen ${margen} no está en los parámetros ${params.version}`)
    const u = Number(b.unidades) || 0
    const casas = !!b.es_casas
    const m2 = casas ? 0 : Number(b.m2) || 0
    const extra = parseExtra(b.personal_extra)
    const r = calcular(params, { u, m2, casas, extra })
    const row = {
      prospect_id, params_version: params.version, margen, unidades: u, m2, es_casas: casas,
      personal_incluido: r.incluidas, personal_extra: extra,
      costo_base: cents(r.costo), honorario: cents(r.honorarios[sel]),
      honorario_itbms: cents(r.conItbms[sel]), estado: 'borrador',
    }
    const [created] = await sb<unknown[]>('fphs_quotes', {
      method: 'POST', body: JSON.stringify(row), prefer: 'return=representation',
    })
    return Response.json({ quote: created }, { status: 201 })
  } catch (e) { return errorResponse(e) }
}

export async function PATCH(req: Request) {
  try {
    const b = await req.json() as Record<string, unknown>
    const id = String(b.id ?? '')
    if (!UUID.test(id)) throw new Error('id inválido')
    const estado = String(b.estado ?? '')
    if (!ESTADOS_QUOTE.includes(estado as typeof ESTADOS_QUOTE[number])) throw new Error(`estado inválido: ${estado}`)
    const hoy = new Date().toISOString().slice(0, 10)
    const patch: Record<string, unknown> = { estado }
    if (estado === 'enviada') patch.enviada_el = hoy
    if (b.doc_ref) patch.doc_ref = String(b.doc_ref)
    const [q] = await sb<Record<string, unknown>[]>(`fphs_quotes?id=eq.${id}`, {
      method: 'PATCH', body: JSON.stringify(patch), prefer: 'return=representation',
    })
    if (!q) return Response.json({ error: 'cotización no encontrada' }, { status: 404 })

    let comm: unknown = null
    if (estado === 'enviada') {
      const params = normalizeParams(await currentParamsRow())
      const extra = parseExtra(q.personal_extra)
      const r = calcular(params, {
        u: Number(q.unidades), m2: Number(q.m2), casas: !!q.es_casas, extra,
      })
      const sel = Math.max(0, params.margenes.findIndex(m => Math.abs(m - Number(q.margen)) < 1e-9))
      const a = letterAmounts(params, {
        ph: '', u: Number(q.unidades), m2: Number(q.m2), casas: !!q.es_casas, result: r, sel, itbms: params.itbms,
      })
      // El resumen no lleva margen ni costos: es lo que el prospecto recibió.
      const resumen = `Propuesta de administración enviada: tier ${a.tier}, $${usd(Number(q.honorario))} mensuales más ITBMS` +
        (r.extraPersonas > 0 ? `, con personal adicional a solicitud de la Junta (${r.extraPersonas})` : '')
      ;[comm] = await sb<unknown[]>('fphs_prospect_comms', {
        method: 'POST', prefer: 'return=representation',
        body: JSON.stringify({
          prospect_id: q.prospect_id, canal: 'documento', sentido: 'enviado', origen: 'document_factory',
          resumen, doc_ref: q.doc_ref ?? null, quote_id: q.id,
        }),
      })
      await sb(`fphs_prospects?id=eq.${String(q.prospect_id)}`, {
        method: 'PATCH', body: JSON.stringify({ updated_at: new Date().toISOString() }),
      })
    }
    return Response.json({ quote: q, comm })
  } catch (e) { return errorResponse(e) }
}
