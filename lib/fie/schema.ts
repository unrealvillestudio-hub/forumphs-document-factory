// ── FIE Schema v1.0 — Financial Intelligence Engine
// ForumPHs · Document Factory · 2026-05-22

export interface FIEMonth {
  month: string      // "Ene 2026"
  ingresos: number
  gastos: number
  utilidad: number
  margen: number     // porcentaje, ej: 19.8
}

export interface FIECostBreakdown {
  salarios:    number
  css:         number   // Caja Seguro Social (CSS)
  honorarios:  number
  viaticos:    number
  servicios:   number   // honorarios servicios + facturas
  stack:       number
  otros?:      number
}

export interface FIEScenario {
  label:        string  // "Conservador" | "Moderado" | "Óptimo"
  new_phs:      number
  ph_fee:       number  // tarifa mensual por PH nuevo
  ph_month:     number  // mes en que entran (1-12)
  color:        string  // hex
}

export interface FIESchema {
  // ── Metadata
  building_name:  string     // "ForumPHs — Consolidado"
  period_label:   string     // "Enero–Febrero 2026"
  generated_at:   string     // ISO date
  currency:       'USD'

  // ── EEFF mensual
  eeff_months:    FIEMonth[]

  // ── Desglose de costos (promedio o último mes)
  cost_breakdown: FIECostBreakdown

  // ── Constantes de simulación
  base_income:          number   // ingresos mensuales actuales totales
  base_ops:             number   // gastos operativos base (sin nuevos PHs)
  cost_per_new_ph:      number   // costo incremental por nuevo PH
  labor_res_monthly:    number   // reservas laborales mensuales
  contingency_monthly:  number
  historic_liability:   number   // pasivo laboral histórico total

  // ── Escenarios (opcionales — defaults si no vienen del normalizer)
  scenarios?: FIEScenario[]

  // ── Narrativa generada por Claude (se llena en generate)
  narrative?: {
    panel_01?: string
    panel_02?: string
    panel_03?: string
    panel_04?: string
    panel_05?: string
    panel_06?: string
  }
}

// ── ForumPHs defaults (consolida los 8 PHs actuales)
export const FPHs_DEFAULTS = {
  base_income:         17307.50,
  base_ops:            14669.00,
  cost_per_new_ph:     1300.00,
  labor_res_monthly:   1014.89,
  contingency_monthly: 500.00,
  historic_liability:  25000.00,
} as const

export const FIE_DEFAULT_SCENARIOS: FIEScenario[] = [
  { label: 'Conservador', new_phs: 0, ph_fee: 0,    ph_month: 1,  color: '#6B6460' },
  { label: 'Moderado',    new_phs: 2, ph_fee: 2500,  ph_month: 3,  color: '#5C3472' },
  { label: 'Óptimo',      new_phs: 4, ph_fee: 3000,  ph_month: 3,  color: '#C4622D' },
]

// ── Empty schema template (para el normalizer)
export function emptyFIESchema(building_name = ''): FIESchema {
  return {
    building_name,
    period_label:  '',
    generated_at:  new Date().toISOString(),
    currency:      'USD',
    eeff_months:   [],
    cost_breakdown: {
      salarios:   0,
      css:        0,
      honorarios: 0,
      viaticos:   0,
      servicios:  0,
      stack:      0,
    },
    ...FPHs_DEFAULTS,
    scenarios: FIE_DEFAULT_SCENARIOS,
  }
}

// ── Helpers
export function calcSummary(schema: FIESchema) {
  const months = schema.eeff_months
  if (!months.length) return null
  const totalIngresos = months.reduce((s, m) => s + m.ingresos, 0)
  const totalGastos   = months.reduce((s, m) => s + m.gastos,   0)
  const totalUtilidad = months.reduce((s, m) => s + m.utilidad, 0)
  const avgMargen     = months.reduce((s, m) => s + m.margen,   0) / months.length
  const totalCosts    = Object.values(schema.cost_breakdown).reduce((s, v) => s + (v ?? 0), 0)
  return { totalIngresos, totalGastos, totalUtilidad, avgMargen, totalCosts }
}
