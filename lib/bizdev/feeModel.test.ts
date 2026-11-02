/**
 * Casos obligatorios de BRIEF_DF_BizDev_2026-11-02.md §2 (modelo v1.1), tolerancia ±0.01.
 * Corre con `npm test` (tsx --test).
 *
 * P es una copia de la fila v1.1 de public.fphs_fee_params (semilla de
 * supabase/migrations/04_bizdev.sql) pasada por normalizeParams, como en producción.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { calcular, normalizeParams, tierPorPrecio, type PersonalExtra } from './feeModel'
import { buildLetter } from './proposal'

const P = normalizeParams({
  version: 'v1.1', valid_from: '2026-11-02',
  costo_total: 18921.60, m2_total: 149043.44, u_total: 1327, personas_total: 9,
  peso_m2: 0.5, piso_personas: 0.5, cap_unidades: 132, cap_m2: 11909,
  salario_std: 900, carga_planilla: 0.375, itbms: 0.07,
  margenes: [0.25, 0.30, 0.35, 0.40],
  tiers: { unidades: [150, 280], m2: [15000, 25000], precio: [1200, 2500, 4500] },
})

const near = (actual: number[], expected: number[]) => {
  assert.equal(actual.length, expected.length)
  actual.forEach((a, i) =>
    assert.ok(Math.abs(a - expected[i]) <= 0.01, `índice ${i}: ${a.toFixed(4)} ≠ ${expected[i]}`))
}

const planilla = (personas: number, salario: number): PersonalExtra => ({ personas, salario, tipo: 'planilla' })

test('Plaza 77 — sin personal agregado (escenario A)', () => {
  const r = calcular(P, { u: 60, m2: 7065.19, casas: false })
  near(r.honorarios, [1401.60, 1501.71, 1617.23, 1752.00])
  assert.ok(Math.abs(r.mixto - 876.24) <= 0.01, `mixto ${r.mixto}`)
  assert.ok(r.pisoAplica)
  assert.ok(Math.abs(r.base - 1051.20) <= 0.01)
  assert.equal(r.incluidas, 0.5)
  assert.equal(r.tierUnidades, 1); assert.equal(r.tierM2, 1); assert.equal(r.tierPrecioBase, 1)
})

test('Plaza 77 — +0.5 a $900 en planilla (escenario B)', () => {
  const r = calcular(P, { u: 60, m2: 7065.19, casas: false, extra: [planilla(0.5, 900)] })
  near(r.honorarios, [2226.60, 2385.64, 2569.15, 2783.25])
})

test('Plaza 77 — +1.0 a $900 en planilla (escenario C)', () => {
  const r = calcular(P, { u: 60, m2: 7065.19, casas: false, extra: [planilla(1, 900)] })
  near(r.honorarios, [3051.60, 3269.57, 3521.08, 3814.50])
})

test('Plaza 77 — +0.5 a $900 y +1.0 a $1,100, ambos en planilla (escenario D)', () => {
  const r = calcular(P, { u: 60, m2: 7065.19, casas: false, extra: [planilla(0.5, 900), planilla(1, 1100)] })
  near(r.honorarios, [4243.27, 4546.36, 4896.08, 5304.08])
  assert.equal(r.extraPersonas, 1.5)
})

test('servicios profesionales no llevan carga patronal', () => {
  const r = calcular(P, { u: 60, m2: 7065.19, casas: false, extra: [{ personas: 1, salario: 900, tipo: 'servicios' }] })
  near([r.extraCosto], [900])
})

test('ITBMS al 30 %: $1,501.71 + $105.12 = $1,606.83', () => {
  const r = calcular(P, { u: 60, m2: 7065.19, casas: false })
  near([r.honorarios[1] * P.itbms, r.conItbms[1]], [105.12, 1606.83])
})

test('personal incluido por PH de la cartera (pasos de 0.5)', () => {
  const casos: [string, number, number, boolean, number][] = [
    ['Torres de Castilla', 312, 24564.04, false, 2.5],
    ['Venezia', 182, 15991.31, false, 1.5],
    ['Luxor', 143, 20796.55, false, 1.5],
    ['Lefevre', 184, 16079.29, false, 1.5],
    ['Alamos', 274, 0, true, 2.0],
    ['Firenze', 80, 8733, false, 0.5],
    ['P.España', 70, 5117.96, false, 0.5],
    ['P.Central', 82, 3987.2, false, 0.5],
  ]
  for (const [ph, u, m2, casas, esperado] of casos) {
    assert.equal(calcular(P, { u, m2, casas }).incluidas, esperado, ph)
  }
})

test('PH de casas ignora los m² (peso_m2 = 0)', () => {
  const a = calcular(P, { u: 274, m2: 53774.09, casas: true })
  const b = calcular(P, { u: 274, m2: 0, casas: true })
  near(a.honorarios, b.honorarios)
  assert.equal(a.tierM2, null)
})

test('tiers por precio y fronteras', () => {
  assert.equal(tierPorPrecio(P, 1199.99), 0)
  assert.equal(tierPorPrecio(P, 1200), 1)
  assert.equal(tierPorPrecio(P, 2500), 2)
  assert.equal(tierPorPrecio(P, 4500), 3)
  assert.equal(calcular(P, { u: 279, m2: 24999, casas: false }).tierUnidades, 2)
  assert.equal(calcular(P, { u: 280, m2: 25000, casas: false }).tierUnidades, 3)
  assert.equal(calcular(P, { u: 280, m2: 25000, casas: false }).tierM2, 2)
  assert.equal(calcular(P, { u: 280, m2: 25000.01, casas: false }).tierM2, 3)
})

test('normalizeParams falla en voz alta con datos inválidos', () => {
  assert.throws(() => normalizeParams({ version: 'x', costo_total: 'abc' }), /costo_total/)
})

test('carta: sin margen ni costos ni personal incluido; personal agregado como línea propia', () => {
  const r = calcular(P, { u: 60, m2: 7065.19, casas: false, extra: [planilla(0.5, 900)] })
  const txt = buildLetter({ ph: 'P.H. Plaza 77', u: 60, m2: 7065.19, casas: false, result: r, sel: 1, itbms: P.itbms }, P)
  assert.match(txt, /Personal adicional a solicitud de la Junta: 0\.5 persona/)
  assert.match(txt, /\$1,501\.71/)
  assert.doesNotMatch(txt, /margen/i)
  assert.doesNotMatch(txt, /costo (base|total|directo|del PH)|carga patronal|1,051\.20|900/i)
  assert.doesNotMatch(txt, /incluid[oa] en el precio/i)
  const sinExtra = buildLetter({ ph: 'P.H. Plaza 77', u: 60, m2: 7065.19, casas: false,
    result: calcular(P, { u: 60, m2: 7065.19, casas: false }), sel: 1, itbms: P.itbms }, P)
  assert.match(sinExtra, /ITBMS \(7 %\): \$105\.12/)
  assert.match(sinExtra, /Total mensual: \$1,606\.83/)
  assert.doesNotMatch(sinExtra, /Personal adicional/)
})

// ── v1.2 (2026-11-02): + $50 fijos por PH (servicio de carga de planillas, informado por Ivette) ──
const P12 = normalizeParams({ ...P, version: 'v1.2', costo_por_ph: 50 } as unknown as Record<string, unknown>)

test('v1.1 sin columna costo_por_ph equivale a 0', () => {
  assert.equal(P.costo_por_ph, 0)
})

test('v1.2 — Plaza 77 con $50 por PH, escenarios A y D', () => {
  const a = calcular(P12, { u: 60, m2: 7065.19, casas: false })
  near(a.honorarios, [1468.27, 1573.14, 1694.15, 1835.33])
  near(a.honorariosBase, a.honorarios)
  near([a.costo], [1101.20])
  const d = calcular(P12, { u: 60, m2: 7065.19, casas: false, extra: [planilla(0.5, 900), planilla(1, 1100)] })
  near(d.honorarios, [4309.93, 4617.79, 4973.00, 5387.42])
})

test('v1.2 — carta al 30 %: $1,573.14 + ITBMS $110.12 = $1,683.26, sin mencionar el costo por PH', () => {
  const r = calcular(P12, { u: 60, m2: 7065.19, casas: false })
  const txt = buildLetter({ ph: 'P.H. Plaza 77', u: 60, m2: 7065.19, casas: false, result: r, sel: 1, itbms: P12.itbms }, P12)
  assert.match(txt, /Honorario mensual de administración: \$1,573\.14/)
  assert.match(txt, /ITBMS \(7 %\): \$110\.12/)
  assert.match(txt, /Total mensual: \$1,683\.26/)
  assert.doesNotMatch(txt, /planilla|\$50\b/i)
})

test('costo_por_ph negativo falla en voz alta', () => {
  assert.throws(() => normalizeParams({ ...P, costo_por_ph: -1 } as unknown as Record<string, unknown>), /costo_por_ph/)
})
