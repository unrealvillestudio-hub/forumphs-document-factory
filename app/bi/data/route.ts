// app/bi/data/route.ts
// Lee monthly_kpis + mora_mensual + eeff_preliminar desde Supabase ForumPHs
// Usa fetch REST directo — sin @supabase/supabase-js (no está en package.json)

import { NextRequest, NextResponse } from 'next/server'

const FPHS_URL = process.env.FPHS_SUPABASE_URL || ''
const FPHS_KEY = process.env.FPHS_SERVICE_KEY    || ''

async function db(table: string, params: string) {
  const res = await fetch(`${FPHS_URL}/rest/v1/${table}?${params}`, {
    headers: {
      'apikey':        FPHS_KEY,
      'Authorization': `Bearer ${FPHS_KEY}`,
      'Content-Type':  'application/json',
    },
    cache: 'no-store',
  })
  if (!res.ok) {
    // fail-loud: no tragues el status. Un 401/403 (clave sin permiso) NO es "sin datos".
    const body = await res.text().catch(() => '(unreadable)')
    console.error(`[bi/data] ${table} query HTTP ${res.status}: ${body}`)
    return null
  }
  const text = await res.text()
  return text ? JSON.parse(text) : null
}

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url)
  const building_id = searchParams.get('building_id')
  const period      = searchParams.get('period') // YYYY-MM

  if (!building_id || !period) {
    return NextResponse.json({ error: 'building_id y period requeridos' }, { status: 400 })
  }
  if (!FPHS_URL || !FPHS_KEY) {
    return NextResponse.json({ error: 'FPHS_SUPABASE_URL / FPHS_SERVICE_KEY no configuradas' }, { status: 500 })
  }

  const periodDate = `${period}-01`
  const nextMonth  = (() => {
    const [y, m] = period.split('-').map(Number)
    return m === 12 ? `${y + 1}-01-01` : `${y}-${String(m + 1).padStart(2, '0')}-01`
  })()

  try {
    // 1. Edificio — fail-loud: distinguir id inexistente de RLS/clave sin service_role.
    // Consulta directa (no via db()) para capturar el status de PostgREST.
    const bRes = await fetch(
      `${FPHS_URL}/rest/v1/buildings?id=eq.${building_id}&select=id,name,total_units,tier,tarifa_base&limit=1`,
      { headers: { apikey: FPHS_KEY, Authorization: `Bearer ${FPHS_KEY}` }, cache: 'no-store' },
    )
    if (!bRes.ok) {
      const body = await bRes.text().catch(() => '(unreadable)')
      console.error(`[bi/data] buildings query FALLÓ: HTTP ${bRes.status} building_id=${building_id} — ${body}`)
      return NextResponse.json(
        { error: `Fallo consultando buildings (HTTP ${bRes.status}). Revisar FPHS_SERVICE_KEY / RLS — no es un id inexistente.`, building_id, postgrest_status: bRes.status },
        { status: 502 },
      )
    }
    const buildings = JSON.parse((await bRes.text()) || '[]')
    const building = buildings?.[0]
    if (!building) {
      // 200 + [] : o el id no existe, o RLS con clave sin service_role oculta la tabla entera.
      // Probe sin filtro para desambiguar.
      const probeRes = await fetch(`${FPHS_URL}/rest/v1/buildings?select=id&limit=1`,
        { headers: { apikey: FPHS_KEY, Authorization: `Bearer ${FPHS_KEY}` }, cache: 'no-store' })
      const probe = probeRes.ok ? JSON.parse((await probeRes.text()) || '[]') : null
      const tablaVisible = Array.isArray(probe) && probe.length > 0
      if (!tablaVisible) {
        console.error(`[bi/data] buildings devuelve 0 filas SIN filtro (probe HTTP ${probeRes.status}) building_id=${building_id}: RLS activo + FPHS_SERVICE_KEY sin service_role oculta la tabla entera.`)
        return NextResponse.json(
          { error: 'buildings no es visible con la clave actual (0 filas sin filtro). Causa probable: FPHS_SERVICE_KEY no es service_role y RLS bloquea la lectura. NO es un id inexistente.', building_id, probe_status: probeRes.status },
          { status: 502 },
        )
      }
      console.error(`[bi/data] building_id=${building_id} no existe (buildings visible, ${probe.length}+ filas sin filtro).`)
      return NextResponse.json({ error: 'Edificio no encontrado', building_id }, { status: 404 })
    }

    // 2. KPIs del período
    const kpisRows = await db('monthly_kpis',
      `building_id=eq.${building_id}&period=eq.${periodDate}&limit=1`)
    const kpis = kpisRows?.[0] ?? null

    // 3. EEFF preliminar
    const eeffRows = await db('eeff_preliminar',
      `building_id=eq.${building_id}&period_start=gte.${periodDate}&period_start=lt.${nextMonth}&select=id,status,ingresos_total,gastos_total,utilidad_neta,margen_pct,mora_total,porcentaje_cobro,cpa_signed,period_start&limit=1`)
    const eeff = eeffRows?.[0] ?? null

    // 4. Mora por fases
    const moraRows: { fase: string; monto_pendiente: number }[] = await db('mora_mensual',
      `building_id=eq.${building_id}&periodo=eq.${periodDate}&select=fase,monto_pendiente`) ?? []

    const moraAgg = { FASE_I: 0, FASE_II: 0, FASE_III: 0, FASE_IV: 0 }
    let moraTotalCalc = 0
    moraRows.forEach(r => {
      const k = r.fase as keyof typeof moraAgg
      if (moraAgg[k] !== undefined) moraAgg[k]++
      moraTotalCalc += Number(r.monto_pendiente ?? 0)
    })

    const total    = building.total_units ?? 0
    const alDia    = kpis?.unidades_al_dia  ?? (total - moraRows.length)
    const enMora   = kpis?.unidades_mora    ?? moraRows.length
    const recTotal = Number(kpis?.monto_recaudado ?? 0)
    const esperado = Number(kpis?.monto_esperado  ?? building.tarifa_base ?? 0)
    const moraTotal = kpis
      ? Number(kpis.mora_fase_i_monto ?? 0) + Number(kpis.mora_fase_ii_monto ?? 0) +
        Number(kpis.mora_fase_iii_monto ?? 0) + Number(kpis.mora_fase_iv_monto ?? 0)
      : moraTotalCalc
    const recPct  = kpis?.porcentaje_cobro  ?? (esperado > 0 ? (recTotal / esperado) * 100 : 0)
    const moraPct = kpis?.mora_pct_total    ?? (total > 0 ? (enMora / total) * 100 : 0)

    return NextResponse.json({
      building_name: building.name,
      period,
      kpis: {
        recaudacion_pct:   Number(Number(recPct).toFixed(2)),
        recaudacion_total: recTotal,
        cuota_esperada:    esperado,
        mora_total:        moraTotal,
        mora_pct:          Number(Number(moraPct).toFixed(2)),
        unidades_total:    total,
        unidades_al_dia:   alDia,
        unidades_mora:     enMora,
        fase_i:   kpis?.mora_fase_i_count  ?? moraAgg.FASE_I,
        fase_ii:  kpis?.mora_fase_ii_count ?? moraAgg.FASE_II,
        fase_iii: kpis?.mora_fase_iii_count ?? moraAgg.FASE_III,
        fase_iv:  kpis?.mora_fase_iv_count ?? moraAgg.FASE_IV,
        ingresos_totales: eeff ? Number(eeff.ingresos_total) : undefined,
        gastos_totales:   eeff ? Number(eeff.gastos_total)   : undefined,
        margen_operativo: eeff ? Number(eeff.margen_pct)     : undefined,
      },
      eeff: eeff ? {
        id:       eeff.id,
        status:   eeff.status ?? 'borrador',
        ingresos: Number(eeff.ingresos_total ?? 0),
        gastos:   Number(eeff.gastos_total   ?? 0),
        utilidad: Number(eeff.utilidad_neta  ?? 0),
        margen:   Number(eeff.margen_pct     ?? 0),
        period,
      } : undefined,
    })

  } catch (err: unknown) {
    console.error('[bi/data]', err)
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Error interno' },
      { status: 500 }
    )
  }
}
