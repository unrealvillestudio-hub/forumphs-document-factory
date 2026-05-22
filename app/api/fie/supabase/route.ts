// app/api/fie/supabase/route.ts
// Carga FIESchema desde eeff_preliminar de Supabase ForumPHs
// fetch REST, sin @supabase/supabase-js

import { NextRequest, NextResponse } from 'next/server'
import { emptyFIESchema, FPHs_DEFAULTS, FIE_DEFAULT_SCENARIOS } from '@/lib/fie/schema'
import type { FIESchema, FIEMonth } from '@/lib/fie/schema'

const FPHS_URL = process.env.FPHS_SUPABASE_URL || ''
const FPHS_KEY = process.env.FPHS_SERVICE_KEY   || ''

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

const MONTHS = ['Ene','Feb','Mar','Abr','May','Jun','Jul','Ago','Sep','Oct','Nov','Dic']

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url)
  const building_id = searchParams.get('building_id')
  const months      = Math.min(parseInt(searchParams.get('months') ?? '6'), 12)

  if (!building_id) {
    return NextResponse.json({ error: 'building_id requerido' }, { status: 400 })
  }
  if (!FPHS_URL || !FPHS_KEY) {
    return NextResponse.json({ error: 'FPHS env vars no configuradas' }, { status: 500 })
  }

  try {
    // 1. Edificio
    const buildings = await fphs('buildings',
      `id=eq.${building_id}&select=id,name,total_units,tier,tarifa_base&limit=1`)
    const building = buildings?.[0]
    if (!building) return NextResponse.json({ error: 'Edificio no encontrado' }, { status: 404 })

    // 2. EEFF últimos N meses
    const cutoff = new Date()
    cutoff.setMonth(cutoff.getMonth() - months)
    const cutoffStr = cutoff.toISOString().slice(0, 10)

    const eeffRows: Record<string, number>[] = await fphs('eeff_preliminar',
      `building_id=eq.${building_id}&period_start=gte.${cutoffStr}&select=period_start,ingresos_total,gastos_total,utilidad_neta,margen_pct,gastos_personal,gastos_admin,gastos_otros&order=period_start.asc`) ?? []

    // 3. Mapear a FIEMonth[]
    const eeffMonths: FIEMonth[] = eeffRows.map(row => {
      const d    = new Date(row.period_start)
      const ing  = Number(row.ingresos_total ?? 0)
      const gas  = Number(row.gastos_total   ?? 0)
      const util = Number(row.utilidad_neta  ?? ing - gas)
      const marg = Number(row.margen_pct     ?? (ing > 0 ? (util / ing) * 100 : 0))
      return {
        month:    `${MONTHS[d.getMonth()]} ${d.getFullYear()}`,
        ingresos: ing, gastos: gas, utilidad: util,
        margen:   Number(marg.toFixed(1)),
      }
    })

    // 4. Cost breakdown
    const avg = (key: string) => {
      if (!eeffRows.length) return 0
      return Number((eeffRows.reduce((s, r) => s + Number(r[key] ?? 0), 0) / eeffRows.length).toFixed(2))
    }

    const costBreakdown = {
      salarios:   avg('gastos_personal') || 5666,
      css:        955,
      honorarios: avg('gastos_admin') || 6175,
      viaticos:   625,
      servicios:  1249,
      stack:      170,
      otros:      avg('gastos_otros') || 0,
    }

    // 5. Base income/ops
    const baseIncome = eeffMonths.length > 0
      ? Number((eeffMonths.reduce((s, m) => s + m.ingresos, 0) / eeffMonths.length).toFixed(2))
      : FPHs_DEFAULTS.base_income
    const baseOps = eeffMonths.length > 0
      ? Number((eeffMonths.reduce((s, m) => s + m.gastos, 0) / eeffMonths.length).toFixed(2))
      : FPHs_DEFAULTS.base_ops

    // 6. Period label
    let periodLabel = ''
    if (eeffMonths.length >= 2)     periodLabel = `${eeffMonths[0].month}–${eeffMonths[eeffMonths.length-1].month}`
    else if (eeffMonths.length === 1) periodLabel = eeffMonths[0].month
    else { const n = new Date(); periodLabel = `${MONTHS[n.getMonth()]} ${n.getFullYear()}` }

    const schema: FIESchema = {
      ...emptyFIESchema(building.name),
      period_label:        periodLabel,
      generated_at:        new Date().toISOString(),
      currency:            'USD',
      eeff_months:         eeffMonths,
      cost_breakdown:      costBreakdown,
      base_income:         baseIncome,
      base_ops:            baseOps,
      cost_per_new_ph:     FPHs_DEFAULTS.cost_per_new_ph,
      labor_res_monthly:   FPHs_DEFAULTS.labor_res_monthly,
      contingency_monthly: FPHs_DEFAULTS.contingency_monthly,
      historic_liability:  FPHs_DEFAULTS.historic_liability,
      scenarios:           FIE_DEFAULT_SCENARIOS,
    }

    return NextResponse.json({
      schema,
      source:        'supabase',
      months_loaded: eeffMonths.length,
      raw_preview:   `${building.name} · ${eeffMonths.length} meses desde Supabase ForumPHs`,
    })

  } catch (err: unknown) {
    console.error('[fie/supabase]', err)
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Error cargando datos' },
      { status: 500 }
    )
  }
}
