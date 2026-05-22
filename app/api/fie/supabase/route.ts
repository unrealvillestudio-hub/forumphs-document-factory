// app/api/fie/supabase/route.ts
// Carga datos financieros desde Supabase ForumPHs → FIESchema
// Alternativa al upload manual de .xlsx/.pdf en el Normalizer

import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { emptyFIESchema, FPHs_DEFAULTS, FIE_DEFAULT_SCENARIOS } from '@/lib/fie/schema'
import type { FIESchema, FIEMonth } from '@/lib/fie/schema'

const fphs = () => createClient(
  process.env.FPHS_SUPABASE_URL!,
  process.env.FPHS_SERVICE_KEY!,
  { auth: { persistSession: false } }
)

const MONTH_NAMES = ['Ene','Feb','Mar','Abr','May','Jun','Jul','Ago','Sep','Oct','Nov','Dic']

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url)
  const building_id = searchParams.get('building_id')
  // months: cuántos meses hacia atrás incluir (default 6)
  const months      = Math.min(parseInt(searchParams.get('months') ?? '6'), 12)

  if (!building_id) {
    return NextResponse.json({ error: 'building_id requerido' }, { status: 400 })
  }

  const db = fphs()

  try {
    // ── 1. Edificio ───────────────────────────────────────────────
    const { data: building, error: bErr } = await db
      .from('buildings')
      .select('id, name, total_units, tier, tarifa_base')
      .eq('id', building_id)
      .single()

    if (bErr || !building) {
      return NextResponse.json({ error: 'Edificio no encontrado' }, { status: 404 })
    }

    // ── 2. EEFF de los últimos N meses ────────────────────────────
    const cutoff = new Date()
    cutoff.setMonth(cutoff.getMonth() - months)
    const cutoffStr = cutoff.toISOString().slice(0, 10)

    const { data: eeffRows } = await db
      .from('eeff_preliminar')
      .select('period_start, ingresos_total, gastos_total, utilidad_neta, margen_pct, gastos_personal, gastos_admin, gastos_mantenimiento, gastos_otros')
      .eq('building_id', building_id)
      .gte('period_start', cutoffStr)
      .order('period_start', { ascending: true })

    // ── 3. Mapear a FIEMonth[] ────────────────────────────────────
    const eeffMonths: FIEMonth[] = (eeffRows ?? []).map(row => {
      const d     = new Date(row.period_start)
      const label = `${MONTH_NAMES[d.getMonth()]} ${d.getFullYear()}`
      const ing   = Number(row.ingresos_total ?? 0)
      const gas   = Number(row.gastos_total   ?? 0)
      const util  = Number(row.utilidad_neta  ?? ing - gas)
      const marg  = Number(row.margen_pct     ?? (ing > 0 ? (util / ing) * 100 : 0))
      return { month: label, ingresos: ing, gastos: gas, utilidad: util, margen: Number(marg.toFixed(1)) }
    })

    // ── 4. Cost breakdown (promedio de los meses disponibles) ─────
    const avgOf = (key: keyof typeof eeffRows[0]) => {
      if (!eeffRows?.length) return 0
      const sum = eeffRows.reduce((s, r) => s + Number(r[key] ?? 0), 0)
      return Number((sum / eeffRows.length).toFixed(2))
    }

    const costBreakdown = {
      salarios:   avgOf('gastos_personal'),
      css:        0, // no está desglosado en eeff_preliminar — IF puede editar
      honorarios: 0,
      viaticos:   0,
      servicios:  avgOf('gastos_admin'),
      stack:      170, // default conocido
      otros:      avgOf('gastos_otros'),
    }

    // Si gastos_personal es 0 (tabla vacía), usar defaults FPHs
    if (costBreakdown.salarios === 0 && eeffMonths.length === 0) {
      Object.assign(costBreakdown, {
        salarios:   5666,
        css:        955,
        honorarios: 6175,
        viaticos:   625,
        servicios:  1249,
        stack:      170,
      })
    }

    // ── 5. Calcular base_income y base_ops del período ────────────
    const baseIncome = eeffMonths.length > 0
      ? Number((eeffMonths.reduce((s, m) => s + m.ingresos, 0) / eeffMonths.length).toFixed(2))
      : FPHs_DEFAULTS.base_income

    const baseOps = eeffMonths.length > 0
      ? Number((eeffMonths.reduce((s, m) => s + m.gastos, 0) / eeffMonths.length).toFixed(2))
      : FPHs_DEFAULTS.base_ops

    // ── 6. Armar period_label ─────────────────────────────────────
    let periodLabel = ''
    if (eeffMonths.length >= 2) {
      periodLabel = `${eeffMonths[0].month}–${eeffMonths[eeffMonths.length - 1].month}`
    } else if (eeffMonths.length === 1) {
      periodLabel = eeffMonths[0].month
    } else {
      const now = new Date()
      periodLabel = `${MONTH_NAMES[now.getMonth()]} ${now.getFullYear()}`
    }

    // ── 7. Componer FIESchema ─────────────────────────────────────
    const schema: FIESchema = {
      ...emptyFIESchema(building.name),
      period_label:   periodLabel,
      generated_at:   new Date().toISOString(),
      currency:       'USD',
      eeff_months:    eeffMonths,
      cost_breakdown: costBreakdown,
      base_income:    baseIncome,
      base_ops:       baseOps,
      cost_per_new_ph:      FPHs_DEFAULTS.cost_per_new_ph,
      labor_res_monthly:    FPHs_DEFAULTS.labor_res_monthly,
      contingency_monthly:  FPHs_DEFAULTS.contingency_monthly,
      historic_liability:   FPHs_DEFAULTS.historic_liability,
      scenarios:      FIE_DEFAULT_SCENARIOS,
    }

    return NextResponse.json({
      schema,
      source: 'supabase',
      months_loaded: eeffMonths.length,
      raw_preview: `${building.name} · ${eeffMonths.length} meses cargados desde Supabase ForumPHs`,
    })

  } catch (err: unknown) {
    console.error('[fie/supabase]', err)
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Error cargando datos' },
      { status: 500 }
    )
  }
}
