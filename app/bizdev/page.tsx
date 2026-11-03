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

// ─── Tipos de datos (filas de unrlvl-db) ─────────────────────────
interface Quote {
  id: string; prospect_id: string; params_version: string; margen: number; unidades: number; m2: number
  es_casas: boolean; personal_incluido: number; personal_extra: PersonalExtra[]; costo_base: number
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
}

type View = 'dashboard' | 'calc' | 'prop'

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
  label: 'rgba(225,218,210,0.82)', danger: '#E07A5F', success: '#7FB685', gold: '#E8B86B',
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
    setExtra([]); setSel(REF_MARGIN_INDEX); setFichaId(null); setView('calc')
  }

  const ficha = prospects.find(p => p.id === fichaId) ?? null

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
          {([['dashboard', 'Dashboard'], ['calc', 'Calculadora'], ['prop', 'Propuesta']] as [View, string][]).map(([k, l]) => (
            <button key={k} role="tab" aria-selected={view === k} onClick={() => setView(k)}
              style={{ background: 'none', border: 'none', borderBottom: `2px solid ${view === k ? C.terra : 'transparent'}`, padding: '10px 16px', cursor: 'pointer', ...cinzel(view === k ? C.terra : 'rgba(240,237,232,0.3)') }}>
              {l}
            </button>
          ))}
        </div>
      </div>

      <main style={{ maxWidth: '1320px', margin: '0 auto', padding: '24px 28px', display: 'grid', gap: '16px' }}>
        {error && (
          <div role="alert" style={{ background: 'rgba(196,98,45,0.07)', border: '1px solid rgba(196,98,45,0.25)', borderLeft: `3px solid ${C.terra}`, borderRadius: '8px', padding: '14px 18px', fontSize: '13px', color: C.terra }}>
            {error}
          </div>
        )}
        {loading && <div style={{ ...cinzel(C.muted) }}>Cargando…</div>}

        {!loading && params && view === 'dashboard' && (
          <Dashboard params={params} prospects={prospects} onOpen={setFichaId} onReload={reload} onError={setError} />
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

      {ficha && params && (
        <Ficha
          p={ficha} params={params} onClose={() => setFichaId(null)}
          onNuevaCotizacion={() => openCalcFor(ficha)} onReload={reload} onError={setError}
        />
      )}
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

function Dashboard({ params, prospects, onOpen, onReload, onError }: {
  params: FeeParams; prospects: Prospect[]; onOpen: (id: string) => void
  onReload: () => Promise<void>; onError: (e: string | null) => void
}) {
  const hoy = hoyISO()
  const hace30 = new Date(Date.now() - 30 * 864e5).toISOString().slice(0, 10)
  const activos = prospects.filter(p => !INACTIVAS.has(p.etapa))
  const cotizados = activos.filter(p => p.quotes[0])
  const cartera = cotizados.reduce((s, p) => s + Number(p.quotes[0].honorario), 0)
  const enviadas30 = prospects.flatMap(p => p.quotes).filter(q => q.estado === 'enviada' && q.enviada_el && q.enviada_el >= hace30).length
  const ganados = prospects.filter(p => p.etapa === 'ganado').length
  const perdidos = prospects.filter(p => p.etapa === 'perdido').length
  const vencidas = activos.filter(p => p.proxima_fecha && p.proxima_fecha < hoy).length

  const [filtro, setFiltro] = useState<string | null>(null)
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
      sub: cotizados.length ? `${cotizados.length} prospecto(s) con cotización · sin ITBMS` : 'Sin cotizaciones guardadas todavía' },
    { k: 'Prospectos activos', v: String(activos.length), color: C.amatistaLight, sub: `${prospects.length} en total` },
    { k: 'Propuestas enviadas', v: String(enviadas30), color: C.parch, sub: 'últimos 30 días' },
    { k: 'Tasa de cierre', v: ganados + perdidos ? `${Math.round((ganados / (ganados + perdidos)) * 100)} %` : '—', color: C.success,
      sub: `${ganados} ganado(s) · ${perdidos} perdido(s)` },
    { k: 'Acciones vencidas', v: String(vencidas), color: vencidas > 0 ? C.danger : C.muted,
      sub: vencidas > 0 ? 'requieren seguimiento' : 'todo al día' },
  ]

  const lista = (filtro ? prospects.filter(p => p.etapa === filtro) : prospects)
    .slice().sort((a, b) => ETAPAS.findIndex(e => e.key === b.etapa) - ETAPAS.findIndex(e => e.key === a.etapa))
  const acciones = activos.filter(p => p.proxima_fecha || p.proxima_accion)
    .slice().sort((a, b) => (a.proxima_fecha ?? '9999').localeCompare(b.proxima_fecha ?? '9999'))
  const actividad = prospects.flatMap(p => p.comms.map(c => ({ c, p })))
    .sort((a, b) => b.c.fecha.localeCompare(a.c.fecha)).slice(0, 6)
  const maxEtapa = Math.max(1, ...ETAPAS.map(e => prospects.filter(p => p.etapa === e.key).length))

  return (
    <>
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
            const n = prospects.filter(p => p.etapa === et.key).length
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
            <div style={{ ...cinzel(C.terra, 10) }}>Prospectos</div>
            <span style={{ fontSize: '12px', color: C.muted }}>
              {filtro ? `${lista.length} en ${ETAPAS.find(e => e.key === filtro)?.label}` : `${lista.length} en total`} · clic para abrir la ficha
            </span>
          </div>
          <div style={{ overflowX: 'auto' }}>
            <table className="bd-ptable">
              <thead><tr>
                <th>Prospecto</th><th>Etapa</th><th>Tier</th><th className="r">Tamaño</th>
                <th className="r">Última cotización</th><th>Próxima acción</th><th>Última comunicación</th>
              </tr></thead>
              <tbody>
                {lista.length === 0 && (
                  <tr><td colSpan={7} style={{ padding: '22px 18px', color: C.muted }}>No hay prospectos en esta etapa.</td></tr>
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
                      </td>
                      <td><Badge text={et?.label ?? p.etapa} color={ETAPA_COLOR[p.etapa]} /></td>
                      <td>{tier ? <Badge text={tier} color={TIER_COLOR[tier]} /> : <span style={{ color: C.muted }}>—</span>}</td>
                      <td className="r" style={{ fontFamily: MONO, fontSize: '12px', color: C.parch, whiteSpace: 'nowrap' }}>
                        {p.unidades ?? '—'} uds.<br /><span style={{ color: C.muted }}>{p.es_casas ? 'casas' : p.m2_privados != null ? `${usd(Number(p.m2_privados), 0)} m²` : '—'}</span>
                      </td>
                      <td className="r">
                        {q ? (<>
                          <div style={{ fontFamily: MONO, fontSize: '15px', fontWeight: 700, color: C.terra }}>${usd(Number(q.honorario))}</div>
                          <div style={{ fontSize: '11px', color: C.muted }}>{Math.round(Number(q.margen) * 100)} % · {q.estado}</div>
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
                      <span style={{ fontWeight: 600, fontSize: '13px' }}>{p.short_name}</span>
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
            {actividad.length === 0 && <div style={{ fontSize: '13px', color: C.muted }}>Sin comunicaciones registradas.</div>}
            <div style={{ display: 'grid', gap: '12px' }}>
              {actividad.map(({ c, p }) => (
                <div key={c.id} style={{ borderLeft: `2px solid ${c.sentido === 'interno' ? C.amatistaLight : C.terra}`, paddingLeft: '10px' }}>
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
function Ficha({ p, params, onClose, onNuevaCotizacion, onReload, onError }: {
  p: Prospect; params: FeeParams; onClose: () => void; onNuevaCotizacion: () => void
  onReload: () => Promise<void>; onError: (e: string | null) => void
}) {
  const [etapa, setEtapa] = useState(p.etapa)
  const [accion, setAccion] = useState(p.proxima_accion ?? '')
  const [fecha, setFecha] = useState(p.proxima_fecha ?? '')
  const [comm, setComm] = useState({ fecha: hoyISO(), canal: 'whatsapp', sentido: 'enviado', resumen: '', doc_ref: '' })
  const [showComm, setShowComm] = useState(false)
  const [busy, setBusy] = useState(false)

  useEffect(() => { setEtapa(p.etapa); setAccion(p.proxima_accion ?? ''); setFecha(p.proxima_fecha ?? '') }, [p])
  useEffect(() => {
    const k = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', k); return () => window.removeEventListener('keydown', k)
  }, [onClose])

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

  const timeline = [
    ...p.comms.map(c => ({ t: c.fecha, kind: 'comm' as const, c })),
    ...p.quotes.map(q => ({ t: q.created_at, kind: 'quote' as const, q })),
  ].sort((a, b) => b.t.localeCompare(a.t))
  const tier = p.unidades != null ? TIER_NOMBRES[tierFromSize(params, p.unidades, Number(p.m2_privados ?? 0), p.es_casas)] : '—'

  return (
    <div role="dialog" aria-modal="true" aria-label={`Ficha de ${p.short_name}`} onClick={onClose}
      style={{ position: 'fixed', inset: 0, zIndex: 300, background: 'rgba(8,6,14,0.7)', display: 'flex', justifyContent: 'flex-end' }}>
      <div onClick={e => e.stopPropagation()}
        style={{ width: 'min(560px,100%)', height: '100%', overflowY: 'auto', background: C.carbonDark, borderLeft: `1px solid ${C.line}`, padding: '28px', display: 'grid', gap: '16px', alignContent: 'start' }}>
        <div style={{ display: 'flex', alignItems: 'start', gap: '12px' }}>
          <div>
            <div style={{ ...cinzel(C.terra, 9), opacity: 0.85 }}>{p.code} · {tier}</div>
            <h2 style={{ fontFamily: "'EB Garamond',serif", fontWeight: 400, fontSize: '30px', margin: '6px 0 0' }}>{p.short_name}</h2>
            {p.full_name && <div style={{ color: C.muted, fontSize: '13px' }}>{p.full_name}</div>}
          </div>
          <button aria-label="Cerrar" onClick={onClose} style={{ marginLeft: 'auto', ...btn(false) }}>×</button>
        </div>

        <div style={card}>
          <div style={{ ...cinzel(C.amatistaLight, 8), marginBottom: '10px' }}>Tamaño</div>
          <dl style={{ display: 'grid', gridTemplateColumns: 'auto 1fr', gap: '6px 16px', margin: 0, fontSize: '13px' }}>
            <dt style={{ color: C.muted }}>Unidades</dt><dd style={{ margin: 0, fontFamily: MONO }}>{p.unidades ?? '—'}</dd>
            <dt style={{ color: C.muted }}>m² privados</dt><dd style={{ margin: 0, fontFamily: MONO }}>{p.es_casas ? 'PH de casas' : p.m2_privados != null ? usd(Number(p.m2_privados)) : '—'}</dd>
            <dt style={{ color: C.muted }}>Evidencia</dt><dd style={{ margin: 0 }}>{[p.clase_evidencia && `Clase ${p.clase_evidencia}`, p.fuente_tamano].filter(Boolean).join(' · ') || '—'}</dd>
            {p.contacto_nombre && <><dt style={{ color: C.muted }}>Contacto</dt><dd style={{ margin: 0 }}>{p.contacto_nombre}{p.contacto_rol ? ` · ${p.contacto_rol}` : ''}</dd></>}
          </dl>
        </div>

        <div style={{ ...card, display: 'grid', gap: '10px' }}>
          <div style={{ ...cinzel(C.amatistaLight, 8) }}>Seguimiento</div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px' }}>
            <div><label style={label} htmlFor="f-etapa">Etapa</label>
              <select id="f-etapa" style={{ ...inputStyle, cursor: 'pointer' }} value={etapa} onChange={e => setEtapa(e.target.value)}>
                {ETAPAS.map(e => <option key={e.key} value={e.key}>{e.label}</option>)}
              </select></div>
            <div><label style={label} htmlFor="f-fecha">Fecha</label>
              <input id="f-fecha" type="date" style={numInput} value={fecha} onChange={e => setFecha(e.target.value)} /></div>
          </div>
          <div><label style={label} htmlFor="f-accion">Próxima acción</label>
            <input id="f-accion" style={inputStyle} value={accion} onChange={e => setAccion(e.target.value)} /></div>
          <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
            <button style={btn(true, !busy)} disabled={busy} onClick={guardar}>Guardar</button>
            <button style={btn(false)} onClick={onNuevaCotizacion}>Nueva cotización</button>
            <button style={btn(false)} onClick={() => setShowComm(v => !v)}>Registrar comunicación</button>
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

        <div style={{ display: 'grid', gap: '10px' }}>
          <div style={{ ...cinzel(C.terra, 9) }}>Línea de tiempo</div>
          {timeline.length === 0 && <div style={{ color: C.faint, fontSize: '13px' }}>Sin registros.</div>}
          {timeline.map(it => it.kind === 'comm' ? (
            <div key={`c-${it.c.id}`} style={{ borderLeft: `2px solid ${it.c.sentido === 'interno' ? C.amatista : C.terra}`, paddingLeft: '12px', display: 'grid', gap: '2px' }}>
              <div style={{ fontSize: '11px', color: C.muted }}>
                <span style={{ fontFamily: MONO }}>{fmtFecha(it.c.fecha)}</span> · {CANAL_LABEL[it.c.canal] ?? it.c.canal} · {it.c.sentido}
                {it.c.origen !== 'manual' && ` · ${it.c.origen === 'document_factory' ? 'Document Factory' : it.c.origen}`}
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
                ${usd(Number(it.q.honorario))} · {Math.round(Number(it.q.margen) * 100)} % · {it.q.params_version}
                {Array.isArray(it.q.personal_extra) && it.q.personal_extra.length > 0 && ' · con personal adicional'}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
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
              <span style={{ fontSize: '11px', color: C.muted }}>
                Salario ${usd(P.salario_std, 0)} + {usd(P.carga_planilla * 100, 1)} % de carga patronal = ${usd(r.costoPersona)} por persona al mes.
                Cálculo exacto: {usd(r.personasCalc)} (redondeado a 0.5, mínimo {P.piso_personas}). No aparece en la carta.
              </span>
              {r.extraPersonas > 0 && <span style={{ fontSize: '12px' }}><b>Total con lo agregado: {usd(r.incluidas + r.extraPersonas, 1)} personas.</b></span>}
            </div>
            <div style={{ fontSize: '11px', color: C.faint }}>Si la Junta pide más personal, o ForumPHs decide asignarlo, agrégalo aquí con su salario.</div>
            {extra.map((row, i) => (
              <div key={i} style={{ display: 'grid', gridTemplateColumns: 'minmax(0,.8fr) minmax(0,1fr) minmax(0,1.4fr) auto', gap: '8px', alignItems: 'end' }}>
                <div><label style={label} htmlFor={`x-q${i}`}>Personas</label>
                  <input id={`x-q${i}`} type="number" min={0} step={0.5} style={numInput} value={row.personas} onChange={e => updRow(i, 'personas', e.target.value)} /></div>
                <div><label style={label} htmlFor={`x-s${i}`}>Salario US$</label>
                  <input id={`x-s${i}`} type="number" min={0} step={25} style={numInput} value={row.salario} onChange={e => updRow(i, 'salario', e.target.value)} /></div>
                <div><label style={label} htmlFor={`x-t${i}`}>Contratación</label>
                  <select id={`x-t${i}`} style={inputStyle} value={row.tipo} onChange={e => updRow(i, 'tipo', e.target.value)}>
                    <option value="planilla">Planilla (+ carga)</option>
                    <option value="servicios">Servicios profesionales</option>
                  </select></div>
                <button aria-label="Quitar esta fila" onClick={() => setExtra(extra.filter((_, j) => j !== i))} style={{ ...btn(false), padding: '8px 12px' }}>×</button>
              </div>
            ))}
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
  const guardarEnviada = async () => {
    if (!prospect || lock.current || yaGuardada) return
    lock.current = true
    setBusy(true); onError(null)
    try {
      const { quote } = await api<{ quote: Quote }>('/api/bizdev/quotes', {
        method: 'POST', body: JSON.stringify({
          prospect_id: prospect.id, margen: params.margenes[sel], unidades: u, m2, es_casas: casas, personal_extra: extra,
        }),
      })
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
        <button style={btn(true, !!prospect && !busy && !yaGuardada)} disabled={!prospect || busy || yaGuardada} onClick={guardarEnviada}
          title={prospect ? '' : 'Elige un prospecto en la Calculadora para registrar el envío'}>
          {busy ? 'Guardando…' : yaGuardada ? 'Guardada ✓' : 'Guardar como enviada'}
        </button>
        <span role="status" style={{ fontSize: '12px', color: C.muted }}>
          {status || (!prospect && 'Para guardar, elige un prospecto en la Calculadora.')}
        </span>
      </div>
    </section>
  )
}
