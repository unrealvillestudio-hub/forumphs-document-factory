// app/bi/html/route.ts
// Genera HTML Suite BI → persiste en informes → devuelve blob descargable
// fetch REST, sin @supabase/supabase-js

import { NextRequest, NextResponse } from 'next/server'

const FPHS_URL     = process.env.FPHS_SUPABASE_URL || ''
const FPHS_KEY     = process.env.FPHS_SERVICE_KEY   || ''
const UNRLVL_EF    = 'https://amlvyycfepwhiindxgzw.supabase.co/functions/v1'
const UNRLVL_KEY   = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || ''

async function fphs(table: string, params: string) {
  const res = await fetch(`${FPHS_URL}/rest/v1/${table}?${params}`, {
    headers: {
      'apikey': FPHS_KEY, 'Authorization': `Bearer ${FPHS_KEY}`,
      'Content-Type': 'application/json',
    },
    cache: 'no-store',
  })
  if (!res.ok) return null
  const text = await res.text()
  return text ? JSON.parse(text) : null
}

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url)
  const building_id = searchParams.get('building_id')
  const period      = searchParams.get('period')

  if (!building_id || !period) {
    return NextResponse.json({ error: 'building_id y period requeridos' }, { status: 400 })
  }
  if (!FPHS_URL || !FPHS_KEY) {
    return NextResponse.json({ error: 'FPHS env vars no configuradas' }, { status: 500 })
  }

  const periodDate = `${period}-01`
  const nextMonth  = (() => {
    const [y, m] = period.split('-').map(Number)
    return m === 12 ? `${y+1}-01-01` : `${y}-${String(m+1).padStart(2,'0')}-01`
  })()

  try {
    const [buildings, kpisRows, eeffRows, moraRows] = await Promise.all([
      fphs('buildings', `id=eq.${building_id}&select=id,name,total_units,tier,tarifa_base&limit=1`),
      fphs('monthly_kpis', `building_id=eq.${building_id}&period=eq.${periodDate}&limit=1`),
      fphs('eeff_preliminar', `building_id=eq.${building_id}&period_start=gte.${periodDate}&period_start=lt.${nextMonth}&limit=1`),
      fphs('mora_mensual', `building_id=eq.${building_id}&periodo=eq.${periodDate}&select=fase,monto_pendiente`),
    ])

    const building = buildings?.[0]
    if (!building) return NextResponse.json({ error: 'Edificio no encontrado' }, { status: 404 })

    const kpis     = kpisRows?.[0] ?? null
    const eeff     = eeffRows?.[0] ?? null
    const mora     = moraRows ?? []

    // Llamar EF fphs-bi-report
    const efRes = await fetch(`${UNRLVL_EF}/fphs-bi-report`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${UNRLVL_KEY}`,
      },
      body: JSON.stringify({
        building_id, building_name: building.name, period,
        kpis, eeff, mora_rows: mora,
        tier: building.tier ?? 'ESENCIAL',
        tarifa_base: building.tarifa_base ?? 0,
        total_units: building.total_units ?? 0,
      }),
    })

    let htmlOutput = ''
    if (efRes.ok) {
      const efData = await efRes.json()
      htmlOutput = efData.html ?? efData.html_output ?? ''
    }

    // Persistir en informes (upsert via POST + Prefer: resolution=merge-duplicates)
    if (htmlOutput && kpis) {
      const informeBody = {
        building_id, periodo: periodDate, tipo: 'bi_mensual',
        total_unidades:      building.total_units ?? 0,
        unidades_al_dia:     kpis.unidades_al_dia   ?? 0,
        unidades_mora:       kpis.unidades_mora      ?? 0,
        monto_recaudado:     kpis.monto_recaudado    ?? 0,
        monto_pendiente:     kpis.monto_pendiente    ?? 0,
        porcentaje_cobro:    kpis.porcentaje_cobro   ?? 0,
        mora_fase_i_count:   kpis.mora_fase_i_count  ?? 0,
        mora_fase_ii_count:  kpis.mora_fase_ii_count ?? 0,
        mora_fase_iii_count: kpis.mora_fase_iii_count ?? 0,
        mora_fase_iv_count:  kpis.mora_fase_iv_count ?? 0,
        mora_fase_i_monto:   kpis.mora_fase_i_monto  ?? 0,
        mora_fase_ii_monto:  kpis.mora_fase_ii_monto ?? 0,
        mora_fase_iii_monto: kpis.mora_fase_iii_monto ?? 0,
        mora_fase_iv_monto:  kpis.mora_fase_iv_monto ?? 0,
        html_output:         htmlOutput,
        generado_por:        'document_factory_v2',
        status:              'borrador',
        eeff_preliminar_id:  eeff?.id ?? null,
        monthly_kpis_id:     kpis?.id ?? null,
        updated_at:          new Date().toISOString(),
      }
      await fetch(`${FPHS_URL}/rest/v1/informes`, {
        method: 'POST',
        headers: {
          'apikey': FPHS_KEY, 'Authorization': `Bearer ${FPHS_KEY}`,
          'Content-Type': 'application/json',
          'Prefer': 'resolution=merge-duplicates',
        },
        body: JSON.stringify(informeBody),
      })
    }

    const html = htmlOutput || '<html><body style="font-family:sans-serif;padding:2rem">Sin datos suficientes para generar el informe BI. Verifique que existan registros en monthly_kpis para el período seleccionado.</body></html>'
    const safeName = building.name.replace(/[^a-zA-Z0-9]/g, '_')

    return new NextResponse(html, {
      headers: {
        'Content-Type': 'text/html; charset=utf-8',
        'Content-Disposition': `attachment; filename="BI_${safeName}_${period}.html"`,
      },
    })

  } catch (err: unknown) {
    console.error('[bi/html]', err)
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Error generando informe' },
      { status: 500 }
    )
  }
}
