/**
 * db.ts — SERVER-ONLY: acceso REST a unrlvl-db para el tab BizDev.
 *
 * Tablas: public.fphs_fee_params, fphs_prospects, fphs_quotes, fphs_prospect_comms
 * (supabase/migrations/04_bizdev.sql). RLS sin políticas: solo service_role las alcanza.
 * Env (las mismas que ya usan lib/server/ledger.ts y lib/processors/detectPlatform.ts):
 *   UNRLVL_SUPABASE_URL + unrlvl_service_role, sin NEXT_PUBLIC_. Nunca importar desde un
 *   Client Component: la clave no debe llegar al bundle del navegador.
 */

const SB_URL = process.env.UNRLVL_SUPABASE_URL ?? ''
const SB_KEY = process.env.unrlvl_service_role ?? ''

export class DbError extends Error {
  constructor(message: string, public status: number) { super(message) }
}

export async function sb<T = unknown>(path: string, init: RequestInit & { prefer?: string } = {}): Promise<T> {
  if (!SB_URL || !SB_KEY) {
    throw new DbError('UNRLVL_SUPABASE_URL/unrlvl_service_role ausentes en el entorno del servidor.', 500)
  }
  const { prefer, headers, ...rest } = init
  const res = await fetch(`${SB_URL}/rest/v1/${path}`, {
    ...rest,
    cache: 'no-store',
    headers: {
      apikey: SB_KEY,
      Authorization: `Bearer ${SB_KEY}`,
      'Content-Type': 'application/json',
      ...(prefer ? { Prefer: prefer } : {}),
      ...(headers ?? {}),
    },
  })
  const text = await res.text()
  if (!res.ok) {
    console.error(`[bizdev/db] ${init.method ?? 'GET'} ${path} → ${res.status}: ${text}`)
    throw new DbError(`unrlvl-db ${res.status}: ${text.slice(0, 300)}`, res.status >= 500 ? 502 : res.status)
  }
  return (text ? JSON.parse(text) : null) as T
}

/** Fila vigente de fphs_fee_params: la de valid_from más reciente. */
export async function currentParamsRow(): Promise<Record<string, unknown>> {
  const rows = await sb<Record<string, unknown>[]>('fphs_fee_params?select=*&order=valid_from.desc&limit=1')
  if (!rows?.length) throw new DbError('fphs_fee_params está vacía: no hay parámetros vigentes.', 500)
  return rows[0]
}

export const ETAPAS = ['contacto', 'levantamiento', 'confidencialidad', 'cotizado',
  'negociacion', 'ganado', 'perdido', 'pausado'] as const
export const CANALES = ['whatsapp', 'correo', 'llamada', 'reunion', 'documento'] as const
export const SENTIDOS = ['enviado', 'recibido', 'interno'] as const
export const ESTADOS_QUOTE = ['borrador', 'enviada', 'aceptada', 'rechazada'] as const

export function errorResponse(e: unknown) {
  const status = e instanceof DbError ? e.status : 400
  const message = e instanceof Error ? e.message : String(e)
  return Response.json({ error: message }, { status })
}
