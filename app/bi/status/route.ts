// app/api/bi/status/route.ts
// PATCH eeff_preliminar.status — workflow IF: borrador → enviado_jd → pendiente_cpa → oficial

import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

const VALID_STATUSES = ['borrador', 'enviado_jd', 'pendiente_cpa', 'oficial'] as const
type EEFFStatus = typeof VALID_STATUSES[number]

const supabase = () => createClient(
  process.env.FPHS_SUPABASE_URL!,
  process.env.FPHS_SERVICE_KEY!,
  { auth: { persistSession: false } }
)

export async function PATCH(req: NextRequest) {
  try {
    const body = await req.json()
    const { building_id, period, status, eeff_id } = body

    if (!status || !VALID_STATUSES.includes(status as EEFFStatus)) {
      return NextResponse.json({ error: `status inválido. Valores: ${VALID_STATUSES.join(', ')}` }, { status: 400 })
    }

    const db = supabase()

    // Buscar por eeff_id directo o por building_id + period
    let query = db.from('eeff_preliminar').update({
      status,
      updated_at: new Date().toISOString(),
      // Si avanza a oficial, registrar firma CPA
      ...(status === 'oficial' ? {
        cpa_signed:    true,
        cpa_signed_at: new Date().toISOString(),
        cpa_signed_by: 'Marlene Molina C.P.A. No. 0488-2020',
        disclaimer_cpa: 'Los estados e indicadores financieros han sido revisados y firmados por la Contadora Pública Autorizada Marlene Molina, C.P.A. No. 0488-2020.',
      } : {}),
    })

    if (eeff_id) {
      query = query.eq('id', eeff_id)
    } else if (building_id && period) {
      query = query.eq('building_id', building_id).eq('period_start', `${period}-01`)
    } else {
      return NextResponse.json({ error: 'Requerido: eeff_id o (building_id + period)' }, { status: 400 })
    }

    const { error } = await query

    if (error) throw error

    return NextResponse.json({ ok: true, status })

  } catch (err: unknown) {
    console.error('[bi/status]', err)
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Error actualizando status' },
      { status: 500 }
    )
  }
}
