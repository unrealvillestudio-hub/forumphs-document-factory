/**
 * brief.ts — Brief de un prospecto en curso, armado con sus datos de unrlvl-db (función pura).
 *
 * Pedido de Sam (2026-11-03): «un brief actualizado de cada prospecto en curso: entradas
 * (mensajes del prospecto), respuestas que le hemos enviado y puntos clave de la actividad».
 *
 * Fuente: solo fphs_prospects, fphs_quotes y fphs_prospect_comms. Las entradas son las
 * comunicaciones con sentido 'recibido' que alguien registró en la ficha: ningún buzón se lee
 * (MAIL_PRIVACY_RULE.md). Si no se registran, el brief lo dice en vez de inventarlas.
 */

export interface BriefQuote {
  honorario: number; margen: number | null; estado: string; origen?: string | null
  created_at: string; enviada_el: string | null; params_version: string | null
}
export interface BriefComm { fecha: string; canal: string; sentido: string; resumen: string; origen: string }
export interface BriefProspect {
  code: string; short_name: string; full_name: string | null; etapa: string
  unidades: number | null; m2_privados: number | null; es_casas: boolean
  proxima_accion: string | null; proxima_fecha: string | null; notas: string | null
  quotes: BriefQuote[]; comms: BriefComm[]
}

export interface Brief {
  titulo: string
  claves: string[]
  entradas: BriefComm[]
  respuestas: BriefComm[]
  internas: BriefComm[]
  texto: string
}

const CANAL: Record<string, string> = {
  whatsapp: 'WhatsApp', correo: 'Correo', llamada: 'Llamada', reunion: 'Reunión', documento: 'Documento',
}
const ETAPA: Record<string, string> = {
  contacto: 'Contacto', levantamiento: 'Levantamiento', confidencialidad: 'Confidencialidad', cotizado: 'Cotizado',
  negociacion: 'Negociación', ganado: 'Ganado', perdido: 'Perdido', pausado: 'Pausado',
}
const usd = (n: number) => n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
const dia = (s: string) => s.slice(0, 10)
const diasEntre = (a: string, b: string) =>
  Math.round((Date.parse(`${dia(b)}T12:00:00Z`) - Date.parse(`${dia(a)}T12:00:00Z`)) / 864e5)

/** `hoy` en YYYY-MM-DD; se pasa como argumento para que la función sea pura y se pueda probar. */
export function buildBrief(p: BriefProspect, hoy: string): Brief {
  const comms = [...p.comms].sort((a, b) => b.fecha.localeCompare(a.fecha))
  const quotes = [...p.quotes].sort((a, b) => b.created_at.localeCompare(a.created_at))
  const entradas = comms.filter(c => c.sentido === 'recibido')
  const respuestas = comms.filter(c => c.sentido === 'enviado')
  const internas = comms.filter(c => c.sentido === 'interno')

  const claves: string[] = []
  claves.push(`Etapa: ${ETAPA[p.etapa] ?? p.etapa}.`)
  const tam = [p.unidades != null ? `${p.unidades} unidades` : null,
    p.es_casas ? 'PH de casas' : p.m2_privados != null ? `${usd(Number(p.m2_privados))} m² privados` : null].filter(Boolean)
  if (tam.length) claves.push(`Tamaño: ${tam.join(' · ')}.`)

  const enviadas = quotes.filter(q => q.estado !== 'borrador')
  if (enviadas.length) {
    const u = enviadas[0]
    const det = u.origen === 'manual' ? 'carta previa al modelo' : `modelo ${u.params_version ?? ''}, margen ${Math.round(Number(u.margen) * 100)} %`.trim()
    claves.push(`Última cotización enviada: $${usd(Number(u.honorario))} al mes más ITBMS (${det}), el ${dia(u.enviada_el ?? u.created_at)}.`)
    if (enviadas.length > 1) {
      claves.push(`Historial de cotizaciones: ${enviadas.slice().reverse().map(q => `$${usd(Number(q.honorario))} (${dia(q.enviada_el ?? q.created_at)})`).join(' → ')}.`)
    }
  } else {
    claves.push('Todavía no se le ha enviado ninguna cotización.')
  }
  const borradores = quotes.filter(q => q.estado === 'borrador')
  if (borradores.length) claves.push(`Borradores sin enviar: ${borradores.length} (el último de $${usd(Number(borradores[0].honorario))}).`)

  if (comms.length) {
    const d = diasEntre(comms[0].fecha, hoy)
    claves.push(`Último contacto: ${dia(comms[0].fecha)} (${CANAL[comms[0].canal] ?? comms[0].canal}), hace ${d} día(s).`)
  }
  if (entradas.length) claves.push(`Último mensaje del prospecto: ${dia(entradas[0].fecha)}.`)
  else claves.push('No hay mensajes del prospecto registrados: regístralos en la ficha con sentido «recibido».')
  if (p.proxima_accion || p.proxima_fecha) {
    const venc = !!p.proxima_fecha && p.proxima_fecha < hoy
    claves.push(`Próxima acción: ${p.proxima_accion ?? '—'}${p.proxima_fecha ? ` (${p.proxima_fecha}${venc ? ', VENCIDA' : ''})` : ''}.`)
  } else {
    claves.push('Sin próxima acción definida.')
  }
  if (p.notas) claves.push(`Notas: ${p.notas}`)

  const linea = (c: BriefComm) => `- ${dia(c.fecha)} · ${CANAL[c.canal] ?? c.canal}: ${c.resumen}`
  const bloque = (t: string, xs: BriefComm[], vacio: string) => [`${t}`, ...(xs.length ? xs.map(linea) : [`- ${vacio}`])].join('\n')
  const titulo = `${p.short_name} (${p.code})`
  const texto = [
    `BRIEF — ${titulo} · al ${hoy}`,
    '',
    'PUNTOS CLAVE',
    ...claves.map(k => `- ${k}`),
    '',
    bloque('ENTRADAS (mensajes del prospecto)', entradas, 'Ninguna registrada.'),
    '',
    bloque('RESPUESTAS (lo que le hemos enviado)', respuestas, 'Ninguna registrada.'),
    '',
    bloque('NOTAS INTERNAS', internas, 'Ninguna.'),
  ].join('\n')
  return { titulo, claves, entradas, respuestas, internas, texto }
}
