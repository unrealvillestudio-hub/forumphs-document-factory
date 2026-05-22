// app/bi/status/route.ts
// PATCH eeff_preliminar.status — fetch REST, sin @supabase/supabase-js

import { NextRequest, NextResponse } from 'next/server'

const FPHS_URL = process.env.FPHS_SUPABASE_URL || ''
const FPHS_KEY = process.env.FPHS_SERVICE_KEY    || ''

const VALID = ['borrador', 'enviado_jd', 'pendiente_cpa', 'oficial']

export async function PATCH(req: NextRequest) {
  if (!FPHS_URL || !FPHS_KEY) {
    return NextResponse.json({ error: 'FPHS env vars no configuradas' }, { status: 500 })
  }
  try {
    const { eeff_id, building_id, period, status } = await req.json()

    if (!status || !VALID.includes(status)) {
      return NextResponse.json({ error: `status inválido. Valores: ${VALID.join(', ')}` }, { status: 400 })
    }

    const body: Record<string, unknown> = {
      status,
      updated_at: new Date().toISOString(),
    }
    if (status === 'oficial') {
      body.cpa_signed    = true
      body.cpa_signed_at = new Date().toISOString()
      body.cpa_signed_by = 'Marlene Molina C.P.A. No. 0488-2020'
      body.disclaimer_cpa = 'Estados financieros revisados y firmados por CPA Marlene Molina, No. 0488-2020.'
    }

    // Construir filtro
    let filter = ''
    if (eeff_id)                filter = `id=eq.${eeff_id}`
    else if (building_id && period) filter = `building_id=eq.${building_id}&period_start=eq.${period}-01`
    else return NextResponse.json({ error: 'Requerido: eeff_id o building_id+period' }, { status: 400 })

    const res = await fetch(`${FPHS_URL}/rest/v1/eeff_preliminar?${filter}`, {
      method: 'PATCH',
      headers: {
        'apikey':        FPHS_KEY,
        'Authorization': `Bearer ${FPHS_KEY}`,
        'Content-Type':  'application/json',
        'Prefer':        'return=minimal',
      },
      body: JSON.stringify(body),
    })

    if (!res.ok) throw new Error(`Supabase PATCH error ${res.status}`)
    return NextResponse.json({ ok: true, status })

  } catch (err: unknown) {
    console.error('[bi/status]', err)
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Error' },
      { status: 500 }
    )
  }
}
