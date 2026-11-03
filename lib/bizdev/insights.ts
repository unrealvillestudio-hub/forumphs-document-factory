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

export interface Contacto { id: string; prospect_id: string; tipo: TipoContacto; valor: string; rol: string | null; created_at: string }
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
