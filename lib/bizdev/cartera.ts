/**
 * cartera.ts — Cartera actual de ForumPHs para la tabla de referencia de la Calculadora.
 *
 * FUENTE: prototipo funcional del Fee-Calculator (artifact privado de Sam, 2026-11-02) y modelo v1.1
 * (Drive Sales-Kit/Fee-Calculator). PH por nombre corto (Sam, 2026-11-02, «por ahora»).
 * Confidencial: honorarios actuales. El tab es interno (SSO de Vercel).
 *
 * Deuda declarada: es una instantánea en código. Si la tabla se vuelve operativa, pasa a datos
 * (forumphs-db, donde viven los PH clientes) en un PR propio.
 */
export interface PHCartera {
  nombre: string
  unidades: number
  /** m² privados; en PH de casas, m² de lote (no se usan en el cálculo). */
  m2: number
  casas: boolean
  /** Honorario mensual que cobra hoy, sin ITBMS. */
  cobraHoy: number
  /** Personal equivalente a tiempo completo asignado hoy. */
  personalHoy: number
}

export const CARTERA: readonly PHCartera[] = [
  { nombre: 'Torres de Castilla', unidades: 312, m2: 24564.04, casas: false, cobraHoy: 3700,   personalHoy: 2.0 },
  { nombre: 'Venezia',            unidades: 182, m2: 15991.31, casas: false, cobraHoy: 3300,   personalHoy: 1.9 },
  { nombre: 'Luxor',              unidades: 143, m2: 20796.55, casas: false, cobraHoy: 3100,   personalHoy: 2.0 },
  { nombre: 'Lefevre',            unidades: 184, m2: 16079.29, casas: false, cobraHoy: 2407.5, personalHoy: 1.0 },
  { nombre: 'Alamos',             unidades: 274, m2: 53774.09, casas: true,  cobraHoy: 2000,   personalHoy: 1.0 },
  { nombre: 'Firenze',            unidades: 80,  m2: 8733,     casas: false, cobraHoy: 1200,   personalHoy: 0.57 },
  { nombre: 'P.España',           unidades: 70,  m2: 5117.96,  casas: false, cobraHoy: 1000,   personalHoy: 0.1 },
  { nombre: 'P.Central',          unidades: 82,  m2: 3987.2,   casas: false, cobraHoy: 600,    personalHoy: 0.34 },
]
