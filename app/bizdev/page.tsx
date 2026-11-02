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
  muted: 'rgba(240,237,232,0.45)', faint: 'rgba(240,237,232,0.25)', line: 'rgba(92,52,114,0.3)',
  danger: '#E07A5F',
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
const label: React.CSSProperties = { ...cinzel('rgba(184,176,168,0.6)', 8), display: 'block', marginBottom: '5px' }
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
        .bd-cols{display:grid;grid-auto-flow:column;grid-auto-columns:minmax(220px,1fr);gap:12px;overflow-x:auto;padding-bottom:8px}
        .bd-calc{display:grid;grid-template-columns:minmax(0,360px) minmax(0,1fr);gap:16px;align-items:start}
        .bd-margins{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:10px}
        .bd-kpis{display:grid;grid-template-columns:repeat(5,minmax(0,1fr));gap:12px}
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
        <div style={{ maxWidth: '1120px', margin: '0 auto', padding: '0 28px', position: 'relative' }}>
          <div style={{ ...cinzel(C.terra, 11), opacity: 0.85, marginBottom: '10px' }}>Business Development · uso interno</div>
          <h1 style={{ fontFamily: "'EB Garamond',serif", fontWeight: 400, fontSize: 'clamp(2rem,5vw,3.2rem)', lineHeight: 1.05, color: C.parch, margin: '0 0 10px' }}>
            BizDev
          </h1>
          <p style={{ fontFamily: "'EB Garamond',serif", fontSize: '16px', fontStyle: 'italic', color: 'rgba(240,237,232,0.45)', margin: 0 }}>
            Prospectos, honorario por modelo y propuesta para la Junta Directiva
            {params && <> · modelo <span style={{ fontFamily: MONO, fontStyle: 'normal', fontSize: '13px' }}>{params.version}</span></>}
          </p>
        </div>
      </div>

      {/* Sub-navegación */}
      <div style={{ maxWidth: '1120px', margin: '0 auto', padding: '16px 28px 0' }}>
        <div role="tablist" style={{ display: 'flex', gap: 0, borderBottom: '1px solid rgba(255,255,255,0.06)', overflowX: 'auto' }}>
          {([['dashboard', 'Dashboard'], ['calc', 'Calculadora'], ['prop', 'Propuesta']] as [View, string][]).map(([k, l]) => (
            <button key={k} role="tab" aria-selected={view === k} onClick={() => setView(k)}
              style={{ background: 'none', border: 'none', borderBottom: `2px solid ${view === k ? C.terra : 'transparent'}`, padding: '10px 16px', cursor: 'pointer', ...cinzel(view === k ? C.terra : 'rgba(240,237,232,0.3)') }}>
              {l}
            </button>
          ))}
        </div>
      </div>

      <main style={{ maxWidth: '1120px', margin: '0 auto', padding: '24px 28px', display: 'grid', gap: '16px' }}>
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
function Dashboard({ params, prospects, onOpen, onReload, onError }: {
  params: FeeParams; prospects: Prospect[]; onOpen: (id: string) => void
  onReload: () => Promise<void>; onError: (e: string | null) => void
}) {
  const hoy = hoyISO()
  const hace30 = new Date(Date.now() - 30 * 864e5).toISOString().slice(0, 10)
  const activos = prospects.filter(p => !INACTIVAS.has(p.etapa))
  const cartera = activos.reduce((s, p) => s + (p.quotes[0] ? Number(p.quotes[0].honorario) : 0), 0)
  const enviadas30 = prospects.flatMap(p => p.quotes).filter(q => q.estado === 'enviada' && q.enviada_el && q.enviada_el >= hace30).length
  const ganados = prospects.filter(p => p.etapa === 'ganado').length
  const perdidos = prospects.filter(p => p.etapa === 'perdido').length
  const vencidas = activos.filter(p => p.proxima_fecha && p.proxima_fecha < hoy).length

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

  const kpis: [string, string][] = [
    ['Prospectos activos', String(activos.length)],
    ['Cartera cotizada / mes', `$${usd(cartera)}`],
    ['Propuestas enviadas · 30 días', String(enviadas30)],
    ['Tasa de cierre', ganados + perdidos ? `${Math.round((ganados / (ganados + perdidos)) * 100)} %` : '—'],
    ['Acciones vencidas', String(vencidas)],
  ]

  return (
    <>
      <div className="bd-kpis">
        {kpis.map(([k, v], i) => (
          <div key={k} style={{ ...card, padding: '16px' }}>
            <div style={{ ...cinzel('rgba(184,176,168,0.6)', 8), marginBottom: '8px' }}>{k}</div>
            <div style={{ fontFamily: MONO, fontSize: '20px', color: i === 4 && vencidas > 0 ? C.danger : C.parch }}>{v}</div>
          </div>
        ))}
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: '12px', flexWrap: 'wrap' }}>
        <div style={{ ...cinzel(C.terra, 10) }}>Prospectos por etapa</div>
        <div style={{ marginLeft: 'auto' }}>
          <button style={btn(!nuevo)} onClick={() => setNuevo(v => !v)}>{nuevo ? 'Cancelar' : '+ Nuevo prospecto'}</button>
        </div>
      </div>

      {nuevo && (
        <div style={{ ...card, display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(160px,1fr))', gap: '12px', alignItems: 'end' }}>
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

      <div className="bd-cols">
        {ETAPAS.map(et => {
          const items = prospects.filter(p => p.etapa === et.key)
          return (
            <section key={et.key} aria-label={et.label} style={{ display: 'grid', gap: '10px', alignContent: 'start' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', padding: '0 2px' }}>
                <span style={{ ...cinzel(INACTIVAS.has(et.key) ? C.muted : C.amatistaLight, 8) }}>{et.label}</span>
                <span style={{ fontFamily: MONO, fontSize: '11px', color: C.faint }}>{items.length}</span>
              </div>
              {items.length === 0 && <div style={{ border: '1px dashed rgba(92,52,114,0.2)', borderRadius: '8px', height: '48px' }} />}
              {items.map(p => <ProspectCard key={p.id} p={p} params={params} onOpen={() => onOpen(p.id)} />)}
            </section>
          )
        })}
      </div>
    </>
  )
}

function ProspectCard({ p, params, onOpen }: { p: Prospect; params: FeeParams; onOpen: () => void }) {
  const q = p.quotes[0]
  const c = p.comms[0]
  const vencida = !!p.proxima_fecha && p.proxima_fecha < hoyISO() && !INACTIVAS.has(p.etapa)
  const tier = p.unidades != null ? TIER_NOMBRES[tierFromSize(params, p.unidades, Number(p.m2_privados ?? 0), p.es_casas)] : null
  return (
    <button className="bd-card-click" onClick={onOpen}
      style={{ ...card, padding: '14px', textAlign: 'left', cursor: 'pointer', display: 'grid', gap: '6px', color: C.parch, background: C.carbon, borderLeft: `3px solid ${C.terra}` }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: '8px', alignItems: 'baseline' }}>
        <span style={{ fontFamily: "'EB Garamond',serif", fontSize: '18px' }}>{p.short_name}</span>
        {tier && <span style={{ ...cinzel(C.amatistaLight, 7) }}>{tier}</span>}
      </div>
      {q ? (
        <div style={{ fontFamily: MONO, fontSize: '12px' }}>
          ${usd(Number(q.honorario))}<span style={{ color: C.faint }}> · {Math.round(Number(q.margen) * 100)} % · {q.estado}</span>
        </div>
      ) : <div style={{ fontSize: '12px', color: C.faint }}>Sin cotización</div>}
      {(p.proxima_accion || p.proxima_fecha) && (
        <div style={{ fontSize: '12px', color: vencida ? C.danger : C.muted }}>
          {p.proxima_accion ?? 'Próxima acción'} · <span style={{ fontFamily: MONO }}>{fmtFecha(p.proxima_fecha)}</span>{vencida && ' · vencida'}
        </div>
      )}
      {c && (
        <div style={{ fontSize: '11px', color: C.faint }}>
          Última: {CANAL_LABEL[c.canal] ?? c.canal} · <span style={{ fontFamily: MONO }}>{fmtFecha(c.fecha)}</span>
        </div>
      )}
    </button>
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
