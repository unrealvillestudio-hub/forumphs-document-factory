// app/api/bi/data/route.ts
// Lee monthly_kpis + mora_mensual + eeff_preliminar desde Supabase ForumPHs
// tajuoqdbnsnzkhyqvdgs — cuenta IF

import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

const supabase = () => createClient(
  process.env.FPHS_SUPABASE_URL!,
  process.env.FPHS_SERVICE_KEY!,
  { auth: { persistSession: false } }
)

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url)
  const building_id = searchParams.get('building_id')
  const period      = searchParams.get('period') // YYYY-MM

  if (!building_id || !period) {
    return NextResponse.json({ error: 'building_id y period requeridos' }, { status: 400 })
  }

  const db = supabase()

  // Convertir period YYYY-MM a primer día del mes para comparar con date columns
  const periodDate = `${period}-01`

  try {
    // ── 1. Datos del edificio ─────────────────────────────────────
    const { data: building, error: bErr } = await db
      .from('buildings')
      .select('id, name, total_units, tier, tarifa_base, mora_pct_current, mora_fase_activa, recargo_activo, facturacion_mes')
      .eq('id', building_id)
      .single()

    if (bErr || !building) {
      return NextResponse.json({ error: 'Edificio no encontrado' }, { status: 404 })
    }

    // ── 2. KPIs del período ───────────────────────────────────────
    const { data: kpis } = await db
      .from('monthly_kpis')
      .select('*')
      .eq('building_id', building_id)
      .eq('period', periodDate)
      .maybeSingle()

    // ── 3. EEFF preliminar del período ────────────────────────────
    const { data: eeff } = await db
      .from('eeff_preliminar')
      .select('id, status, ingresos_total, gastos_total, utilidad_neta, margen_pct, mora_total, porcentaje_cobro, cpa_signed, cpa_signed_at, period_start, period_end')
      .eq('building_id', building_id)
      .gte('period_start', periodDate)
      .lt('period_start', `${period.slice(0,4)}-${String(parseInt(period.slice(5,7))+1).padStart(2,'0')}-01`)
      .maybeSingle()

    // ── 4. Mora por fases del período (conteo unidades) ───────────
    const { data: moraRows } = await db
      .from('mora_mensual')
      .select('fase, monto_pendiente')
      .eq('building_id', building_id)
      .eq('periodo', periodDate)

    // Agregación mora por fase
    const moraAgg = { AL_DIA: 0, FASE_I: 0, FASE_II: 0, FASE_III: 0, FASE_IV: 0 }
    let moraTotalCalc = 0
    ;(moraRows ?? []).forEach(r => {
      const fase = r.fase as keyof typeof moraAgg
      if (moraAgg[fase] !== undefined) moraAgg[fase]++
      moraTotalCalc += Number(r.monto_pendiente ?? 0)
    })

    // ── Componer respuesta BIData ─────────────────────────────────
    const unidadesTotales = building.total_units ?? 0
    const unidadesAlDia   = kpis?.unidades_al_dia  ?? (unidadesTotales - (moraRows?.length ?? 0))
    const unidadesMora    = kpis?.unidades_mora     ?? (moraRows?.length ?? 0)
    const recaudacionTotal = kpis?.monto_recaudado  ?? 0
    const cuotaEsperada    = kpis?.monto_esperado   ?? (building.tarifa_base ?? 0)
    const moraTotalFinal   = kpis ? (kpis.mora_fase_i_monto + kpis.mora_fase_ii_monto + kpis.mora_fase_iii_monto + kpis.mora_fase_iv_monto) : moraTotalCalc
    const recaudacionPct   = kpis?.porcentaje_cobro ?? (cuotaEsperada > 0 ? (recaudacionTotal / cuotaEsperada) * 100 : 0)
    const moraPct          = kpis?.mora_pct_total   ?? (unidadesTotales > 0 ? (unidadesMora / unidadesTotales) * 100 : 0)

    const response = {
      building_name: building.name,
      period,
      kpis: {
        recaudacion_pct:   Number(recaudacionPct.toFixed(2)),
        recaudacion_total: Number(recaudacionTotal),
        cuota_esperada:    Number(cuotaEsperada),
        mora_total:        Number(moraTotalFinal),
        mora_pct:          Number(moraPct.toFixed(2)),
        unidades_total:    unidadesTotales,
        unidades_al_dia:   unidadesAlDia,
        unidades_mora:     unidadesMora,
        fase_i:   kpis?.mora_fase_i_count  ?? moraAgg.FASE_I,
        fase_ii:  kpis?.mora_fase_ii_count ?? moraAgg.FASE_II,
        fase_iii: kpis?.mora_fase_iii_count ?? moraAgg.FASE_III,
        fase_iv:  kpis?.mora_fase_iv_count ?? moraAgg.FASE_IV,
        // Campos BI financiero (si hay eeff)
        ingresos_totales:  eeff ? Number(eeff.ingresos_total) : undefined,
        gastos_totales:    eeff ? Number(eeff.gastos_total)   : undefined,
        margen_operativo:  eeff ? Number(eeff.margen_pct)     : undefined,
      },
      // EEFF si existe
      eeff: eeff ? {
        status:   eeff.status ?? 'borrador',
        ingresos: Number(eeff.ingresos_total ?? 0),
        gastos:   Number(eeff.gastos_total   ?? 0),
        utilidad: Number(eeff.utilidad_neta  ?? 0),
        margen:   Number(eeff.margen_pct     ?? 0),
        period:   period,
        id:       eeff.id,
      } : undefined,
    }

    return NextResponse.json(response)

  } catch (err: unknown) {
    console.error('[bi/data]', err)
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Error interno' },
      { status: 500 }
    )
  }
}
