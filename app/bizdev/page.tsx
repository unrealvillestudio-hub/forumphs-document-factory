'use client'

/**
 * /bizdev — Tab BizDev (interno, solo Sam): Dashboard de prospectos, Calculadora de honorarios y Propuesta.
 * Brief: Drive Sales-Kit/Fee-Calculator/BRIEF_DF_BizDev_2026-11-02.md (§5 y §0-bis).
 * Cálculo: lib/bizdev/feeModel.ts (única implementación). Parámetros: unrlvl-db → fphs_fee_params.
 * Look and feel: marca ForumPHs (brand.json → identity), igual que los tabs Actas, Informe BI y Suite FIE.
 * El prototipo del Fee-Calculator es referencia de función y cálculo, no de estilo.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  calcular, TIER_NOMBRES, REF_MARGIN_INDEX, tierPorPrecio,
  type FeeParams, type PersonalExtra, type Tier, type Contratacion,
} from '@/lib/bizdev/feeModel'
import { buildLetter, buildProposalDocx, letterAmounts } from '@/lib/bizdev/proposal'
import { CARTERA } from '@/lib/bizdev/cartera'
import { buildBrief } from '@/lib/bizdev/brief'
import {
  normalizarContacto, esDominioPersonal, pendientes, ultimaLectura, TEMPERATURA_LABEL,
  cuentaEnIndicadores, estadoHistorial,
  type Contacto, type Insight, type Accion,
} from '@/lib/bizdev/insights'

// ─── Tipos de datos (filas de unrlvl-db) ─────────────────────────
interface Quote {
  id: string; prospect_id: string; params_version: string | null; margen: number | null; origen?: string | null; unidades: number; m2: number
  es_casas: boolean; personal_incluido: number | null; personal_extra: PersonalExtra[]; costo_base: number | null
  honorario: number; honorario_itbms: number; estado: string; enviada_el: string | null
  doc_ref: string | null; created_at: string
}
interface Comm {
  id: string; prospect_id: string; fecha: string; canal: string; sentido: string; origen: string
  resumen: string; doc_ref: string | null; quote_id: string | null
}
interface Prospect {
  id: string; code: string; short_name: string; full_name: string | null; unidades: number | null
  m2_privados: number | null; es_casas: boolean; fuente_tamano: string | null; clase_evidencia: string | null
  etapa: string; contacto_nombre: string | null; contacto_rol: string | null; proxima_accion: string | null
  proxima_fecha: string | null; notas: string | null; created_at: string; updated_at: string
  quotes: Quote[]; comms: Comm[]
  // 08_bizdev_analisis_de_correos.sql. Opcionales: la API las trae siempre, pero una fila sin ellas no rompe la vista.
  contacts?: Contacto[]; insights?: Insight[]; actions?: Accion[]
  // 09_bizdev_historial_archivo_prueba.sql. Archivado o de prueba: fuera de los indicadores.
  archivado_el?: string | null; es_prueba?: boolean
}

// 'seg' = tab Seguimiento (Sam, 2026-11-07: «el apartado de seguimiento se me hace pequeño e incómodo; conviértelo en un tab aparte»).
type View = 'dashboard' | 'seg' | 'calc' | 'prop'

const ETAPAS: { key: string; label: string }[] = [
  { key: 'contacto', label: 'Contacto' }, { key: 'levantamiento', label: 'Levantamiento' },
  { key: 'confidencialidad', label: 'Confidencialidad' }, { key: 'cotizado', label: 'Cotizado' },
  { key: 'negociacion', label: 'Negociación' }, { key: 'ganado', label: 'Ganado' },
  { key: 'perdido', label: 'Perdido' }, { key: 'pausado', label: 'Pausado' },
]
const INACTIVAS = new Set(['ganado', 'perdido', 'pausado'])
const CANALES = ['whatsapp', 'correo', 'llamada', 'reunion', 'documento']
const CANAL_LABEL: Record<string, string> = {
  whatsapp: 'WhatsApp', correo: 'Correo', llamada: 'Llamada', reunion: 'Reunión', documento: 'Documento',
}
const SENTIDOS = ['enviado', 'recibido', 'interno']

// ─── Marca ForumPHs (brand.json → identity.palette) ─────────────
const C = {
  amatista: '#5C3472', amatistaLight: '#EAD9F5', terra: '#C4622D', terraLight: '#F5E0D4',
  carbon: '#1C2233', carbonDark: '#0E1018', parch: '#F0EDE8', cream: '#FAFAF7',
  // Contraste subido el 2026-11-03 (Sam: «más legible»): textos secundarios a ≥ 0.68 sobre carbón.
  muted: 'rgba(240,237,232,0.68)', faint: 'rgba(240,237,232,0.48)', line: 'rgba(92,52,114,0.4)',
  label: 'rgba(225,218,210,0.82)', danger: '#E07A5F', success: '#4FD8B8', gold: '#E8B86B',
  // Mint de acento (Sam, 2026-11-03: «utiliza un poco más el accent mint»): lo positivo, lo que entra del prospecto y el tier del PH.
  mint: '#4FD8B8', mintSoft: 'rgba(79,216,184,0.12)',
}
const MONO = "'Space Mono', ui-monospace, monospace"
const cinzel = (color: string = C.terra, size = 9): React.CSSProperties => ({
  fontFamily: "'Cinzel', serif", fontSize: `${size}px`, fontWeight: 600,
  letterSpacing: '0.22em', textTransform: 'uppercase', color,
})
const card: React.CSSProperties = {
  background: C.carbon, border: `1px solid ${C.line}`, borderRadius: '10px', padding: '20px', minWidth: 0,
}
const inputStyle: React.CSSProperties = {
  background: 'rgba(14,16,24,0.85)', border: `1px solid ${C.line}`, borderRadius: '6px',
  padding: '8px 12px', color: C.parch, fontSize: '13px', width: '100%', outline: 'none',
  fontFamily: "'DM Sans', sans-serif",
}
const numInput: React.CSSProperties = { ...inputStyle, fontFamily: MONO, fontSize: '14px' }
const label: React.CSSProperties = { ...cinzel(C.label, 8), display: 'block', marginBottom: '5px' }
const btn = (primary = true, enabled = true): React.CSSProperties => ({
  padding: '9px 16px', borderRadius: '6px', cursor: enabled ? 'pointer' : 'not-allowed',
  background: primary ? (enabled ? C.amatista : 'rgba(92,52,114,0.2)') : 'transparent',
  border: `1px solid ${primary ? 'rgba(92,52,114,0.6)' : C.line}`,
  ...cinzel(primary ? C.parch : C.amatistaLight, 9), opacity: enabled ? 1 : 0.5,
})

const usd = (n: number, d = 2) => n.toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d })
const hoyISO = () => new Date().toISOString().slice(0, 10)
const fmtFecha = (s: string | null) => s
  ? new Date(s.length === 10 ? `${s}T12:00:00` : s).toLocaleDateString('es-PA', { day: '2-digit', month: 'short', year: 'numeric' })
  : '—'
/** «30 %» para el modelo; «manual» para las cartas previas al modelo (07_bizdev_cotizaciones_manuales.sql). */
const margenDe = (q: Quote) => q.origen === 'manual' || q.margen == null ? 'manual' : `${Math.round(Number(q.margen) * 100)} %`
/** Última cotización que salió al prospecto (no cuenta borradores). */
const ultimaEnviada = (p: Prospect) => p.quotes.find(q => q.estado !== 'borrador')
const tierFromSize = (p: FeeParams, u: number, m2: number, casas: boolean): Tier =>
  calcular(p, { u, m2, casas }).tierPH

async function api<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, { ...init, headers: { 'Content-Type': 'application/json', ...(init?.headers ?? {}) } })
  const data = await res.json().catch(() => ({}))
  if (!res.ok || data.error) throw new Error(data.error ?? `HTTP ${res.status}`)
  return data as T
}

// ════════════════════════════════════════════════════════════════
export default function BizDevPage() {
  const [view, setView] = useState<View>('dashboard')
  const [params, setParams] = useState<FeeParams | null>(null)
  const [prospects, setProspects] = useState<Prospect[]>([])
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [fichaId, setFichaId] = useState<string | null>(null)

  // Calculadora
  const [prospectId, setProspectId] = useState<string>('')
  const [phName, setPhName] = useState('')
  const [u, setU] = useState(60)
  const [m2, setM2] = useState(7065.19)
  const [casas, setCasas] = useState(false)
  const [extra, setExtra] = useState<PersonalExtra[]>([])
  const [sel, setSel] = useState(REF_MARGIN_INDEX)

  const reload = useCallback(async () => {
    setError(null)
    try {
      const [p, l] = await Promise.all([
        api<{ params: FeeParams }>('/api/bizdev/params'),
        api<{ prospects: Prospect[] }>('/api/bizdev/prospects'),
      ])
      setParams(p.params); setProspects(l.prospects)
    } catch (e) { setError(e instanceof Error ? e.message : 'Error cargando BizDev') }
    finally { setLoading(false) }
  }, [])
  useEffect(() => { reload() }, [reload])

  const result = useMemo(() => params ? calcular(params, { u, m2, casas, extra }) : null, [params, u, m2, casas, extra])

  const openCalcFor = (p: Prospect | null) => {
    setProspectId(p?.id ?? '')
    setPhName(p ? (p.full_name || p.short_name) : '')
    if (p) { setU(p.unidades ?? 0); setM2(Number(p.m2_privados ?? 0)); setCasas(p.es_casas) }
    setExtra([]); setSel(REF_MARGIN_INDEX); setView('calc')
  }

  // Prospecto del tab Seguimiento: el elegido o, si no hay, el primero no archivado.
  const ficha = prospects.find(p => p.id === fichaId) ?? prospects.find(p => !p.archivado_el) ?? prospects[0] ?? null
  const abrirSeguimiento = (id: string) => { setFichaId(id); setView('seg') }

  return (
    <div style={{ minHeight: '100vh', background: C.carbonDark, color: C.parch, fontFamily: "'DM Sans',sans-serif", paddingBottom: '80px', position: 'relative', zIndex: 1 }}>
      <style>{`@import url('https://fonts.googleapis.com/css2?family=Space+Mono:wght@400;700&display=swap');
        .bd-card-click:hover{border-color:rgba(196,98,45,0.45)!important}
        .bd-margin:hover{border-color:${C.terra}!important}
        .bd-funnel{display:grid;grid-template-columns:repeat(8,minmax(0,1fr));gap:8px}
        .bd-main{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,320px);gap:16px;align-items:start}
        .bd-ptable{border-collapse:collapse;width:100%;min-width:760px}
        .bd-ptable th{font-family:'Cinzel',serif;font-size:8px;letter-spacing:.18em;text-transform:uppercase;color:rgba(225,218,210,0.82);font-weight:600;text-align:left;padding:10px 14px;background:rgba(14,16,24,0.55);border-bottom:1px solid rgba(92,52,114,0.4)}
        .bd-ptable td{padding:12px 14px;border-bottom:1px solid rgba(92,52,114,0.2);vertical-align:middle}
        .bd-ptable .r{text-align:right}
        .bd-row{cursor:pointer;transition:background .15s}
        .bd-row:hover,.bd-row:focus-visible{background:rgba(196,98,45,0.08);outline:none}
        .bd-mini:hover{border-color:rgba(196,98,45,0.5)!important}
        @media (max-width:1100px){.bd-main{grid-template-columns:minmax(0,1fr)}.bd-funnel{grid-template-columns:repeat(4,minmax(0,1fr))}}
        @media (max-width:520px){.bd-funnel{grid-template-columns:repeat(2,minmax(0,1fr))}}
        @media (max-width:860px){.bd-kpi-hero{grid-column:1 / -1}}
        .bd-seg{display:grid;grid-template-columns:minmax(0,1.2fr) minmax(0,1fr);gap:16px;align-items:start}
        .bd-seg-col{display:grid;gap:16px;align-content:start;min-width:0}
        @media (max-width:1000px){.bd-seg{grid-template-columns:minmax(0,1fr)}}
        .bd-calc{display:grid;grid-template-columns:minmax(0,360px) minmax(0,1fr);gap:16px;align-items:start}
        .bd-margins{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:10px}
        .bd-kpis{display:grid;grid-template-columns:1.4fr repeat(4,minmax(0,1fr));gap:12px}
        @media (max-width:860px){.bd-calc{grid-template-columns:minmax(0,1fr)}.bd-kpis{grid-template-columns:repeat(2,minmax(0,1fr))}}
        @media (max-width:560px){.bd-margins{grid-template-columns:repeat(2,minmax(0,1fr))}}
        .bd-table{border-collapse:collapse;width:100%;font-size:12px;min-width:680px}
        .bd-table th,.bd-table td{padding:7px 8px;border-bottom:1px solid rgba(92,52,114,0.18);text-align:right;white-space:nowrap}
        .bd-table th:first-child,.bd-table td:first-child{text-align:left}
        .bd-table td{font-family:${MONO}}
        .bd-table th{font-family:'Cinzel',serif;font-size:8px;letter-spacing:.18em;color:rgba(184,176,168,0.6);font-weight:600}
      `}</style>

      {/* HERO */}
      <div style={{ position: 'relative', overflow: 'hidden', padding: '48px 0 28px', borderBottom: '1px solid rgba(92,52,114,0.12)' }}>
        <div style={{ position: 'absolute', inset: 0, background: 'radial-gradient(circle at 80% 10%, rgba(92,52,114,0.18), transparent 60%)', pointerEvents: 'none' }} />
        <div style={{ maxWidth: '1320px', margin: '0 auto', padding: '0 28px', position: 'relative' }}>
          <div style={{ ...cinzel(C.terra, 11), opacity: 0.85, marginBottom: '10px' }}>Business Development · uso interno</div>
          <h1 style={{ fontFamily: "'EB Garamond',serif", fontWeight: 400, fontSize: 'clamp(2rem,5vw,3.2rem)', lineHeight: 1.05, color: C.parch, margin: '0 0 10px' }}>
            BizDev
          </h1>
          <p style={{ fontFamily: "'EB Garamond',serif", fontSize: '16px', fontStyle: 'italic', color: 'rgba(240,237,232,0.66)', margin: 0 }}>
            Prospectos, honorario por modelo y propuesta para la Junta Directiva
            {params && <> · modelo <span style={{ fontFamily: MONO, fontStyle: 'normal', fontSize: '13px' }}>{params.version}</span></>}
          </p>
        </div>
      </div>

      {/* Sub-navegación */}
      <div style={{ maxWidth: '1320px', margin: '0 auto', padding: '16px 28px 0' }}>
        <div role="tablist" style={{ display: 'flex', gap: 0, borderBottom: '1px solid rgba(255,255,255,0.06)', overflowX: 'auto' }}>
          {([['dashboard', 'Dashboard'], ['seg', 'Seguimiento'], ['calc', 'Calculadora'], ['prop', 'Propuesta']] as [View, string][]).map(([k, l]) => (
            <button key={k} role="tab" aria-selected={view === k} onClick={() => setView(k)}
              style={{ background: 'none', border: 'none', borderBottom: `2px solid ${view === k ? C.terra : 'transparent'}`, padding: '10px 16px', cursor: 'pointer', ...cinzel(view === k ? C.terra : 'rgba(240,237,232,0.3)') }}>
              {l}
            </button>
          ))}
        </div>
      </div>

      <main style={{ maxWidth: '1320px', margin: '0 auto', padding: '24px 28px', display: 'grid', gridTemplateColumns: 'minmax(0,1fr)', gap: '16px' }}>
        {error && (
          <div role="alert" style={{ background: 'rgba(196,98,45,0.07)', border: '1px solid rgba(196,98,45,0.25)', borderLeft: `3px solid ${C.terra}`, borderRadius: '8px', padding: '14px 18px', fontSize: '13px', color: C.terra }}>
            {error}
          </div>
        )}
        {loading && <div style={{ ...cinzel(C.muted) }}>Cargando…</div>}

        {!loading && params && view === 'dashboard' && (
          <Dashboard params={params} prospects={prospects} onOpen={abrirSeguimiento} onReload={reload} onError={setError} />
        )}
        {!loading && params && view === 'seg' && (
          ficha ? (
            <Ficha
              key={ficha.id} p={ficha} params={params} prospects={prospects} onSelect={setFichaId}
              onClose={() => setView('dashboard')}
              onNuevaCotizacion={() => openCalcFor(ficha)} onReload={reload} onError={setError}
            />
          ) : <div style={{ ...card, color: C.muted, fontSize: '13px' }}>Todavía no hay prospectos. Créalos desde el Dashboard.</div>
        )}
        {!loading && params && result && view === 'calc' && (
          <Calculadora
            params={params} result={result} prospects={prospects}
            prospectId={prospectId} setProspectId={id => {
              const p = prospects.find(x => x.id === id)
              if (p) openCalcFor(p); else { setProspectId(''); }
            }}
            phName={phName} setPhName={setPhName} u={u} setU={setU} m2={m2} setM2={setM2}
            casas={casas} setCasas={setCasas} extra={extra} setExtra={setExtra}
            sel={sel} onPick={i => { setSel(i); setView('prop') }}
          />
        )}
        {!loading && params && result && view === 'prop' && (
          <Propuesta
            params={params} result={result} sel={sel} setSel={setSel}
            ph={phName || prospects.find(p => p.id === prospectId)?.short_name || ''}
            u={u} m2={m2} casas={casas} extra={extra}
            prospect={prospects.find(p => p.id === prospectId) ?? null}
            onSaved={async () => { await reload() }} onError={setError}
          />
        )}
      </main>

    </div>
  )
}

// ════════════════════════════════════════════════════════════════
// DASHBOARD
// Colores por etapa: el embudo avanza de amatista (descubrimiento) a terra (oferta), y cierra en verde o rojo.
const ETAPA_COLOR: Record<string, string> = {
  contacto: '#B79CCB', levantamiento: '#A07FBF', confidencialidad: '#8E62AD', cotizado: C.terra,
  negociacion: '#E3894F', ganado: C.success, perdido: C.danger, pausado: '#8C8A88',
}
const TEMP_COLOR: Record<string, string> = { frio: '#8FB8DE', tibio: C.gold, caliente: C.terra }
const PRIO_COLOR: Record<string, string> = { alta: C.danger, media: C.gold, baja: C.muted }
const TIER_COLOR: Record<string, string> = { Esencial: '#B79CCB', Profesional: C.terra, 'Élite': C.gold, 'Bajo el piso': C.danger }

function Badge({ text, color, solid = false }: { text: string; color: string; solid?: boolean }) {
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center', gap: '6px', whiteSpace: 'nowrap',
      padding: '3px 9px', borderRadius: '999px', fontFamily: "'DM Sans',sans-serif", fontSize: '11px', fontWeight: 600,
      letterSpacing: '0.02em', color: solid ? C.carbonDark : color,
      background: solid ? color : `${color}1F`, border: `1px solid ${color}66`,
    }}>
      {!solid && <span style={{ width: 6, height: 6, borderRadius: '50%', background: color }} />}
      {text}
    </span>
  )
}

// ─── Filtro por periodo (Sam, 2026-11-03: «este mes, mes pasado y calendario desde-hasta») ───
type Modo = 'todo' | 'mes' | 'mes_pasado' | 'rango'
const isoLocal = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
/** Rango [desde, hasta] en fechas locales YYYY-MM-DD; null = sin filtro. */
function rangoDe(modo: Modo, desde: string, hasta: string): [string, string] | null {
  const h = new Date()
  if (modo === 'mes') return [isoLocal(new Date(h.getFullYear(), h.getMonth(), 1)), isoLocal(new Date(h.getFullYear(), h.getMonth() + 1, 0))]
  if (modo === 'mes_pasado') return [isoLocal(new Date(h.getFullYear(), h.getMonth() - 1, 1)), isoLocal(new Date(h.getFullYear(), h.getMonth(), 0))]
  if (modo === 'rango' && (desde || hasta)) return [desde || '0000-01-01', hasta || '9999-12-31']
  return null
}
/** Fecha local (YYYY-MM-DD) de un timestamp o de una fecha. */
const diaLocal = (s: string) => (s.length === 10 ? s : isoLocal(new Date(s)))
const enRango = (s: string | null | undefined, r: [string, string] | null) =>
  !r || (!!s && diaLocal(s) >= r[0] && diaLocal(s) <= r[1])
const fmtRango = (r: [string, string]) => {
  const f = (d: string) => d.startsWith('0000') || d.startsWith('9999') ? '…' : fmtFecha(d)
  return `${f(r[0])} – ${f(r[1])}`
}

function Dashboard({ params, prospects, onOpen, onReload, onError }: {
  params: FeeParams; prospects: Prospect[]; onOpen: (id: string) => void
  onReload: () => Promise<void>; onError: (e: string | null) => void
}) {
  const hoy = hoyISO()
  const hace30 = new Date(Date.now() - 30 * 864e5).toISOString().slice(0, 10)
  const [modo, setModo] = useState<Modo>('todo')
  const [desde, setDesde] = useState('')
  const [hasta, setHasta] = useState('')
  const rango = rangoDe(modo, desde, hasta)
  // Archivo (Sam, 2026-11-04): los archivados salen del dashboard y se ven con «Ver archivados».
  const [verArchivados, setVerArchivados] = useState(false)
  const vivos = prospects.filter(p => !p.archivado_el)
  const archivados = prospects.filter(p => !!p.archivado_el)
  const visibles = verArchivados ? archivados : vivos
  // Indicadores: sin archivados ni prospectos de prueba (Sam, 2026-11-04).
  const medibles = prospects.filter(cuentaEnIndicadores)
  const hayPrueba = vivos.some(p => p.es_prueba)
  // Con periodo: un prospecto entra si se creó, se cotizó o tuvo una comunicación dentro del rango.
  const enPeriodo = rango
    ? visibles.filter(p => enRango(p.created_at, rango) || p.quotes.some(q => enRango(q.created_at, rango)) || p.comms.some(c => enRango(c.fecha, rango)))
    : visibles
  const activos = medibles.filter(p => !INACTIVAS.has(p.etapa))
  // Listas de trabajo (acciones, por decidir, actividad): todo lo no archivado, prueba incluida y marcada.
  const enCurso = vivos.filter(p => !INACTIVAS.has(p.etapa))
  // Cartera: última cotización de cada activo; con periodo, solo si esa cotización es del rango.
  const cotizados = activos.filter(p => { const q = ultimaEnviada(p); return !!q && enRango(q.enviada_el ?? q.created_at, rango) })
  const cartera = cotizados.reduce((s, p) => s + Number(ultimaEnviada(p)!.honorario), 0)
  const enviadas30 = medibles.flatMap(p => p.quotes)
    .filter(q => q.estado === 'enviada' && q.enviada_el && (rango ? enRango(q.enviada_el, rango) : q.enviada_el >= hace30)).length
  const ganados = medibles.filter(p => p.etapa === 'ganado').length
  const perdidos = medibles.filter(p => p.etapa === 'perdido').length
  const vencidas = activos.filter(p => p.proxima_fecha && p.proxima_fecha < hoy).length

  const [filtro, setFiltro] = useState<string | null>(null)
  const [copiado, setCopiado] = useState(false)
  const copiarBriefs = async () => {
    const txt = activos.map(p => buildBrief(p, hoy).texto).join('\n\n' + '─'.repeat(40) + '\n\n')
    try { await navigator.clipboard.writeText(txt || 'No hay prospectos activos.'); setCopiado(true); setTimeout(() => setCopiado(false), 2500) }
    catch { onError('No se pudo copiar al portapapeles.') }
  }
  const [nuevo, setNuevo] = useState(false)
  const [form, setForm] = useState({ short_name: '', full_name: '', unidades: '', m2_privados: '', es_casas: false })
  const [saving, setSaving] = useState(false)

  const crear = async () => {
    setSaving(true); onError(null)
    try {
      await api('/api/bizdev/prospects', {
        method: 'POST', body: JSON.stringify({
          short_name: form.short_name.trim(), full_name: form.full_name.trim() || null,
          unidades: form.unidades ? Number(form.unidades) : null,
          m2_privados: form.m2_privados ? Number(form.m2_privados) : null, es_casas: form.es_casas,
        }),
      })
      setForm({ short_name: '', full_name: '', unidades: '', m2_privados: '', es_casas: false }); setNuevo(false)
      await onReload()
    } catch (e) { onError(e instanceof Error ? e.message : 'Error') } finally { setSaving(false) }
  }

  type Kpi = { k: string; v: string; sub: string; color: string; hero?: boolean }
  const kpis: Kpi[] = [
    { k: 'Cartera cotizada / mes', v: cotizados.length ? `$${usd(cartera)}` : '—', hero: true, color: C.terra,
      sub: cotizados.length ? `${cotizados.length} prospecto(s) con cotización · sin ITBMS` : rango ? 'Sin cotizaciones en el periodo' : 'Sin cotizaciones guardadas todavía' },
    { k: 'Prospectos activos', v: String(activos.length), color: C.amatistaLight,
      sub: `${medibles.length} en total` + (archivados.length ? ` · ${archivados.length} archivado(s)` : '') + (hayPrueba ? ' · la prueba no cuenta' : '') },
    { k: 'Propuestas enviadas', v: String(enviadas30), color: C.mint, sub: rango ? 'en el periodo' : 'últimos 30 días' },
    { k: 'Tasa de cierre', v: ganados + perdidos ? `${Math.round((ganados / (ganados + perdidos)) * 100)} %` : '—', color: C.success,
      sub: `${ganados} ganado(s) · ${perdidos} perdido(s)` },
    { k: 'Acciones vencidas', v: String(vencidas), color: vencidas > 0 ? C.danger : C.muted,
      sub: vencidas > 0 ? 'requieren seguimiento' : 'todo al día' },
  ]

  const lista = (filtro ? enPeriodo.filter(p => p.etapa === filtro) : enPeriodo)
    .slice().sort((a, b) => ETAPAS.findIndex(e => e.key === b.etapa) - ETAPAS.findIndex(e => e.key === a.etapa))
  const acciones = enCurso.filter(p => p.proxima_fecha || p.proxima_accion)
    .slice().sort((a, b) => (a.proxima_fecha ?? '9999').localeCompare(b.proxima_fecha ?? '9999'))
  const porDecidir = enCurso
    .flatMap(p => pendientes(p.actions ?? []).map(a => ({ a, p })))
    .sort((x, y) => ({ alta: 0, media: 1, baja: 2 }[x.a.prioridad] - { alta: 0, media: 1, baja: 2 }[y.a.prioridad])
      || (x.a.fecha_sugerida ?? '9999').localeCompare(y.a.fecha_sugerida ?? '9999'))
  const actividad = vivos.flatMap(p => p.comms.filter(c => enRango(c.fecha, rango)).map(c => ({ c, p })))
    .sort((a, b) => b.c.fecha.localeCompare(a.c.fecha)).slice(0, 6)
  // El embudo es un indicador: no cuenta el prospecto de prueba.
  const enEmbudo = enPeriodo.filter(p => !p.es_prueba)
  const maxEtapa = Math.max(1, ...ETAPAS.map(e => enEmbudo.filter(p => p.etapa === e.key).length))
  const MODOS: [Modo, string][] = [['todo', 'Todo'], ['mes', 'Este mes'], ['mes_pasado', 'Mes pasado'], ['rango', 'Personalizado']]

  return (
    <>
      {/* ── Periodo ── */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap' }} role="group" aria-label="Periodo">
        <span style={{ ...cinzel(C.label, 8) }}>Periodo</span>
        <div style={{ display: 'inline-flex', border: `1px solid ${C.line}`, borderRadius: '8px', overflow: 'hidden' }}>
          {MODOS.map(([m, l]) => (
            <button key={m} onClick={() => setModo(m)} aria-pressed={modo === m}
              style={{ padding: '7px 12px', border: 'none', cursor: 'pointer', fontFamily: "'DM Sans',sans-serif", fontSize: '12px', fontWeight: 600,
                background: modo === m ? C.terra : 'rgba(14,16,24,0.55)', color: modo === m ? C.cream : C.muted,
                borderRight: m !== 'rango' ? `1px solid ${C.line}` : 'none' }}>
              {l}
            </button>
          ))}
        </div>
        {modo === 'rango' && (
          <div style={{ display: 'inline-flex', alignItems: 'center', gap: '8px' }}>
            <label htmlFor="per-desde" style={{ fontSize: '12px', color: C.muted }}>Desde</label>
            <input id="per-desde" type="date" value={desde} max={hasta || undefined} onChange={e => setDesde(e.target.value)} style={{ ...numInput, width: 'auto', fontSize: '12px', padding: '6px 8px', colorScheme: 'dark' }} />
            <label htmlFor="per-hasta" style={{ fontSize: '12px', color: C.muted }}>Hasta</label>
            <input id="per-hasta" type="date" value={hasta} min={desde || undefined} onChange={e => setHasta(e.target.value)} style={{ ...numInput, width: 'auto', fontSize: '12px', padding: '6px 8px', colorScheme: 'dark' }} />
          </div>
        )}
        {rango && <span style={{ fontFamily: MONO, fontSize: '12px', color: C.gold }}>{fmtRango(rango)}</span>}
        {rango && <span style={{ fontSize: '11px', color: C.muted }}>Activos, tasa de cierre y vencidas muestran el estado actual.</span>}
      </div>

      {/* ── Indicadores ── */}
      <div className="bd-kpis">
        {kpis.map(x => (
          <div key={x.k} className={x.hero ? 'bd-kpi-hero' : undefined} style={{
            ...card, padding: '18px 18px 16px', position: 'relative', overflow: 'hidden',
            borderTop: `3px solid ${x.color}`,
            background: x.hero ? `linear-gradient(160deg, rgba(196,98,45,0.18), ${C.carbon} 70%)` : C.carbon,
          }}>
            <div style={{ ...cinzel(C.label, 8), marginBottom: '10px' }}>{x.k}</div>
            <div style={{ fontFamily: MONO, fontSize: x.hero ? '28px' : '26px', fontWeight: 700, color: x.color, lineHeight: 1.1, overflowWrap: 'anywhere' }}>{x.v}</div>
            <div style={{ fontSize: '11px', color: C.muted, marginTop: '6px' }}>{x.sub}</div>
          </div>
        ))}
      </div>

      {/* ── Embudo por etapa (filtra la tabla) ── */}
      <section style={{ ...card, padding: '16px 18px' }} aria-label="Embudo por etapa">
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '12px', flexWrap: 'wrap' }}>
          <div style={{ ...cinzel(C.terra, 10) }}>Embudo comercial</div>
          {filtro && (
            <button onClick={() => setFiltro(null)} style={{ ...btn(false), padding: '4px 10px', fontSize: '8px' }}>Quitar filtro ×</button>
          )}
          <div style={{ marginLeft: 'auto' }}>
            <button style={btn(!nuevo)} onClick={() => setNuevo(v => !v)}>{nuevo ? 'Cancelar' : '+ Nuevo prospecto'}</button>
          </div>
        </div>
        <div className="bd-funnel">
          {ETAPAS.map(et => {
            const n = enEmbudo.filter(p => p.etapa === et.key).length
            const col = ETAPA_COLOR[et.key]
            const on = filtro === et.key
            return (
              <button key={et.key} onClick={() => setFiltro(on ? null : et.key)} aria-pressed={on}
                style={{
                  textAlign: 'left', cursor: 'pointer', borderRadius: '8px', padding: '10px 10px 8px', minWidth: 0,
                  background: on ? `${col}33` : 'rgba(14,16,24,0.55)', border: `1px solid ${on ? col : 'rgba(255,255,255,0.06)'}`,
                  opacity: n === 0 && !on ? 0.55 : 1, color: C.parch,
                }}>
                <div style={{ fontSize: '11px', fontWeight: 600, color: col, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{et.label}</div>
                <div style={{ fontFamily: MONO, fontSize: '20px', fontWeight: 700, margin: '2px 0 6px' }}>{n}</div>
                <div style={{ height: 4, borderRadius: 2, background: 'rgba(255,255,255,0.06)' }}>
                  <div style={{ height: 4, borderRadius: 2, width: `${(n / maxEtapa) * 100}%`, background: col }} />
                </div>
              </button>
            )
          })}
        </div>
      </section>

      {nuevo && (
        <div style={{ ...card, display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(160px,1fr))', gap: '12px', alignItems: 'end', borderTop: `3px solid ${C.amatista}` }}>
          <div><label style={label} htmlFor="np-short">Nombre corto</label>
            <input id="np-short" style={inputStyle} value={form.short_name} onChange={e => setForm({ ...form, short_name: e.target.value })} /></div>
          <div><label style={label} htmlFor="np-full">Nombre completo</label>
            <input id="np-full" style={inputStyle} value={form.full_name} onChange={e => setForm({ ...form, full_name: e.target.value })} /></div>
          <div><label style={label} htmlFor="np-u">Unidades</label>
            <input id="np-u" type="number" min={0} style={numInput} value={form.unidades} onChange={e => setForm({ ...form, unidades: e.target.value })} /></div>
          <div><label style={label} htmlFor="np-m2">m² privados</label>
            <input id="np-m2" type="number" min={0} style={numInput} value={form.m2_privados} onChange={e => setForm({ ...form, m2_privados: e.target.value })} /></div>
          <label style={{ display: 'flex', gap: '8px', alignItems: 'center', fontSize: '13px' }}>
            <input type="checkbox" checked={form.es_casas} onChange={e => setForm({ ...form, es_casas: e.target.checked })} style={{ accentColor: C.terra }} /> PH de casas
          </label>
          <button style={btn(true, !!form.short_name.trim() && !saving)} disabled={!form.short_name.trim() || saving} onClick={crear}>
            {saving ? 'Guardando…' : 'Crear'}
          </button>
        </div>
      )}

      {/* ── Tabla de prospectos + panel lateral ── */}
      <div className="bd-main">
        <section style={{ ...card, padding: 0, overflow: 'hidden' }} aria-label="Prospectos">
          <div style={{ display: 'flex', alignItems: 'baseline', gap: '10px', padding: '16px 18px 12px' }}>
            <div style={{ ...cinzel(C.terra, 10) }}>{verArchivados ? 'Archivados' : 'Prospectos'}</div>
            <span style={{ fontSize: '12px', color: C.muted }}>
              {filtro ? `${lista.length} en ${ETAPAS.find(e => e.key === filtro)?.label}` : `${lista.length} en total`} · clic para abrir la ficha
            </span>
            <button onClick={copiarBriefs} style={{ ...btn(false), marginLeft: 'auto', padding: '6px 12px', borderColor: 'rgba(79,216,184,0.5)', color: C.mint }}
              title="Copia el brief de cada prospecto activo (entradas, respuestas y puntos clave)">
              {copiado ? 'Briefs copiados ✓' : 'Copiar briefs en curso'}
            </button>
            {(archivados.length > 0 || verArchivados) && (
              <button onClick={() => { setVerArchivados(v => !v); setFiltro(null) }} aria-pressed={verArchivados}
                style={{ ...btn(false), padding: '6px 12px' }}>
                {verArchivados ? 'Volver a los activos' : `Ver archivados (${archivados.length})`}
              </button>
            )}
          </div>
          <div style={{ overflowX: 'auto' }}>
            <table className="bd-ptable">
              <thead><tr>
                <th>Prospecto</th><th>Etapa</th><th>Tier</th><th className="r">Tamaño</th>
                <th className="r">Última cotización</th><th>Próxima acción</th><th>Última comunicación</th>
              </tr></thead>
              <tbody>
                {lista.length === 0 && (
                  <tr><td colSpan={7} style={{ padding: '22px 18px', color: C.muted }}>{verArchivados ? 'No hay prospectos archivados.' : rango ? 'No hay prospectos con actividad en este periodo.' : 'No hay prospectos en esta etapa.'}</td></tr>
                )}
                {lista.map(p => {
                  const q = p.quotes[0]
                  const c = p.comms[0]
                  const vencida = !!p.proxima_fecha && p.proxima_fecha < hoy && !INACTIVAS.has(p.etapa)
                  const tier = p.unidades != null ? TIER_NOMBRES[tierFromSize(params, p.unidades, Number(p.m2_privados ?? 0), p.es_casas)] : null
                  const et = ETAPAS.find(e => e.key === p.etapa)
                  return (
                    <tr key={p.id} className="bd-row" onClick={() => onOpen(p.id)} tabIndex={0}
                      onKeyDown={e => { if (e.key === 'Enter') onOpen(p.id) }} style={{ boxShadow: `inset 3px 0 0 ${ETAPA_COLOR[p.etapa]}` }}>
                      <td>
                        <div style={{ fontFamily: "'EB Garamond',serif", fontSize: '19px', color: C.parch, lineHeight: 1.1, whiteSpace: 'nowrap' }}>{p.short_name}</div>
                        <div style={{ fontFamily: MONO, fontSize: '10px', color: C.muted }}>{p.code}</div>
                        {(() => {
                          const n = pendientes(p.actions ?? []).length
                          const l = ultimaLectura(p.insights ?? [])
                          return (n > 0 || l?.temperatura || p.es_prueba || p.archivado_el) ? (
                            <div style={{ display: 'flex', gap: '6px', marginTop: '5px', flexWrap: 'wrap' }}>
                              {p.es_prueba && <Badge text="Prueba" color={C.gold} solid />}
                              {p.archivado_el && <Badge text="Archivado" color={C.muted} />}
                              {n > 0 && <Badge text={`${n} por decidir`} color={C.mint} />}
                              {l?.temperatura && <Badge text={TEMPERATURA_LABEL[l.temperatura]} color={TEMP_COLOR[l.temperatura]} />}
                            </div>
                          ) : null
                        })()}
                      </td>
                      <td><Badge text={et?.label ?? p.etapa} color={ETAPA_COLOR[p.etapa]} /></td>
                      <td>{tier ? <Badge text={tier} color={TIER_COLOR[tier]} /> : <span style={{ color: C.muted }}>—</span>}</td>
                      <td className="r" style={{ fontFamily: MONO, fontSize: '12px', color: C.parch, whiteSpace: 'nowrap' }}>
                        {p.unidades ?? '—'} uds.<br /><span style={{ color: C.muted }}>{p.es_casas ? 'casas' : p.m2_privados != null ? `${usd(Number(p.m2_privados), 0)} m²` : '—'}</span>
                      </td>
                      <td className="r">
                        {q ? (<>
                          <div style={{ fontFamily: MONO, fontSize: '15px', fontWeight: 700, color: C.terra }}>${usd(Number(q.honorario))}</div>
                          <div style={{ fontSize: '11px', color: q.estado === 'borrador' ? C.gold : C.muted }}>{margenDe(q)} · {q.estado}</div>
                        </>) : <span style={{ fontSize: '12px', color: C.muted }}>Sin cotización</span>}
                      </td>
                      <td>
                        {p.proxima_accion || p.proxima_fecha ? (
                          <div style={{ color: vencida ? C.danger : C.parch, fontSize: '12px' }}>
                            <div style={{ fontWeight: vencida ? 700 : 500 }}>{p.proxima_accion ?? 'Próxima acción'}</div>
                            <div style={{ fontFamily: MONO, fontSize: '11px', color: vencida ? C.danger : C.muted, whiteSpace: 'nowrap' }}>{fmtFecha(p.proxima_fecha)}{vencida && ' · vencida'}</div>
                          </div>
                        ) : <span style={{ fontSize: '12px', color: C.gold }}>Definir próxima acción</span>}
                      </td>
                      <td style={{ fontSize: '12px' }}>
                        {c ? (<>
                          <div style={{ color: C.parch }}>{CANAL_LABEL[c.canal] ?? c.canal} · {c.sentido}</div>
                          <div style={{ fontFamily: MONO, fontSize: '11px', color: C.muted }}>{fmtFecha(c.fecha)}</div>
                        </>) : <span style={{ color: C.muted }}>—</span>}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </section>

        <aside style={{ display: 'grid', gap: '16px', alignContent: 'start', minWidth: 0 }}>
          {porDecidir.length > 0 && (
            <section style={{ ...card, borderTop: `3px solid ${C.mint}`, background: `linear-gradient(160deg, ${C.mintSoft}, ${C.carbon} 70%)` }} aria-label="Acciones propuestas por decidir">
              <div style={{ display: 'flex', alignItems: 'baseline', gap: '8px', marginBottom: '12px' }}>
                <div style={{ ...cinzel(C.mint, 10) }}>Por decidir</div>
                <span style={{ fontFamily: MONO, fontSize: '13px', fontWeight: 700, color: C.mint }}>{porDecidir.length}</span>
                <span style={{ fontSize: '11px', color: C.muted }}>propuestas de la lectura de correos</span>
              </div>
              <div style={{ display: 'grid', gap: '10px' }}>
                {porDecidir.slice(0, 6).map(({ a, p }) => (
                  <button key={a.id} onClick={() => onOpen(p.id)} className="bd-mini"
                    style={{ textAlign: 'left', cursor: 'pointer', background: 'rgba(14,16,24,0.55)', border: '1px solid rgba(79,216,184,0.25)', borderRadius: '8px', padding: '10px 12px', color: C.parch }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', gap: '8px' }}>
                      <span style={{ fontWeight: 600, fontSize: '13px' }}>{p.short_name}{p.es_prueba && <span style={{ color: C.gold, fontWeight: 500 }}> · prueba</span>}</span>
                      <span style={{ fontSize: '11px', fontWeight: 600, color: PRIO_COLOR[a.prioridad] }}>{a.prioridad}</span>
                    </div>
                    <div style={{ fontSize: '12px', color: C.parch, marginTop: '2px' }}>{a.accion}</div>
                    {a.fecha_sugerida && <div style={{ fontFamily: MONO, fontSize: '11px', color: C.muted }}>sugerida para {fmtFecha(a.fecha_sugerida)}</div>}
                  </button>
                ))}
              </div>
            </section>
          )}
          <section style={{ ...card, borderTop: `3px solid ${vencidas > 0 ? C.danger : C.terra}` }} aria-label="Próximas acciones">
            <div style={{ ...cinzel(C.terra, 10), marginBottom: '12px' }}>Próximas acciones</div>
            {acciones.length === 0 && <div style={{ fontSize: '13px', color: C.muted }}>Ningún prospecto activo tiene próxima acción. Defínela en su ficha.</div>}
            <div style={{ display: 'grid', gap: '10px' }}>
              {acciones.map(p => {
                const venc = !!p.proxima_fecha && p.proxima_fecha < hoy
                return (
                  <button key={p.id} onClick={() => onOpen(p.id)} className="bd-mini"
                    style={{ textAlign: 'left', cursor: 'pointer', background: venc ? 'rgba(224,122,95,0.10)' : 'rgba(14,16,24,0.55)', border: `1px solid ${venc ? 'rgba(224,122,95,0.45)' : 'rgba(255,255,255,0.06)'}`, borderRadius: '8px', padding: '10px 12px', color: C.parch }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', gap: '8px' }}>
                      <span style={{ fontWeight: 600, fontSize: '13px' }}>{p.short_name}{p.es_prueba && <span style={{ color: C.gold, fontWeight: 500 }}> · prueba</span>}</span>
                      <span style={{ fontFamily: MONO, fontSize: '11px', color: venc ? C.danger : C.gold }}>{fmtFecha(p.proxima_fecha)}</span>
                    </div>
                    <div style={{ fontSize: '12px', color: venc ? C.danger : C.muted, marginTop: '2px' }}>{p.proxima_accion ?? '—'}{venc && ' · vencida'}</div>
                  </button>
                )
              })}
            </div>
          </section>

          <section style={card} aria-label="Actividad reciente">
            <div style={{ ...cinzel(C.terra, 10), marginBottom: '12px' }}>Actividad reciente</div>
            {actividad.length === 0 && <div style={{ fontSize: '13px', color: C.muted }}>{rango ? 'Sin comunicaciones en el periodo.' : 'Sin comunicaciones registradas.'}</div>}
            <div style={{ display: 'grid', gap: '12px' }}>
              {actividad.map(({ c, p }) => (
                <div key={c.id} style={{ borderLeft: `2px solid ${c.sentido === 'interno' ? C.amatistaLight : c.sentido === 'recibido' ? C.mint : C.terra}`, paddingLeft: '10px' }}>
                  <div style={{ fontSize: '11px', color: C.muted }}>
                    <span style={{ color: C.parch, fontWeight: 600 }}>{p.short_name}</span> · <span style={{ fontFamily: MONO }}>{fmtFecha(c.fecha)}</span> · {CANAL_LABEL[c.canal] ?? c.canal}
                  </div>
                  <div style={{ fontSize: '12px', color: C.parch, lineHeight: 1.4 }}>{c.resumen}</div>
                </div>
              ))}
            </div>
          </section>
        </aside>
      </div>
    </>
  )
}

// ════════════════════════════════════════════════════════════════
// FICHA DEL PROSPECTO
function Ficha({ p, params, prospects, onSelect, onClose, onNuevaCotizacion, onReload, onError }: {
  p: Prospect; params: FeeParams; prospects: Prospect[]; onSelect: (id: string) => void
  onClose: () => void; onNuevaCotizacion: () => void
  onReload: () => Promise<void>; onError: (e: string | null) => void
}) {
  const [etapa, setEtapa] = useState(p.etapa)
  const [accion, setAccion] = useState(p.proxima_accion ?? '')
  const [fecha, setFecha] = useState(p.proxima_fecha ?? '')
  const [comm, setComm] = useState({ fecha: hoyISO(), canal: 'whatsapp', sentido: 'enviado', resumen: '', doc_ref: '' })
  const [showComm, setShowComm] = useState(false)
  const [busy, setBusy] = useState(false)

  useEffect(() => { setEtapa(p.etapa); setAccion(p.proxima_accion ?? ''); setFecha(p.proxima_fecha ?? '') }, [p])

  const run = async (fn: () => Promise<unknown>) => {
    setBusy(true); onError(null)
    try { await fn(); await onReload() } catch (e) { onError(e instanceof Error ? e.message : 'Error') } finally { setBusy(false) }
  }
  const guardar = () => run(() => api('/api/bizdev/prospects', {
    method: 'PATCH', body: JSON.stringify({ id: p.id, etapa, proxima_accion: accion, proxima_fecha: fecha || null }),
  }))
  const registrar = () => run(async () => {
    await api('/api/bizdev/comms', {
      method: 'POST', body: JSON.stringify({ prospect_id: p.id, ...comm, fecha: `${comm.fecha}T12:00:00-05:00` }),
    })
    setComm({ fecha: hoyISO(), canal: 'whatsapp', sentido: 'enviado', resumen: '', doc_ref: '' }); setShowComm(false)
  })

  const marcarEnviada = (id: string) => run(() => api('/api/bizdev/quotes', { method: 'PATCH', body: JSON.stringify({ id, estado: 'enviada' }) }))
  const archivar = (archivado: boolean) => run(() => api('/api/bizdev/prospects', { method: 'PATCH', body: JSON.stringify({ id: p.id, archivado }) }))

  // Mientras un contacto tenga la revisión del historial en curso, la ficha se refresca sola cada 10 s
  // (hasta 10 min): el servicio trabaja en segundo plano y deja el resultado en la base.
  const historialEnCurso = (p.contacts ?? []).some(c => estadoHistorial(c, Date.now()).estado === 'en_curso')
  const reloadRef = useRef(onReload)
  reloadRef.current = onReload
  useEffect(() => {
    if (!historialEnCurso) return
    const t0 = Date.now()
    const iv = setInterval(() => { if (Date.now() - t0 > 10 * 60000) clearInterval(iv); else reloadRef.current() }, 10000)
    return () => clearInterval(iv)
  }, [historialEnCurso])
  const brief = buildBrief(p, hoyISO())
  const [briefCopiado, setBriefCopiado] = useState(false)
  const copiarBrief = async () => {
    try { await navigator.clipboard.writeText(brief.texto); setBriefCopiado(true); setTimeout(() => setBriefCopiado(false), 2500) }
    catch { onError('No se pudo copiar al portapapeles.') }
  }
  const timeline = [
    ...p.comms.map(c => ({ t: c.fecha, kind: 'comm' as const, c })),
    ...p.quotes.map(q => ({ t: q.created_at, kind: 'quote' as const, q })),
  ].sort((a, b) => b.t.localeCompare(a.t))
  const tier = p.unidades != null ? TIER_NOMBRES[tierFromSize(params, p.unidades, Number(p.m2_privados ?? 0), p.es_casas)] : '—'

  return (
    <section aria-label={`Seguimiento de ${p.short_name}`} style={{ display: 'grid', gap: '16px', minWidth: 0 }}>
      {/* Selector de prospecto */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap' }}>
        <button onClick={onClose} style={{ ...btn(false), padding: '6px 12px' }}>← Dashboard</button>
        <label htmlFor="seg-prospecto" style={{ ...cinzel(C.label, 8) }}>Prospecto</label>
        <div style={{ flex: '1 1 220px', maxWidth: '420px', minWidth: 0 }}>
        <select id="seg-prospecto" value={p.id} onChange={e => onSelect(e.target.value)}
          style={{ ...inputStyle, width: '100%', minWidth: 0, cursor: 'pointer' }}>
          {prospects.filter(x => !x.archivado_el).map(x => <option key={x.id} value={x.id}>{x.short_name} · {x.code}{x.es_prueba ? ' · prueba' : ''}</option>)}
          {prospects.some(x => x.archivado_el) && (
            <optgroup label="Archivados">
              {prospects.filter(x => x.archivado_el).map(x => <option key={x.id} value={x.id}>{x.short_name} · {x.code}</option>)}
            </optgroup>
          )}
        </select>
        </div>
      </div>

      <div style={{ ...card, padding: '22px 24px', display: 'flex', alignItems: 'start', gap: '16px', flexWrap: 'wrap', borderTop: `3px solid ${ETAPA_COLOR[p.etapa] ?? C.terra}` }}>
          <div style={{ minWidth: 0 }}>
            <div style={{ ...cinzel(C.terra, 9), opacity: 0.85 }}>{p.code} · {tier}</div>
            {(p.es_prueba || p.archivado_el) && (
              <div style={{ display: 'flex', gap: '6px', marginTop: '6px', flexWrap: 'wrap' }}>
                {p.es_prueba && <Badge text="Prueba · no cuenta en los indicadores" color={C.gold} solid />}
                {p.archivado_el && <Badge text={`Archivado el ${fmtFecha(p.archivado_el)}`} color={C.muted} />}
              </div>
            )}
            <h2 style={{ fontFamily: "'EB Garamond',serif", fontWeight: 400, fontSize: '36px', margin: '6px 0 0' }}>{p.short_name}</h2>
            {p.full_name && <div style={{ color: C.muted, fontSize: '13px' }}>{p.full_name}</div>}
          </div>
          <div style={{ marginLeft: 'auto', display: 'flex', gap: '8px', alignItems: 'center', flexWrap: 'wrap' }}>
            <Badge text={ETAPAS.find(e => e.key === p.etapa)?.label ?? p.etapa} color={ETAPA_COLOR[p.etapa] ?? C.terra} />
            {ultimaEnviada(p) && <span style={{ fontFamily: MONO, fontSize: '18px', fontWeight: 700, color: C.terra }}>${usd(Number(ultimaEnviada(p)!.honorario))}<span style={{ fontSize: '11px', color: C.muted, fontWeight: 400 }}> /mes</span></span>}
          </div>
      </div>

      <div className="bd-seg">
      <div className="bd-seg-col">
        <div style={{ ...card, display: 'grid', gap: '10px', borderTop: `3px solid ${C.terra}` }}>
          <div style={{ ...cinzel(C.terra, 9) }}>Etapa y próxima acción</div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(180px,1fr))', gap: '10px' }}>
            <div><label style={label} htmlFor="f-etapa">Etapa</label>
              <select id="f-etapa" style={{ ...inputStyle, cursor: 'pointer' }} value={etapa} onChange={e => setEtapa(e.target.value)}>
                {ETAPAS.map(e => <option key={e.key} value={e.key}>{e.label}</option>)}
              </select></div>
            <div><label style={label} htmlFor="f-fecha">Fecha</label>
              <input id="f-fecha" type="date" style={{ ...numInput, colorScheme: 'dark' }} value={fecha} onChange={e => setFecha(e.target.value)} /></div>
          </div>
          <div><label style={label} htmlFor="f-accion">Próxima acción</label>
            <input id="f-accion" style={inputStyle} value={accion} onChange={e => setAccion(e.target.value)} /></div>
          <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
            <button style={btn(true, !busy)} disabled={busy} onClick={guardar}>Guardar</button>
            <button style={btn(false)} onClick={onNuevaCotizacion}>Nueva cotización</button>
            <button style={btn(false)} onClick={() => setShowComm(v => !v)}>Registrar comunicación</button>
            <button style={{ ...btn(false, !busy), marginLeft: 'auto' }} disabled={busy} onClick={() => archivar(!p.archivado_el)}
              title={p.archivado_el ? 'Vuelve al dashboard y a los indicadores' : 'Sale del dashboard y de los indicadores; no cambia la etapa ni borra nada'}>
              {p.archivado_el ? 'Desarchivar' : 'Archivar'}
            </button>
          </div>
        </div>
        {showComm && (
          <div style={{ ...card, display: 'grid', gap: '10px' }}>
            <div style={{ ...cinzel(C.amatistaLight, 8) }}>Registrar comunicación</div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '10px' }}>
              <div><label style={label} htmlFor="c-fecha">Fecha</label>
                <input id="c-fecha" type="date" style={numInput} value={comm.fecha} onChange={e => setComm({ ...comm, fecha: e.target.value })} /></div>
              <div><label style={label} htmlFor="c-canal">Canal</label>
                <select id="c-canal" style={inputStyle} value={comm.canal} onChange={e => setComm({ ...comm, canal: e.target.value })}>
                  {CANALES.map(c => <option key={c} value={c}>{CANAL_LABEL[c]}</option>)}
                </select></div>
              <div><label style={label} htmlFor="c-sentido">Sentido</label>
                <select id="c-sentido" style={inputStyle} value={comm.sentido} onChange={e => setComm({ ...comm, sentido: e.target.value })}>
                  {SENTIDOS.map(s => <option key={s} value={s}>{s}</option>)}
                </select></div>
            </div>
            <div><label style={label} htmlFor="c-resumen">Resumen (tus palabras)</label>
              <textarea id="c-resumen" rows={3} style={{ ...inputStyle, resize: 'vertical' }} value={comm.resumen} onChange={e => setComm({ ...comm, resumen: e.target.value })} /></div>
            <div><label style={label} htmlFor="c-doc">Enlace al documento (opcional)</label>
              <input id="c-doc" style={inputStyle} value={comm.doc_ref} onChange={e => setComm({ ...comm, doc_ref: e.target.value })} /></div>
            <button style={btn(true, !!comm.resumen.trim() && !busy)} disabled={!comm.resumen.trim() || busy} onClick={registrar}>Registrar</button>
          </div>
        )}

        <LecturaCorreos p={p} busy={busy} run={run} />
        <div style={{ ...card, display: 'grid', gap: '10px' }}>
          <div style={{ ...cinzel(C.terra, 9) }}>Línea de tiempo</div>
          {timeline.length === 0 && <div style={{ color: C.faint, fontSize: '13px' }}>Sin registros.</div>}
          {timeline.map(it => it.kind === 'comm' ? (
            <div key={`c-${it.c.id}`} style={{ borderLeft: `2px solid ${it.c.sentido === 'interno' ? C.amatista : it.c.sentido === 'recibido' ? C.mint : C.terra}`, paddingLeft: '12px', display: 'grid', gap: '2px' }}>
              <div style={{ fontSize: '11px', color: C.muted }}>
                <span style={{ fontFamily: MONO }}>{fmtFecha(it.c.fecha)}</span> · {CANAL_LABEL[it.c.canal] ?? it.c.canal} · {it.c.sentido}
                {it.c.origen !== 'manual' && ` · ${it.c.origen === 'document_factory' ? 'Document Factory' : it.c.origen === 'communications_service' ? 'lectura de correo' : it.c.origen}`}
              </div>
              <div style={{ fontSize: '13px' }}>
                {it.c.doc_ref
                  ? <a href={it.c.doc_ref} target="_blank" rel="noreferrer" style={{ color: C.parch }}>{it.c.resumen} ↗</a>
                  : it.c.resumen}
              </div>
            </div>
          ) : (
            <div key={`q-${it.q.id}`} style={{ borderLeft: `2px solid ${C.amatistaLight}`, paddingLeft: '12px', display: 'grid', gap: '2px' }}>
              <div style={{ fontSize: '11px', color: C.muted }}><span style={{ fontFamily: MONO }}>{fmtFecha(it.q.created_at)}</span> · Cotización · {it.q.estado}</div>
              <div style={{ fontSize: '13px', fontFamily: MONO }}>
                ${usd(Number(it.q.honorario))} · {margenDe(it.q)} · {it.q.origen === 'manual' ? 'carta previa al modelo' : it.q.params_version}
                {Array.isArray(it.q.personal_extra) && it.q.personal_extra.length > 0 && ' · con personal adicional'}
              </div>
              {it.q.estado === 'borrador' && (
                <button disabled={busy} onClick={() => marcarEnviada(it.q.id)}
                  style={{ ...btn(false), justifySelf: 'start', padding: '4px 10px', fontSize: '8px', borderColor: 'rgba(79,216,184,0.5)', color: C.mint }}>
                  Marcar como enviada
                </button>
              )}
            </div>
          ))}
        </div>
      </div>

      <div className="bd-seg-col">
        <div style={card}>
          <div style={{ ...cinzel(C.amatistaLight, 8), marginBottom: '10px' }}>Tamaño</div>
          <dl style={{ display: 'grid', gridTemplateColumns: 'auto 1fr', gap: '6px 16px', margin: 0, fontSize: '13px' }}>
            <dt style={{ color: C.muted }}>Unidades</dt><dd style={{ margin: 0, fontFamily: MONO }}>{p.unidades ?? '—'}</dd>
            <dt style={{ color: C.muted }}>m² privados</dt><dd style={{ margin: 0, fontFamily: MONO }}>{p.es_casas ? 'PH de casas' : p.m2_privados != null ? usd(Number(p.m2_privados)) : '—'}</dd>
            <dt style={{ color: C.muted }}>Evidencia</dt><dd style={{ margin: 0 }}>{[p.clase_evidencia && `Clase ${p.clase_evidencia}`, p.fuente_tamano].filter(Boolean).join(' · ') || '—'}</dd>
            {p.contacto_nombre && <><dt style={{ color: C.muted }}>Contacto</dt><dd style={{ margin: 0 }}>{p.contacto_nombre}{p.contacto_rol ? ` · ${p.contacto_rol}` : ''}</dd></>}
          </dl>
        </div>

        <section style={{ ...card, display: 'grid', gap: '12px', borderTop: `3px solid ${C.mint}` }} aria-label="Brief del prospecto">
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            <div style={{ ...cinzel(C.mint, 9) }}>Brief del prospecto</div>
            <button onClick={copiarBrief} style={{ ...btn(false), marginLeft: 'auto', padding: '4px 10px', fontSize: '8px', borderColor: 'rgba(79,216,184,0.5)', color: C.mint }}>
              {briefCopiado ? 'Copiado ✓' : 'Copiar brief'}
            </button>
          </div>
          <ul style={{ margin: 0, paddingLeft: '18px', display: 'grid', gap: '4px', fontSize: '13px', color: C.parch }}>
            {brief.claves.map(k => <li key={k} style={{ color: /VENCIDA/.test(k) ? C.danger : /^Última cotización/.test(k) ? C.terraLight : C.parch }}>{k}</li>)}
          </ul>
          {([['Entradas del prospecto', brief.entradas, C.mint], ['Respuestas enviadas', brief.respuestas, C.terra]] as const).map(([t, xs, col]) => (
            <div key={t} style={{ display: 'grid', gap: '6px' }}>
              <div style={{ fontSize: '11px', fontWeight: 600, color: col }}>{t} · {xs.length}</div>
              {xs.length === 0 && <div style={{ fontSize: '12px', color: C.muted }}>{t.startsWith('Entradas') ? 'Ninguna registrada. Regístralas con «Registrar comunicación» y sentido «recibido».' : 'Ninguna registrada.'}</div>}
              {xs.slice(0, 4).map((c, i) => (
                <div key={i} style={{ borderLeft: `2px solid ${col}`, paddingLeft: '10px', fontSize: '12px' }}>
                  <span style={{ fontFamily: MONO, color: C.muted }}>{fmtFecha(c.fecha)}</span> · {CANAL_LABEL[c.canal] ?? c.canal}<br />{c.resumen}
                </div>
              ))}
            </div>
          ))}
        </section>

        <ContactosSeguimiento p={p} busy={busy} run={run} onError={onError} />
      </div>
      </div>
    </section>
  )
}


// ─── Lectura de correos y acciones propuestas (08_bizdev_analisis_de_correos.sql) ───
// Lo escribe unrlvl-communications-services con fphs_bizdev_ingest(). Aquí solo se lee y se decide.
function LecturaCorreos({ p, busy, run }: { p: Prospect; busy: boolean; run: (fn: () => Promise<unknown>) => Promise<void> }) {
  const insights = [...(p.insights ?? [])].sort((a, b) => b.created_at.localeCompare(a.created_at))
  const acciones = p.actions ?? []
  const porDecidir = pendientes(acciones)
  const decididas = acciones.filter(a => a.estado !== 'pendiente')
  const [verTodas, setVerTodas] = useState(false)
  const decidir = (id: string, estado: 'aprobada' | 'descartada') =>
    run(() => api('/api/bizdev/actions', { method: 'PATCH', body: JSON.stringify({ id, estado }) }))
  const comm = (id: string | null) => p.comms.find(c => c.id === id)

  return (
    <section style={{ ...card, display: 'grid', gap: '12px', borderTop: `3px solid ${C.mint}` }} aria-label="Lectura de correos">
      <div style={{ display: 'flex', alignItems: 'baseline', gap: '8px' }}>
        <div style={{ ...cinzel(C.mint, 9) }}>Lectura de correos</div>
        {porDecidir.length > 0 && <Badge text={`${porDecidir.length} por decidir`} color={C.mint} solid />}
      </div>
      {insights.length === 0 && porDecidir.length === 0 && (
        <div style={{ fontSize: '12px', color: C.muted, lineHeight: 1.5 }}>
          Todavía no hay lecturas. Cuando el servicio de comunicaciones lea un correo de este prospecto, aquí aparecen
          su interpretación y las acciones propuestas. Para eso el prospecto necesita al menos un contacto de seguimiento.
        </div>
      )}

      {porDecidir.length > 0 && (
        <div style={{ display: 'grid', gap: '8px' }}>
          <div style={{ fontSize: '11px', fontWeight: 600, color: C.mint }}>Acciones propuestas · al aprobar una, pasa a ser la próxima acción</div>
          {porDecidir.map(a => (
            <div key={a.id} style={{ background: 'rgba(14,16,24,0.55)', border: '1px solid rgba(79,216,184,0.25)', borderRadius: '8px', padding: '10px 12px', display: 'grid', gap: '8px' }}>
              <div style={{ display: 'flex', gap: '8px', alignItems: 'baseline' }}>
                <span style={{ fontSize: '11px', fontWeight: 700, color: PRIO_COLOR[a.prioridad], textTransform: 'uppercase', letterSpacing: '0.06em' }}>{a.prioridad}</span>
                <span style={{ fontSize: '13px', color: C.parch }}>{a.accion}</span>
              </div>
              {a.fecha_sugerida && <div style={{ fontFamily: MONO, fontSize: '11px', color: C.muted }}>Sugerida para {fmtFecha(a.fecha_sugerida)}</div>}
              <div style={{ display: 'flex', gap: '8px' }}>
                <button disabled={busy} onClick={() => decidir(a.id, 'aprobada')}
                  style={{ ...btn(false, !busy), padding: '5px 12px', fontSize: '8px', borderColor: 'rgba(79,216,184,0.6)', color: C.mint }}>Aprobar</button>
                <button disabled={busy} onClick={() => decidir(a.id, 'descartada')}
                  style={{ ...btn(false, !busy), padding: '5px 12px', fontSize: '8px' }}>Descartar</button>
              </div>
            </div>
          ))}
        </div>
      )}

      {insights.slice(0, verTodas ? undefined : 2).map(i => {
        const c = comm(i.comm_id)
        return (
          <div key={i.id} style={{ borderLeft: `2px solid ${i.temperatura ? TEMP_COLOR[i.temperatura] : C.mint}`, paddingLeft: '10px', display: 'grid', gap: '4px' }}>
            <div style={{ fontSize: '11px', color: C.muted, display: 'flex', gap: '8px', alignItems: 'center', flexWrap: 'wrap' }}>
              <span style={{ fontFamily: MONO }}>{fmtFecha(c?.fecha ?? i.created_at)}</span>
              {c && <span>· correo {c.sentido}</span>}
              {i.temperatura && <Badge text={TEMPERATURA_LABEL[i.temperatura]} color={TEMP_COLOR[i.temperatura]} />}
            </div>
            {c && <div style={{ fontSize: '12px', color: C.muted }}>{c.resumen}</div>}
            <div style={{ fontSize: '13px', color: C.parch, lineHeight: 1.45 }}>{i.interpretacion}</div>
            {i.objeciones.length > 0 && <div style={{ fontSize: '12px', color: C.gold }}>Objeciones: {i.objeciones.join(' · ')}</div>}
          </div>
        )
      })}
      {insights.length > 2 && (
        <button onClick={() => setVerTodas(v => !v)} style={{ ...btn(false), justifySelf: 'start', padding: '4px 10px', fontSize: '8px' }}>
          {verTodas ? 'Ver menos' : `Ver las ${insights.length} lecturas`}
        </button>
      )}
      {decididas.length > 0 && (
        <div style={{ fontSize: '11px', color: C.muted }}>
          Decididas: {decididas.filter(a => a.estado === 'aprobada').length} aprobada(s) · {decididas.filter(a => a.estado === 'descartada').length} descartada(s)
        </div>
      )}
    </section>
  )
}

// ─── Contactos de seguimiento: los correos y dominios de los que el servicio sigue los hilos ───
function ContactosSeguimiento({ p, busy, run, onError }: {
  p: Prospect; busy: boolean; run: (fn: () => Promise<unknown>) => Promise<void>; onError: (e: string | null) => void
}) {
  const contactos = p.contacts ?? []
  const [tipo, setTipo] = useState<'email' | 'dominio'>('email')
  const [valor, setValor] = useState('')
  const [rol, setRol] = useState('')
  const personal = tipo === 'dominio' && esDominioPersonal(valor)
  const [aviso, setAviso] = useState<string | null>(null)
  // La revisión del historial la hace el servicio de comunicaciones; si no está conectado, el contacto
  // queda guardado igual y el aviso lo dice (no es un error del alta).
  const pedirHistorial = async (contactId: string) => {
    try { await api('/api/bizdev/contacts/historial', { method: 'POST', body: JSON.stringify({ contact_id: contactId }) }); setAviso(null) }
    catch (e) { setAviso(e instanceof Error ? e.message : 'No se pudo pedir la revisión del historial.') }
  }
  const agregar = () => {
    let c: { tipo: string; valor: string }
    try { c = normalizarContacto(tipo, valor) } catch (e) { onError(e instanceof Error ? e.message : 'Contacto inválido'); return }
    return run(async () => {
      const r = await api<{ contact: Contacto }>('/api/bizdev/contacts', { method: 'POST', body: JSON.stringify({ prospect_id: p.id, ...c, rol: rol.trim() || null }) })
      setValor(''); setRol('')
      // Al agregar un contacto se revisa su historial (Sam, 2026-11-04).
      if (r.contact?.id) await pedirHistorial(r.contact.id)
    })
  }
  const revisar = (id: string) => run(() => pedirHistorial(id))
  const quitar = (id: string) => run(() => api(`/api/bizdev/contacts?id=${id}`, { method: 'DELETE' }))

  return (
    <section style={{ ...card, display: 'grid', gap: '10px' }} aria-label="Contactos de seguimiento">
      <div style={{ ...cinzel(C.amatistaLight, 8) }}>Contactos de seguimiento de correo</div>
      <div style={{ fontSize: '12px', color: C.muted, lineHeight: 1.5 }}>
        El servicio de comunicaciones sigue solo los correos de estas direcciones o dominios. Al agregar un contacto se revisan
        los últimos 12 meses de correos desde y hacia él. Un correo que no es de ningún prospecto no se registra: llega un aviso
        por Telegram para que lo revises.
      </div>
      {contactos.length === 0 && <div style={{ fontSize: '12px', color: C.gold }}>Sin contactos: los correos de este prospecto no se siguen.</div>}
      {aviso && <div role="status" style={{ fontSize: '12px', color: C.gold }}>{aviso}</div>}
      {contactos.map(c => {
        const h = estadoHistorial(c, Date.now())
        const col = h.estado === 'completado' ? C.mint : h.estado === 'en_curso' ? C.gold : h.estado === 'nunca' ? C.muted : C.danger
        return (
          <div key={c.id} style={{ display: 'grid', gap: '4px', padding: '8px 0', borderBottom: '1px solid rgba(92,52,114,0.18)' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '13px', flexWrap: 'wrap' }}>
              <Badge text={c.tipo === 'email' ? 'correo' : 'dominio'} color={c.tipo === 'email' ? C.mint : C.amatistaLight} />
              <span style={{ fontFamily: MONO, fontSize: '12px', overflowWrap: 'anywhere' }}>{c.tipo === 'dominio' ? `@${c.valor}` : c.valor}</span>
              {c.rol && <span style={{ color: C.muted, fontSize: '12px' }}>· {c.rol}</span>}
              <span style={{ marginLeft: 'auto', display: 'inline-flex', gap: '6px' }}>
                <button disabled={busy || !h.puedeRevisar} onClick={() => revisar(c.id)} title="Revisa los últimos 12 meses de correos desde y hacia este contacto"
                  style={{ ...btn(false, !busy && h.puedeRevisar), padding: '3px 9px', fontSize: '8px', borderColor: 'rgba(79,216,184,0.5)', color: C.mint }}>
                  {h.estado === 'nunca' ? 'Revisar historial' : 'Revisar de nuevo'}
                </button>
                <button aria-label={`Quitar ${c.valor}`} disabled={busy} onClick={() => quitar(c.id)}
                  style={{ ...btn(false, !busy), padding: '2px 8px', fontSize: '10px' }}>×</button>
              </span>
            </div>
            <div style={{ fontSize: '11px', color: col }}>
              {h.texto}{h.estado === 'completado' && c.historial_terminado_el && <span style={{ color: C.muted }}> · {fmtFecha(c.historial_terminado_el)}</span>}
            </div>
          </div>
        )
      })}
      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0,110px) minmax(0,1fr)', gap: '8px' }}>
        <select aria-label="Tipo de contacto" style={{ ...inputStyle, cursor: 'pointer' }} value={tipo} onChange={e => setTipo(e.target.value as 'email' | 'dominio')}>
          <option value="email">Correo</option><option value="dominio">Dominio</option>
        </select>
        <input aria-label="Correo o dominio" style={{ ...inputStyle, fontFamily: MONO, fontSize: '12px' }} value={valor}
          placeholder={tipo === 'email' ? 'junta@ph.com' : 'ph.com'} onChange={e => setValor(e.target.value)} />
      </div>
      <input aria-label="Rol (opcional)" style={inputStyle} value={rol} placeholder="Rol (opcional), p. ej. Presidente de la Junta" onChange={e => setRol(e.target.value)} />
      {personal && (
        <div style={{ fontSize: '12px', color: C.danger }}>
          {valor.replace(/^@/, '')} es un proveedor de correo personal: como dominio, haría pasar por de este prospecto los correos de cualquiera. Agrega la dirección exacta.
        </div>
      )}
      <button style={{ ...btn(true, !!valor.trim() && !busy && !personal), justifySelf: 'start' }} disabled={!valor.trim() || busy || personal} onClick={agregar}>
        Agregar contacto
      </button>
    </section>
  )
}

// ════════════════════════════════════════════════════════════════
// CALCULADORA
function Calculadora(props: {
  params: FeeParams; result: ReturnType<typeof calcular>; prospects: Prospect[]
  prospectId: string; setProspectId: (id: string) => void
  phName: string; setPhName: (s: string) => void
  u: number; setU: (n: number) => void; m2: number; setM2: (n: number) => void
  casas: boolean; setCasas: (b: boolean) => void
  extra: PersonalExtra[]; setExtra: (x: PersonalExtra[]) => void
  sel: number; onPick: (i: number) => void
}) {
  const { params: P, result: r, extra, setExtra } = props
  const refIdx = Math.min(REF_MARGIN_INDEX, P.margenes.length - 1)
  const pct = (m: number) => `${Math.round(m * 100)} %`
  const updRow = (i: number, k: keyof PersonalExtra, v: string) => {
    const next = extra.map((row, j) => j !== i ? row : { ...row, [k]: k === 'tipo' ? (v as Contratacion) : Math.max(0, Number(v) || 0) })
    setExtra(next)
  }
  const chip = (t: Tier, txt: string) => (
    <span key={txt} style={{ display: 'inline-flex', gap: '6px', alignItems: 'center', border: `1px solid ${t === 0 ? C.danger : C.terra}`, borderRadius: '999px', padding: '3px 10px', ...cinzel(t === 0 ? C.danger : C.terraLight, 8) }}>
      {TIER_NOMBRES[t]} <span style={{ color: C.faint, letterSpacing: '0.1em' }}>{txt}</span>
    </span>
  )

  const kv: [string, string][] = [
    ['Costo base del PH', `$${usd(r.base)}`],
    ['  Parte m²', props.casas ? '—' : `$${usd(r.parteM2)}`],
    ['  Parte unidades', `$${usd(r.parteUnidades)}`],
    ['  Personal incluido (costo directo)', `$${usd(r.costoIncluidas)}`],
    ['  Aporte a la estructura central', `$${usd(r.base - r.costoIncluidas)}`],
    ['Costo fijo por PH (carga de planillas)', `$${usd(r.costoPorPh)}`],
    ['Personal agregado (costo directo)', `$${usd(r.extraCosto)}`],
    ['Costo total del PH', `$${usd(r.costo)}`],
    ['Costo de referencia', `$${usd(r.cm2, 4)}/m² · $${usd(r.cu)}/ud.`],
  ]

  return (
    <>
      <div className="bd-calc">
        <div style={{ display: 'grid', gap: '16px', minWidth: 0 }}>
          <TiersCard P={P} u={props.u} m2={props.m2} casas={props.casas} tierPH={r.tierPH} />

          <section style={{ ...card, display: 'grid', gap: '12px' }} aria-label="El PH">
            <div style={{ ...cinzel(C.amatistaLight, 9) }}>El PH</div>
            <div><label style={label} htmlFor="k-prospect">Prospecto</label>
              <select id="k-prospect" style={{ ...inputStyle, cursor: 'pointer' }} value={props.prospectId} onChange={e => props.setProspectId(e.target.value)}>
                <option value="">— Sin prospecto (solo cálculo) —</option>
                {props.prospects.map(p => <option key={p.id} value={p.id}>{p.short_name} · {p.code}</option>)}
              </select></div>
            <div><label style={label} htmlFor="k-ph">Nombre en la carta</label>
              <input id="k-ph" style={inputStyle} value={props.phName} onChange={e => props.setPhName(e.target.value)} placeholder="P.H. …" /></div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px' }}>
              <div><label style={label} htmlFor="k-u">Unidades</label>
                <input id="k-u" type="number" min={0} step={1} style={numInput} value={props.u} onChange={e => props.setU(Math.max(0, Number(e.target.value) || 0))} /></div>
              <div><label style={label} htmlFor="k-m2">m² privados</label>
                <input id="k-m2" type="number" min={0} step={100} style={{ ...numInput, opacity: props.casas ? 0.4 : 1 }} disabled={props.casas} value={props.m2} onChange={e => props.setM2(Math.max(0, Number(e.target.value) || 0))} /></div>
            </div>
            <div style={{ fontSize: '11px', color: C.faint }}>m² privados del Registro Público. En PH de casas, la superficie construida, nunca la del lote.</div>
            <label style={{ display: 'flex', gap: '8px', alignItems: 'center', fontSize: '13px' }}>
              <input type="checkbox" checked={props.casas} onChange={e => props.setCasas(e.target.checked)} style={{ accentColor: C.terra }} />
              PH de casas sin superficie construida (calcula solo por unidades)
            </label>
          </section>

          <section style={{ ...card, display: 'grid', gap: '12px' }} aria-label="Personal">
            <div style={{ ...cinzel(C.amatistaLight, 9) }}>Personal</div>
            <div style={{ border: `1px solid ${C.terra}`, background: 'rgba(196,98,45,0.06)', borderRadius: '8px', padding: '12px', display: 'grid', gap: '4px' }}>
              <span style={{ ...cinzel(C.muted, 8) }}>Personal incluido en el precio base</span>
              <span style={{ fontFamily: MONO, fontSize: '22px' }}>{usd(r.incluidas, 1)} {r.incluidas === 1 ? 'persona' : 'personas'}</span>
              <span style={{ fontSize: '12px', color: C.parch }}>
                {usd(r.incluidas, 1)} × salario de tiempo completo ${usd(P.salario_std, 0)} = <b style={{ color: C.mint }}>${usd(r.incluidas * P.salario_std)}</b> de salario
                · con {usd(P.carga_planilla * 100, 1)} % de carga: <b>${usd(r.costoIncluidas)}</b> al mes.
              </span>
              <span style={{ fontSize: '11px', color: C.muted }}>
                0.5 = medio tiempo y medio salario; 1.0 = tiempo completo. Cálculo exacto: {usd(r.personasCalc)} (redondeado a 0.5, mínimo {P.piso_personas}). No aparece en la carta.
              </span>
              {r.extraPersonas > 0 && <span style={{ fontSize: '12px' }}><b>Total con lo agregado: {usd(r.incluidas + r.extraPersonas, 1)} personas.</b></span>}
            </div>
            <div style={{ fontSize: '11px', color: C.faint }}>Si la Junta pide más personal, o ForumPHs decide asignarlo, agrégalo aquí con su salario.</div>
            {extra.map((row, i) => (
              <div key={i} style={{ display: 'grid', gridTemplateColumns: 'minmax(0,.8fr) minmax(0,1fr) minmax(0,1.4fr) auto', gap: '8px', alignItems: 'end' }}>
                <div><label style={label} htmlFor={`x-q${i}`}>Personas</label>
                  <input id={`x-q${i}`} type="number" min={0} step={0.5} style={numInput} value={row.personas} onChange={e => updRow(i, 'personas', e.target.value)} /></div>
                <div><label style={label} htmlFor={`x-s${i}`}>Salario 1.0 US$</label>
                  <input id={`x-s${i}`} type="number" min={0} step={25} style={numInput} value={row.salario} onChange={e => updRow(i, 'salario', e.target.value)} /></div>
                <div><label style={label} htmlFor={`x-t${i}`}>Contratación</label>
                  <select id={`x-t${i}`} style={inputStyle} value={row.tipo} onChange={e => updRow(i, 'tipo', e.target.value)}>
                    <option value="planilla">Planilla (+ carga)</option>
                    <option value="servicios">Servicios profesionales</option>
                  </select></div>
                <button aria-label="Quitar esta fila" onClick={() => setExtra(extra.filter((_, j) => j !== i))} style={{ ...btn(false), padding: '8px 12px' }}>×</button>
                <div style={{ gridColumn: '1 / -1', fontSize: '12px', color: C.parch, marginTop: '-2px' }}>
                  {usd(row.personas, 1)} × ${usd(row.salario, 0)} = <b style={{ color: C.mint }}>${usd(row.personas * row.salario)}</b> de salario
                  {row.tipo === 'planilla'
                    ? <> · con {usd(P.carga_planilla * 100, 1)} % de carga: <b>${usd(row.personas * row.salario * (1 + P.carga_planilla))}</b> al mes</>
                    : <> · servicios profesionales, sin carga</>}
                </div>
              </div>
            ))}
            <div style={{ fontSize: '11px', color: C.muted }}>El salario es el de tiempo completo (1.0). Con 0.5 personas se cuenta la mitad: medio tiempo, medio salario.</div>
            <button style={{ ...btn(true), justifySelf: 'start' }} onClick={() => setExtra([...extra, { personas: 0.5, salario: P.salario_std, tipo: 'planilla' }])}>+ Agregar personal</button>
          </section>
        </div>

        <section style={{ ...card, display: 'grid', gap: '14px' }} aria-label="Honorario por margen" aria-live="polite">
          <div style={{ ...cinzel(C.terra, 10) }}>Honorario por margen</div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px' }}>
            {chip(r.tierUnidades, 'por unidades')}
            {r.tierM2 !== null && chip(r.tierM2, 'por m²')}
            {chip(r.tierPrecioBase, `por precio base al ${pct(P.margenes[refIdx])}`)}
          </div>
          <div className="bd-margins">
            {r.margenes.map((m, i) => (
              <button key={m} className="bd-margin" onClick={() => props.onPick(i)} aria-pressed={i === props.sel}
                style={{ textAlign: 'left', cursor: 'pointer', borderRadius: '8px', padding: '12px', display: 'grid', gap: '3px', minWidth: 0, color: C.parch,
                  background: i === props.sel ? 'rgba(92,52,114,0.25)' : 'rgba(14,16,24,0.6)',
                  border: `1px solid ${i === props.sel ? C.terra : C.line}` }}>
                <span style={{ ...cinzel(C.muted, 8) }}>Margen {pct(m)}</span>
                <span style={{ fontFamily: MONO, fontSize: '19px', overflowWrap: 'anywhere' }}>${usd(r.honorarios[i])}</span>
                {r.extraCosto > 0 && <span style={{ fontFamily: MONO, fontSize: '10px', color: C.terraLight }}>base ${usd(r.honorariosBase[i])} + ${usd(r.honorarios[i] - r.honorariosBase[i])}</span>}
                <span style={{ fontFamily: MONO, fontSize: '10px', color: C.faint }}>con ITBMS ${usd(r.conItbms[i])}</span>
                {!props.casas && props.m2 > 0 && <span style={{ fontFamily: MONO, fontSize: '10px', color: C.faint }}>${usd(r.honorarios[i] / props.m2, 3)}/m²</span>}
                <span style={{ ...cinzel(C.terra, 7), marginTop: '4px' }}>Elegir → propuesta</span>
              </button>
            ))}
          </div>
          {r.avisos.length > 0 && (
            <div style={{ background: 'rgba(196,98,45,0.07)', borderLeft: `3px solid ${C.terra}`, borderRadius: '6px', padding: '10px 12px', fontSize: '12px', color: C.terraLight, display: 'grid', gap: '4px' }}>
              {r.avisos.map(a => <div key={a}>{a}</div>)}
            </div>
          )}
          <dl style={{ display: 'grid', gridTemplateColumns: 'minmax(0,1fr) auto', gap: '6px 16px', margin: 0, fontSize: '13px' }}>
            {kv.map(([k, v]) => (
              <div key={k} style={{ display: 'contents' }}>
                <dt style={{ color: C.muted, whiteSpace: 'pre' }}>{k}</dt>
                <dd style={{ margin: 0, fontFamily: MONO, textAlign: 'right' }}>{v}</dd>
              </div>
            ))}
          </dl>
          <div style={{ fontSize: '11px', color: C.faint }}>Parámetros {P.version}{P.valid_from ? ` · vigentes desde ${P.valid_from}` : ''}. Cifras en US$ al mes, sin ITBMS.</div>
        </section>
      </div>

      <section style={card} aria-label="Cartera actual">
        <div style={{ ...cinzel(C.terra, 10), marginBottom: '12px' }}>Cartera actual con la misma fórmula (margen de {pct(P.margenes[refIdx])})</div>
        <div style={{ overflowX: 'auto' }}>
          <CarteraTable P={P} refIdx={refIdx} />
        </div>
        <p style={{ fontSize: '11px', color: C.faint, margin: '10px 0 0' }}>En Alamos (PH de casas) se usan solo las unidades: sus m² son de lote. «Personal hoy» es el equivalente a tiempo completo asignado a cada PH.</p>
      </section>
    </>
  )
}

/** Tarjeta fija con los rangos de cada tier, leídos de fphs_fee_params.tiers (dato, no código). */
function TiersCard({ P, u, m2, casas, tierPH }: { P: FeeParams; u: number; m2: number; casas: boolean; tierPH: Tier }) {
  const [ua, ub] = P.tiers.unidades
  const [ma, mb] = P.tiers.m2
  const [, pa, pb] = P.tiers.precio
  const n0 = (n: number) => usd(n, 0)
  const filas: { t: Tier; nombre: string; uds: string; m2: string; precio: string }[] = [
    { t: 1, nombre: 'Esencial', uds: `< ${n0(ua)}`, m2: `< ${n0(ma)}`, precio: `$${n0(P.tiers.precio[0])} – $${n0(pa)}` },
    { t: 2, nombre: 'Profesional', uds: `${n0(ua)} – ${n0(ub - 1)}`, m2: `${n0(ma)} – ${n0(mb)}`, precio: `$${n0(pa)} – $${n0(pb)}` },
    { t: 3, nombre: 'Élite', uds: `≥ ${n0(ub)}`, m2: `> ${n0(mb)}`, precio: `≥ $${n0(pb)}` },
  ]
  return (
    <section style={{ ...card, padding: '16px', borderTop: `3px solid ${C.mint}` }} aria-label="Tiers">
      <div style={{ display: 'flex', alignItems: 'baseline', gap: '8px', marginBottom: '10px' }}>
        <div style={{ ...cinzel(C.mint, 9) }}>Tiers</div>
        <span style={{ fontSize: '11px', color: C.muted }}>parámetros {P.version} · el mayor entre unidades y m²</span>
      </div>
      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '12px' }}>
        <thead><tr>
          {['Tier', 'Unidades', 'm²', 'Honorario'].map(h => (
            <th key={h} style={{ textAlign: h === 'Tier' ? 'left' : 'right', ...cinzel(C.label, 7), padding: '4px 4px 6px', borderBottom: `1px solid ${C.line}` }}>{h}</th>
          ))}
        </tr></thead>
        <tbody>
          {filas.map(f => {
            const on = f.t === tierPH
            return (
              <tr key={f.t} style={{ background: on ? C.mintSoft : 'transparent' }}>
                <td style={{ padding: '7px 4px', fontWeight: 600, color: on ? C.mint : C.parch, whiteSpace: 'nowrap' }}>{on ? '● ' : ''}{f.nombre}</td>
                <td style={{ padding: '7px 4px', textAlign: 'right', fontFamily: MONO, color: on ? C.parch : C.muted, whiteSpace: 'nowrap' }}>{f.uds}</td>
                <td style={{ padding: '7px 4px', textAlign: 'right', fontFamily: MONO, color: on ? C.parch : C.muted, whiteSpace: 'nowrap' }}>{f.m2}</td>
                <td style={{ padding: '7px 4px', textAlign: 'right', fontFamily: MONO, color: on ? C.parch : C.muted, whiteSpace: 'nowrap' }}>{f.precio}</td>
              </tr>
            )
          })}
        </tbody>
      </table>
      <div style={{ fontSize: '11px', color: C.muted, marginTop: '8px' }}>
        Este PH: <b style={{ color: C.mint }}>{TIER_NOMBRES[tierPH]}</b> · {u} unidades{casas ? ' · PH de casas' : ` · ${usd(m2, 0)} m²`}. Honorario al mes, sin ITBMS.
      </div>
    </section>
  )
}

function CarteraTable({ P, refIdx }: { P: FeeParams; refIdx: number }) {
  let tot = 0, act = 0
  const rows = CARTERA.map(ph => {
    const r = calcular(P, { u: ph.unidades, m2: ph.m2, casas: ph.casas })
    const fee = r.honorarios[refIdx]; tot += fee; act += ph.cobraHoy
    const t = tierPorPrecio(P, fee)
    return (
      <tr key={ph.nombre}>
        <td style={{ fontFamily: "'DM Sans',sans-serif" }}>{ph.nombre}</td>
        <td>{ph.unidades}</td><td>{ph.casas ? 'lotes' : usd(ph.m2)}</td>
        <td>{usd(ph.cobraHoy)}</td><td>{usd(fee)}</td>
        <td>{(ph.cobraHoy / fee * 100 - 100).toFixed(0)} %</td>
        <td>{usd(ph.personalHoy)}</td><td>{usd(r.incluidas, 1)}</td>
        <td style={{ fontFamily: "'DM Sans',sans-serif" }}>{TIER_NOMBRES[t]}</td>
      </tr>
    )
  })
  return (
    <table className="bd-table">
      <thead><tr><th>PH</th><th>Uds.</th><th>m²</th><th>Cobra hoy</th><th>Modelo</th><th>Hoy vs modelo</th><th>Personal hoy</th><th>Personal incluido</th><th>Tier por precio</th></tr></thead>
      <tbody>
        {rows}
        <tr><td style={{ fontFamily: "'DM Sans',sans-serif" }}><b>Total</b></td><td /><td />
          <td><b>{usd(act)}</b></td><td><b>{usd(tot)}</b></td><td>{(act / tot * 100 - 100).toFixed(0)} %</td><td /><td /><td /></tr>
      </tbody>
    </table>
  )
}

// ════════════════════════════════════════════════════════════════
// PROPUESTA
function Propuesta({ params, result, sel, setSel, ph, u, m2, casas, extra, prospect, onSaved, onError }: {
  params: FeeParams; result: ReturnType<typeof calcular>; sel: number; setSel: (i: number) => void
  ph: string; u: number; m2: number; casas: boolean; extra: PersonalExtra[]
  prospect: Prospect | null; onSaved: () => Promise<void>; onError: (e: string | null) => void
}) {
  const input = { ph: ph || 'el PH', u, m2, casas, result, sel, itbms: params.itbms }
  const text = buildLetter(input, params)
  const a = letterAmounts(params, input)
  const [status, setStatus] = useState('')
  const [busy, setBusy] = useState(false)
  // Evita guardar dos veces la misma propuesta (medido 2026-11-02: un doble guardado creó 2 cotizaciones y 2 comunicaciones).
  const lock = useRef(false)
  const saveKey = JSON.stringify([prospect?.id ?? '', sel, u, m2, casas, extra, params.version])
  const [savedKey, setSavedKey] = useState<string | null>(null)
  const yaGuardada = savedKey === saveKey
  // Borrador guardado para esta misma propuesta: «Guardar como enviada» lo marca en vez de crear otra cotización.
  const [borrador, setBorrador] = useState<{ key: string; id: string } | null>(null)
  const borradorActual = borrador?.key === saveKey ? borrador.id : null

  const copiar = async () => {
    try { await navigator.clipboard.writeText(text); setStatus('Texto copiado.') }
    catch { setStatus('No se pudo copiar: selecciona el texto y copia con Ctrl/Cmd+C.') }
  }
  const descargar = async () => {
    try {
      const blob = await buildProposalDocx(input, params)
      const url = URL.createObjectURL(blob)
      const el = document.createElement('a')
      el.href = url; el.download = `Propuesta_${(ph || 'PH').replace(/[^a-zA-Z0-9]+/g, '_')}_${hoyISO()}.docx`
      el.click(); URL.revokeObjectURL(url); setStatus('.docx descargado.')
    } catch (e) { onError(e instanceof Error ? e.message : 'Error generando .docx') }
  }
  const crearCotizacion = () => api<{ quote: Quote }>('/api/bizdev/quotes', {
    method: 'POST', body: JSON.stringify({
      prospect_id: prospect!.id, margen: params.margenes[sel], unidades: u, m2, es_casas: casas, personal_extra: extra,
    }),
  })
  const guardarBorrador = async () => {
    if (!prospect || lock.current || yaGuardada || borradorActual) return
    lock.current = true
    setBusy(true); onError(null)
    try {
      const { quote } = await crearCotizacion()
      setBorrador({ key: saveKey, id: quote.id })
      setStatus(`Borrador guardado: $${usd(Number(quote.honorario))} en la ficha de ${prospect.short_name}. Aún no cuenta como enviada.`)
      await onSaved()
    } catch (e) { onError(e instanceof Error ? e.message : 'Error guardando') } finally { setBusy(false); lock.current = false }
  }
  const guardarEnviada = async () => {
    if (!prospect || lock.current || yaGuardada) return
    lock.current = true
    setBusy(true); onError(null)
    try {
      const quote = borradorActual ? { id: borradorActual, honorario: a.honorario } : (await crearCotizacion()).quote
      await api('/api/bizdev/quotes', { method: 'PATCH', body: JSON.stringify({ id: quote.id, estado: 'enviada' }) })
      setSavedKey(saveKey)
      setStatus(`Guardada como enviada: $${usd(Number(quote.honorario))} en la línea de tiempo de ${prospect.short_name}.`)
      await onSaved()
    } catch (e) { onError(e instanceof Error ? e.message : 'Error guardando') } finally { setBusy(false); lock.current = false }
  }

  return (
    <section style={{ ...card, display: 'grid', gap: '14px' }} aria-label="Propuesta para la Junta Directiva">
      <div style={{ ...cinzel(C.terra, 10) }}>Propuesta para la Junta Directiva</div>
      <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', alignItems: 'center' }}>
        <span style={{ ...cinzel(C.muted, 8) }}>Margen (uso interno, no sale en la carta)</span>
        {result.margenes.map((m, i) => (
          <button key={m} onClick={() => setSel(i)} aria-pressed={i === sel}
            style={{ ...btn(i === sel), padding: '5px 10px' }}>{Math.round(m * 100)} %</button>
        ))}
      </div>
      <div style={{ fontSize: '12px', color: C.muted }}>
        Tier {a.tier} · honorario <span style={{ fontFamily: MONO }}>${usd(a.honorario)}</span> + ITBMS <span style={{ fontFamily: MONO }}>${usd(a.itbms)}</span> = <span style={{ fontFamily: MONO }}>${usd(a.total)}</span>.
        Personal base incluido: {usd(result.incluidas, 1)} (no se menciona en la carta).
      </div>
      <div style={{ whiteSpace: 'pre-wrap', fontFamily: "'EB Garamond',serif", fontSize: '16px', lineHeight: 1.6, background: C.cream, color: C.carbon, borderRadius: '8px', padding: '24px 28px', maxWidth: '75ch', overflowWrap: 'anywhere', borderTop: `3px solid ${C.terra}` }}>
        {text}
      </div>
      <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap', alignItems: 'center' }}>
        <button style={btn(true)} onClick={copiar}>Copiar texto</button>
        <button style={btn(false)} onClick={descargar}>Descargar .docx</button>
        <button style={{ ...btn(false, !!prospect && !busy && !yaGuardada && !borradorActual), borderColor: 'rgba(79,216,184,0.5)', color: C.mint }}
          disabled={!prospect || busy || yaGuardada || !!borradorActual} onClick={guardarBorrador}
          title={prospect ? 'Guarda la cotización sin marcarla como enviada' : 'Elige un prospecto en la Calculadora'}>
          {borradorActual ? 'Borrador guardado ✓' : 'Guardar borrador'}
        </button>
        <button style={btn(true, !!prospect && !busy && !yaGuardada)} disabled={!prospect || busy || yaGuardada} onClick={guardarEnviada}
          title={prospect ? '' : 'Elige un prospecto en la Calculadora para registrar el envío'}>
          {busy ? 'Guardando…' : yaGuardada ? 'Guardada ✓' : 'Guardar como enviada'}
        </button>
        <span role="status" style={{ fontSize: '12px', color: yaGuardada || borradorActual ? C.mint : C.muted }}>
          {status || (!prospect && 'Para guardar, elige un prospecto en la Calculadora.')}
        </span>
      </div>
    </section>
  )
}
