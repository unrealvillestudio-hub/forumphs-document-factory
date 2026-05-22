// app/api/bi/html/route.ts
// Genera HTML Suite BI → persiste en informes → devuelve blob descargable
// Llama fphs-bi-report EF (amlvyycfepwhiindxgzw) con datos ya calculados

import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

const fphs = () => createClient(
  process.env.FPHS_SUPABASE_URL!,
  process.env.FPHS_SERVICE_KEY!,
  { auth: { persistSession: false } }
)

const UNRLVL_EF_BASE = 'https://amlvyycfepwhiindxgzw.supabase.co/functions/v1'

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url)
  const building_id = searchParams.get('building_id')
  const period      = searchParams.get('period')

  if (!building_id || !period) {
    return NextResponse.json({ error: 'building_id y period requeridos' }, { status: 400 })
  }

  const db = fphs()
  const periodDate = `${period}-01`

  try {
    // ── 1. Leer datos completos del período ───────────────────────
    const [{ data: building }, { data: kpis }, { data: eeff }, { data: moraRows }] = await Promise.all([
      db.from('buildings').select('id, name, total_units, tier, tarifa_base').eq('id', building_id).single(),
      db.from('monthly_kpis').select('*').eq('building_id', building_id).eq('period', periodDate).maybeSingle(),
      db.from('eeff_preliminar').select('*').eq('building_id', building_id).gte('period_start', periodDate).limit(1).maybeSingle(),
      db.from('mora_mensual').select('fase, monto_pendiente').eq('building_id', building_id).eq('periodo', periodDate),
    ])

    if (!building) {
      return NextResponse.json({ error: 'Edificio no encontrado' }, { status: 404 })
    }

    // ── 2. Llamar fphs-bi-report EF ───────────────────────────────
    const efPayload = {
      building_id,
      building_name: building.name,
      period,
      kpis: kpis ?? null,
      eeff: eeff ?? null,
      mora_rows: moraRows ?? [],
      tier: building.tier ?? 'ESENCIAL',
      tarifa_base: building.tarifa_base ?? 0,
      total_units: building.total_units ?? 0,
    }

    const efRes = await fetch(`${UNRLVL_EF_BASE}/fphs-bi-report`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${process.env.FPHS_SERVICE_KEY}`,
      },
      body: JSON.stringify(efPayload),
    })

    if (!efRes.ok) {
      const errText = await efRes.text()
      throw new Error(`fphs-bi-report error ${efRes.status}: ${errText.slice(0, 200)}`)
    }

    const efData = await efRes.json()
    const htmlOutput: string = efData.html ?? efData.html_output ?? ''

    // ── 3. Persistir en informes ──────────────────────────────────
    if (htmlOutput) {
      await db.from('informes').upsert({
        building_id,
        periodo: periodDate,
        tipo: 'bi_mensual',
        total_unidades:       building.total_units ?? 0,
        unidades_al_dia:      kpis?.unidades_al_dia   ?? 0,
        unidades_mora:        kpis?.unidades_mora      ?? 0,
        monto_recaudado:      kpis?.monto_recaudado    ?? 0,
        monto_pendiente:      kpis?.monto_pendiente    ?? 0,
        porcentaje_cobro:     kpis?.porcentaje_cobro   ?? 0,
        mora_fase_i_count:    kpis?.mora_fase_i_count  ?? 0,
        mora_fase_ii_count:   kpis?.mora_fase_ii_count ?? 0,
        mora_fase_iii_count:  kpis?.mora_fase_iii_count ?? 0,
        mora_fase_iv_count:   kpis?.mora_fase_iv_count ?? 0,
        mora_fase_i_monto:    kpis?.mora_fase_i_monto  ?? 0,
        mora_fase_ii_monto:   kpis?.mora_fase_ii_monto ?? 0,
        mora_fase_iii_monto:  kpis?.mora_fase_iii_monto ?? 0,
        mora_fase_iv_monto:   kpis?.mora_fase_iv_monto ?? 0,
        tarifa_base:          building.tarifa_base ?? 0,
        narrativa_claude:     efData.narrativa ?? null,
        html_output:          htmlOutput,
        generado_por:         'document_factory_v2',
        cpa_disclaimer:       'Estado preliminar — pendiente firma CPA Marlene Molina (PE-11-2157 · 0488-2020)',
        status:               'borrador',
        eeff_preliminar_id:   eeff?.id ?? null,
        monthly_kpis_id:      kpis?.id ?? null,
        updated_at:           new Date().toISOString(),
      }, { onConflict: 'building_id,periodo,tipo' })
    }

    // ── 4. Devolver HTML descargable ──────────────────────────────
    const safeName = building.name.replace(/[^a-zA-Z0-9]/g, '_')
    return new NextResponse(htmlOutput || '<html><body>Sin datos suficientes para generar el informe.</body></html>', {
      headers: {
        'Content-Type':        'text/html; charset=utf-8',
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
