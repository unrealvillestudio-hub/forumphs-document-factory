/**
 * feeModel.ts — Fee-Calculator ForumPHs: cálculo del honorario mensual de un PH.
 *
 * Funciones PURAS, sin I/O. Es la única implementación del modelo: la usan la
 * Calculadora (cliente) y /api/bizdev/quotes (servidor, que recalcula antes de guardar).
 *
 * Contrato: modelo v1.1 (Drive Sales-Kit/Fee-Calculator/Fee-Calculator_modelo_v1.1_2026-11-02.md)
 * y BRIEF_DF_BizDev_2026-11-02.md §2. Los parámetros NO viven aquí: son datos versionados
 * en unrlvl-db → public.fphs_fee_params, y llegan como argumento.
 *
 *   cm2     = costo_total / m2_total
 *   cu      = costo_total / u_total
 *   persona = costo_total / personas_total
 *   mixto   = peso_m2·cm2·m2 + (1−peso_m2)·cu·u          (PH de casas → peso_m2 = 0)
 *   base    = max(mixto, piso·persona)
 *   personas_calc = max(u/cap_unidades, m2/cap_m2, piso)  (en casas, sin el término de m²)
 *   incluidas     = max(piso, round(personas_calc·2)/2)
 *   costo_persona = salario·(1 + carga) en planilla · salario en servicios profesionales
 *   costo_por_ph  = costo directo fijo por cada PH administrado (p. ej. servicio de carga de planillas;
 *                   0 en v1.1, $50 desde v1.2)
 *   honorario(m)  = (base + costo_por_ph + Σ extra) / (1 − m)
 */

export interface TierThresholds {
  /** [a, b] → < a Esencial · < b Profesional · ≥ b Élite */
  unidades: [number, number]
  /** [a, b] → < a Esencial · ≤ b Profesional · > b Élite */
  m2: [number, number]
  /** [p, a, b] → < p bajo piso · < a Esencial · < b Profesional · ≥ b Élite */
  precio: [number, number, number]
}

export interface FeeParams {
  version: string
  valid_from?: string
  costo_total: number
  m2_total: number
  u_total: number
  personas_total: number
  peso_m2: number
  piso_personas: number
  cap_unidades: number
  cap_m2: number
  salario_std: number
  carga_planilla: number
  itbms: number
  /** Costo directo fijo por cada PH administrado (US$/mes). 0 si la versión no lo define. */
  costo_por_ph: number
  margenes: number[]
  tiers: TierThresholds
  fuente?: string
}

export type Contratacion = 'planilla' | 'servicios'

export interface PersonalExtra {
  personas: number
  salario: number
  tipo: Contratacion
}

export interface FeeInput {
  u: number
  m2: number
  casas: boolean
  extra?: PersonalExtra[]
}

/** 0 = bajo el piso, 1 = Esencial, 2 = Profesional, 3 = Élite */
export type Tier = 0 | 1 | 2 | 3
export const TIER_NOMBRES: Record<Tier, string> = {
  0: 'Bajo el piso',
  1: 'Esencial',
  2: 'Profesional',
  3: 'Élite',
}

export interface FeeResult {
  params_version: string
  cm2: number
  cu: number
  costoPersona: number
  mixto: number
  costoPiso: number
  base: number
  pisoAplica: boolean
  parteM2: number
  parteUnidades: number
  personasCalc: number
  incluidas: number
  costoIncluidas: number
  costoPorPh: number
  extraCosto: number
  extraPersonas: number
  costo: number
  margenes: number[]
  /** Honorario sin personal agregado, uno por margen. */
  honorariosBase: number[]
  /** Honorario con personal agregado, uno por margen. */
  honorarios: number[]
  /** Honorario con personal agregado + ITBMS, uno por margen. */
  conItbms: number[]
  tierUnidades: Tier
  tierM2: Tier | null
  /** Tier por el precio base al margen de referencia (el segundo de la lista: 30 % en v1.1). */
  tierPrecioBase: Tier
  /** Perfil del PH: el mayor entre unidades y m². */
  tierPH: Tier
  avisos: string[]
}

/** Margen de referencia para el tier por precio y la tabla de cartera (30 % en v1.1). */
export const REF_MARGIN_INDEX = 1

const num = (x: unknown): number => {
  const n = typeof x === 'string' ? Number(x) : (x as number)
  return Number.isFinite(n) ? n : NaN
}

/** Normaliza una fila de fphs_fee_params tal como la devuelve PostgREST. Fail-loud. */
export function normalizeParams(row: Record<string, unknown>): FeeParams {
  const keys = ['costo_total', 'm2_total', 'u_total', 'personas_total', 'peso_m2', 'piso_personas',
    'cap_unidades', 'cap_m2', 'salario_std', 'carga_planilla', 'itbms'] as const
  const out: Record<string, number> = {}
  for (const k of keys) {
    const v = num(row[k])
    if (!Number.isFinite(v)) throw new Error(`fphs_fee_params.${k} inválido: ${String(row[k])}`)
    out[k] = v
  }
  // costo_por_ph: columna añadida en 05_bizdev_costo_por_ph.sql; ausente o nula (v1.1) = 0. Si existe, debe ser válida.
  const cph = row.costo_por_ph == null ? 0 : num(row.costo_por_ph)
  if (!(cph >= 0)) throw new Error(`fphs_fee_params.costo_por_ph inválido: ${String(row.costo_por_ph)}`)
  const margenes = Array.isArray(row.margenes) ? (row.margenes as unknown[]).map(num) : []
  if (!margenes.length || margenes.some(m => !(m >= 0 && m < 1))) {
    throw new Error(`fphs_fee_params.margenes inválido: ${JSON.stringify(row.margenes)}`)
  }
  const t = row.tiers as Partial<TierThresholds> | null
  const ok2 = (a: unknown) => Array.isArray(a) && a.length === 2 && a.every(x => Number.isFinite(num(x)))
  const ok3 = (a: unknown) => Array.isArray(a) && a.length === 3 && a.every(x => Number.isFinite(num(x)))
  if (!t || !ok2(t.unidades) || !ok2(t.m2) || !ok3(t.precio)) {
    throw new Error(`fphs_fee_params.tiers inválido: ${JSON.stringify(row.tiers)}`)
  }
  return {
    version: String(row.version),
    valid_from: row.valid_from ? String(row.valid_from) : undefined,
    ...(out as unknown as Omit<FeeParams, 'version' | 'margenes' | 'tiers' | 'costo_por_ph'>),
    costo_por_ph: cph,
    margenes,
    tiers: {
      unidades: t.unidades!.map(num) as [number, number],
      m2: t.m2!.map(num) as [number, number],
      precio: t.precio!.map(num) as [number, number, number],
    },
    fuente: row.fuente ? String(row.fuente) : undefined,
  }
}

export function tierPorUnidades(p: FeeParams, u: number): Tier {
  const [a, b] = p.tiers.unidades
  return u < a ? 1 : u < b ? 2 : 3
}

export function tierPorM2(p: FeeParams, m2: number): Tier {
  const [a, b] = p.tiers.m2
  return m2 < a ? 1 : m2 <= b ? 2 : 3
}

export function tierPorPrecio(p: FeeParams, fee: number): Tier {
  const [piso, a, b] = p.tiers.precio
  return fee < piso ? 0 : fee < a ? 1 : fee < b ? 2 : 3
}

export function costoPersona(p: FeeParams, salario: number, tipo: Contratacion): number {
  return salario * (tipo === 'servicios' ? 1 : 1 + p.carga_planilla)
}

export function calcular(p: FeeParams, input: FeeInput): FeeResult {
  const u = Math.max(0, input.u || 0)
  const casas = !!input.casas
  const m2 = casas ? 0 : Math.max(0, input.m2 || 0)
  const extra = (input.extra ?? []).filter(r => r.personas > 0 && r.salario > 0)

  const cm2 = p.costo_total / p.m2_total
  const cu = p.costo_total / p.u_total
  const persona = p.costo_total / p.personas_total
  const w = casas ? 0 : p.peso_m2

  const parteM2 = w * cm2 * m2
  const parteUnidades = (1 - w) * cu * u
  const mixto = parteM2 + parteUnidades
  const costoPiso = p.piso_personas * persona
  const base = Math.max(mixto, costoPiso)

  const personasCalc = Math.max(u / p.cap_unidades, casas ? 0 : m2 / p.cap_m2, p.piso_personas)
  const incluidas = Math.max(p.piso_personas, Math.round(personasCalc * 2) / 2)
  const cpStd = costoPersona(p, p.salario_std, 'planilla')

  const extraCosto = extra.reduce((s, r) => s + r.personas * costoPersona(p, r.salario, r.tipo), 0)
  const extraPersonas = extra.reduce((s, r) => s + r.personas, 0)
  const costoPorPh = p.costo_por_ph ?? 0
  const costo = base + costoPorPh + extraCosto

  const honorariosBase = p.margenes.map(m => (base + costoPorPh) / (1 - m))
  const honorarios = p.margenes.map(m => costo / (1 - m))
  const conItbms = honorarios.map(h => h * (1 + p.itbms))

  const refIdx = Math.min(REF_MARGIN_INDEX, p.margenes.length - 1)
  const tierUnidades = tierPorUnidades(p, u)
  const tierM2 = casas ? null : tierPorM2(p, m2)
  const tierPrecioBase = tierPorPrecio(p, honorariosBase[refIdx])
  const tierPH = Math.max(tierUnidades, tierM2 ?? 1) as Tier

  const usd = (n: number) => n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
  const pct = (m: number) => `${Math.round(m * 100)} %`
  const avisos: string[] = []
  if (costoPiso > mixto) {
    avisos.push(`Se aplica el piso de ${p.piso_personas} personas: el costo por fórmula ($${usd(mixto)}) queda por debajo del mínimo viable ($${usd(costoPiso)}).`)
  }
  if (tierPrecioBase > 0 && tierPrecioBase !== tierPH) {
    avisos.push(`El precio base al ${pct(p.margenes[refIdx])} cae en ${TIER_NOMBRES[tierPrecioBase]}, pero el perfil del PH es ${TIER_NOMBRES[tierPH]}. Revisa con qué tier se presenta.`)
  }
  if (extraCosto > 0 && tierPorPrecio(p, honorarios[refIdx]) > tierPrecioBase) {
    avisos.push(`Con el personal agregado, el honorario al ${pct(p.margenes[refIdx])} sale del rango de su tier (${TIER_NOMBRES[tierPrecioBase]}). Preséntalo como tier ${TIER_NOMBRES[tierPrecioBase]} más personal adicional a solicitud de la Junta.`)
  }
  if (!casas && u > 0 && m2 / u > 400) {
    avisos.push('Más de 400 m² por unidad: si es un PH de casas, usa la superficie construida o marca «PH de casas».')
  }

  return {
    params_version: p.version,
    cm2, cu, costoPersona: cpStd, mixto, costoPiso, base, pisoAplica: costoPiso > mixto,
    parteM2, parteUnidades, personasCalc, incluidas, costoIncluidas: incluidas * cpStd,
    costoPorPh, extraCosto, extraPersonas, costo,
    margenes: [...p.margenes], honorariosBase, honorarios, conItbms,
    tierUnidades, tierM2, tierPrecioBase, tierPH, avisos,
  }
}

/** Redondeo a centavos para persistir y para la carta. */
export const cents = (n: number) => Math.round(n * 100) / 100
