/**
 * insights.ts — Contactos para seguimiento y análisis de correos en BizDev (funciones puras).
 *
 * Tablas: fphs_prospect_contacts, fphs_prospect_insights y fphs_prospect_actions
 * (supabase/migrations/08_bizdev_analisis_de_correos.sql). Las escribe unrlvl-communications-services
 * por fphs_bizdev_ingest(); el Document Factory solo registra contactos y decide acciones.
 * Este archivo no lee ningún buzón: valida y ordena lo que ya está en la base.
 */

export type TipoContacto = 'email' | 'dominio'
export type EstadoAccion = 'pendiente' | 'aprobada' | 'descartada'

export interface Contacto {
  id: string; prospect_id: string; tipo: TipoContacto; valor: string; rol: string | null; created_at: string
  // 09_bizdev_historial_archivo_prueba.sql: estado de la revisión del historial del contacto.
  historial_estado?: 'en_curso' | 'completado' | 'error' | null
  historial_solicitado_el?: string | null; historial_terminado_el?: string | null
  historial_resultado?: Record<string, unknown> | null
}
export interface Insight {
  id: string; prospect_id: string; comm_id: string | null; origen: string; interpretacion: string
  temperatura: 'frio' | 'tibio' | 'caliente' | null; objeciones: string[]; generado_por: string | null; created_at: string
}
export interface Accion {
  id: string; prospect_id: string; insight_id: string | null; accion: string; fecha_sugerida: string | null
  prioridad: 'alta' | 'media' | 'baja'; estado: EstadoAccion; decidida_el: string | null; created_at: string
}

const EMAIL = /^[^@\s]+@[^@\s]+\.[^@\s]+$/
const DOMINIO = /^[a-z0-9-]+(\.[a-z0-9-]+)*\.[a-z]{2,}$/

/**
 * Normaliza y valida un contacto con las mismas reglas que los CHECK de la migración 08,
 * para que el error llegue en la interfaz y no como un 400 de la base.
 * Un dominio puede escribirse como «@dominio.com»: se le quita la arroba inicial.
 */
export function normalizarContacto(tipo: string, valor: string): { tipo: TipoContacto; valor: string } {
  if (tipo !== 'email' && tipo !== 'dominio') throw new Error(`tipo de contacto inválido: ${tipo}`)
  let v = String(valor ?? '').trim().toLowerCase()
  if (tipo === 'dominio') v = v.replace(/^@/, '')
  if (!v) throw new Error('el contacto está vacío')
  if (tipo === 'email' && !EMAIL.test(v)) throw new Error(`correo inválido: ${v}`)
  if (tipo === 'dominio' && !DOMINIO.test(v)) throw new Error(`dominio inválido: ${v} (sin arroba ni espacios, p. ej. empresa.com)`)
  return { tipo, valor: v }
}

/**
 * Proveedores de correo personal: un dominio así no identifica a un prospecto, y como regla de
 * seguimiento haría pasar por «de este prospecto» los correos de cualquiera. Solo se avisa; Sam decide.
 */
export const DOMINIOS_PERSONALES = ['gmail.com', 'hotmail.com', 'outlook.com', 'yahoo.com', 'icloud.com', 'live.com', 'msn.com', 'aol.com', 'protonmail.com', 'proton.me']
export const esDominioPersonal = (dominio: string) => DOMINIOS_PERSONALES.includes(dominio.trim().toLowerCase().replace(/^@/, ''))

const PRIO: Record<string, number> = { alta: 0, media: 1, baja: 2 }
/** Acciones por decidir, de la más urgente a la menos: prioridad, luego fecha sugerida, luego antigüedad. */
export function pendientes(acciones: Accion[]): Accion[] {
  return acciones.filter(a => a.estado === 'pendiente').sort((a, b) =>
    (PRIO[a.prioridad] ?? 9) - (PRIO[b.prioridad] ?? 9)
    || (a.fecha_sugerida ?? '9999').localeCompare(b.fecha_sugerida ?? '9999')
    || a.created_at.localeCompare(b.created_at))
}

/** La lectura más reciente de un prospecto, o null. */
export const ultimaLectura = (insights: Insight[]): Insight | null =>
  insights.length ? [...insights].sort((a, b) => b.created_at.localeCompare(a.created_at))[0] : null

export const TEMPERATURA_LABEL: Record<string, string> = { frio: 'Frío', tibio: 'Tibio', caliente: 'Caliente' }

// ─── Revisión del historial de un contacto (09_bizdev_historial_archivo_prueba.sql) ───
/** Meses hacia atrás que revisa el servicio. Decisión de Sam, 2026-11-04. */
export const HISTORIAL_MESES = 12
/** Una revisión en curso sin aviso de fin después de este tiempo se da por perdida y se puede repetir. */
export const HISTORIAL_TIMEOUT_MIN = 30

export type EstadoHistorial = 'nunca' | 'en_curso' | 'sin_respuesta' | 'completado' | 'error'

const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : null)

/** Estado legible de la revisión del historial de un contacto. `ahora` en ms, para que sea puro. */
export function estadoHistorial(c: Contacto, ahora: number): { estado: EstadoHistorial; texto: string; puedeRevisar: boolean } {
  const r = c.historial_resultado ?? {}
  if (!c.historial_estado) return { estado: 'nunca', texto: 'Historial sin revisar.', puedeRevisar: true }
  if (c.historial_estado === 'en_curso') {
    const t = c.historial_solicitado_el ? Date.parse(c.historial_solicitado_el) : NaN
    const min = Number.isFinite(t) ? (ahora - t) / 60000 : Infinity
    if (min > HISTORIAL_TIMEOUT_MIN) {
      return { estado: 'sin_respuesta', texto: `El servicio no avisó el fin de la revisión (hace más de ${HISTORIAL_TIMEOUT_MIN} min). Puedes repetirla.`, puedeRevisar: true }
    }
    return { estado: 'en_curso', texto: `Revisando los últimos ${HISTORIAL_MESES} meses de correos con este contacto…`, puedeRevisar: false }
  }
  if (c.historial_estado === 'error') {
    return { estado: 'error', texto: `La revisión falló: ${String(r.error ?? 'sin detalle')}`, puedeRevisar: true }
  }
  const leidos = num(r.leidos); const asentados = num(r.asentados); const dup = num(r.duplicados)
  const base = [asentados != null ? `${asentados} registrado(s)` : null, leidos != null ? `de ${leidos} leído(s)` : null].filter(Boolean).join(' ')
  const partes = [base || null, dup ? `${dup} ya estaban registrados` : null].filter(Boolean).join('; ')
  const trunc = r.truncado === true ? ' Hubo más correos de los que caben en una revisión: repítela para seguir.' : ''
  return { estado: 'completado', texto: `Historial revisado${partes ? `: ${partes}` : ''}.${trunc}`, puedeRevisar: true }
}

// ─── Indicadores (Sam, 2026-11-04) ───
/** Un prospecto cuenta en los indicadores si no está archivado y no es de prueba. */
export const cuentaEnIndicadores = (p: { archivado_el?: string | null; es_prueba?: boolean | null }) =>
  !p.archivado_el && !p.es_prueba
