'use client'

import { useState, useCallback } from 'react'

interface BuildingOption { id: string; name: string }
interface KPIData {
  recaudacion_pct: number; recaudacion_total: number; cuota_esperada: number
  mora_total: number; mora_pct: number; unidades_total: number
  unidades_al_dia: number; unidades_mora: number
  fase_i: number; fase_ii: number; fase_iii: number; fase_iv: number
  margen_operativo?: number; ingresos_totales?: number; gastos_totales?: number
}
interface EEFFData { status: string; ingresos: number; gastos: number; utilidad: number; margen: number; period: string }
interface BIData { building_name: string; period: string; kpis: KPIData; eeff?: EEFFData }

const BUILDINGS: BuildingOption[] = [
  { id: '2b61944c-6a14-4177-a870-7bbecea17803', name: 'Venezia Tower' },
  { id: 'd30e6888-1fc3-43bc-960c-94a012b753d0', name: 'PH Lefevre 75 Don Enrique' },
  { id: 'e90da0fd-bb6e-4e4d-9015-50e0c17a1794', name: 'PH Los Álamos' },
  { id: '4a798598-3b94-438e-9b49-bdc15985d365', name: 'PH Luxor Towers 300' },
  { id: '33560559-1fec-47fc-9086-206817a00153', name: 'PH Torres de Castilla' },
  { id: '16a68732-256d-49d6-ae47-adcd72225c1a', name: 'PH Firenze Tower' },
  { id: '3429020f-c002-42c8-97d3-afd5ea2552a2', name: 'PH Plaza España' },
  { id: '7e11008d-89da-4228-8e16-39bb24d0b37f', name: 'PH Parque Central Arraiján' },
]

const EEFF_STATES: Record<string, { label: string; color: string; next: string | null }> = {
  borrador:      { label: 'Borrador',      color: 'rgba(184,176,168,0.55)', next: 'enviado_jd' },
  enviado_jd:    { label: 'Enviado a JD',  color: '#FBBF24',               next: 'pendiente_cpa' },
  pendiente_cpa: { label: 'Pendiente CPA', color: '#E8855A',               next: 'oficial' },
  oficial:       { label: 'Oficial',       color: '#4ADE80',               next: null },
}

const fmt$ = (n: number) => '$' + n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
const fmtK = (n: number) => n >= 1000 ? '$' + (n / 1000).toFixed(1) + 'k' : fmt$(n)
const fmtPct = (n: number) => n.toFixed(1) + '%'
const moraPctColor = (p: number) => p < 10 ? '#4ADE80' : p < 20 ? '#FBBF24' : p < 35 ? '#E8855A' : '#C4622D'
const currentPeriod = () => { const d = new Date(); d.setMonth(d.getMonth()-1); return d.toISOString().slice(0,7) }
const cinzel = (color = 'rgba(184,176,168,0.55)'): React.CSSProperties => ({
  fontFamily:"'Cinzel',serif", fontSize:'9px', fontWeight:600, letterSpacing:'0.22em', textTransform:'uppercase' as const, color
})

// ── Hover helper
const hov = (el: HTMLElement, on: boolean) => {
  el.style.borderColor = on ? 'rgba(92,52,114,0.35)' : 'rgba(255,255,255,0.06)'
  el.style.transform   = on ? 'translateY(-2px)' : 'none'
  el.style.boxShadow   = on ? '0 8px 24px rgba(0,0,0,0.35)' : 'none'
}

export default function BIPage() {
  const [buildingId, setBuildingId]   = useState('')
  const [period, setPeriod]           = useState(currentPeriod)
  const [loading, setLoading]         = useState(false)
  const [data, setData]               = useState<BIData | null>(null)
  const [error, setError]             = useState<string | null>(null)
  const [eeffStatus, setEeffStatus]   = useState('borrador')
  const [dlLoading, setDlLoading]     = useState(false)

  const kpis     = data?.kpis
  const recPct   = kpis?.recaudacion_pct ?? 0
  const bldName  = BUILDINGS.find(b => b.id === buildingId)?.name ?? ''

  const handleGenerate = useCallback(async () => {
    if (!buildingId) return
    setLoading(true); setError(null); setData(null)
    try {
      const res  = await fetch(`/api/bi/data?building_id=${buildingId}&period=${period}`)
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const json: BIData = await res.json()
      setData(json); setEeffStatus(json.eeff?.status ?? 'borrador')
    } catch(e: unknown) { setError(e instanceof Error ? e.message : 'Error') }
    finally { setLoading(false) }
  }, [buildingId, period])

  const handleEeffAdvance = useCallback(async () => {
    const next = EEFF_STATES[eeffStatus]?.next
    if (!next || !buildingId) return
    try {
      await fetch('/api/bi/status', { method:'PATCH', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ building_id:buildingId, period, status:next }) })
      setEeffStatus(next)
    } catch(_) {}
  }, [eeffStatus, buildingId, period])

  const handleDownload = useCallback(async () => {
    if (!buildingId) return
    setDlLoading(true)
    try {
      const res  = await fetch(`/api/bi/html?building_id=${buildingId}&period=${period}`)
      const html = await res.text()
      const blob = new Blob([html], { type:'text/html' })
      const url  = URL.createObjectURL(blob)
      const a    = document.createElement('a')
      a.href = url; a.download = `Informe_BI_${bldName.replace(/ /g,'_')}_${period}.html`; a.click()
      URL.revokeObjectURL(url)
    } catch(_) {}
    finally { setDlLoading(false) }
  }, [buildingId, period, bldName])

  return (
    <div style={{ minHeight:'100vh', background:'#0E1018', color:'#F0EDE8', fontFamily:"'DM Sans',sans-serif", paddingBottom:'80px', position:'relative', zIndex:1 }}>

      {/* ══ HERO ════════════════════════════════════════════════ */}
      <div style={{ position:'relative', overflow:'hidden', padding:'48px 0 36px', borderBottom:'1px solid rgba(92,52,114,0.12)' }}>
        <div style={{ position:'absolute', inset:0, background:'radial-gradient(circle at 80% 10%, rgba(92,52,114,0.18), transparent 60%)', pointerEvents:'none' }} />
        <div style={{ maxWidth:'960px', margin:'0 auto', padding:'0 28px', position:'relative', zIndex:1 }}>
          <div style={{ ...cinzel('#C4622D'), marginBottom:'10px', opacity:.85, animation:'fade-in 0.4s ease-out forwards' }}>Informe Mensual de Gestión</div>
          <div style={{ fontFamily:"'Cormorant Garamond',serif", fontSize:'clamp(2.2rem,5vw,4rem)', fontWeight:300, fontStyle:'italic', lineHeight:1.0, color:'#EAD9F5', marginBottom:'10px', animation:'fade-in 0.5s 0.1s ease-out both' }}>
            Suite de Indicadores
          </div>
          <p style={{ fontFamily:"'EB Garamond',serif", fontSize:'17px', fontStyle:'italic', color:'rgba(240,237,232,0.4)', margin:0, animation:'fade-in 0.5s 0.2s ease-out both' }}>
            Indicadores financieros · Gestión de mora · EEFF preliminar · Día 5 del mes
          </p>
        </div>
      </div>

      <div style={{ maxWidth:'960px', margin:'0 auto', padding:'32px 28px', display:'grid', gap:'20px' }}>

        {/* ── SELECTOR ── */}
        <div style={{ background:'#1C2233', border:'1px solid rgba(92,52,114,0.2)', borderRadius:'10px', padding:'24px', animation:'snap-in 0.35s ease-out forwards' }}>
          <div style={{ ...cinzel('#C4622D'), marginBottom:'18px' }}>1 · Edificio &amp; Período</div>
          <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:'14px', marginBottom:'18px' }}>
            {[
              { lbl:'Edificio', el: (
                <select value={buildingId} onChange={e => setBuildingId(e.target.value)}
                  style={{ background:'rgba(14,16,24,0.85)', border:'1px solid rgba(92,52,114,0.35)', borderRadius:'6px', padding:'9px 12px', color:'#F0EDE8', fontSize:'13px', width:'100%', outline:'none', cursor:'pointer', fontFamily:"'DM Sans',sans-serif", transition:'border-color 0.15s' }}
                  onFocus={e => e.target.style.borderColor = '#5C3472'}
                  onBlur={e  => e.target.style.borderColor = 'rgba(92,52,114,0.35)'}>
                  <option value="">— Seleccionar —</option>
                  {BUILDINGS.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}
                </select>
              )},
              { lbl:'Período', el: (
                <input type="month" value={period} onChange={e => setPeriod(e.target.value)}
                  style={{ background:'rgba(14,16,24,0.85)', border:'1px solid rgba(92,52,114,0.35)', borderRadius:'6px', padding:'9px 12px', color:'#F0EDE8', fontSize:'13px', width:'100%', outline:'none', cursor:'pointer', fontFamily:"'DM Sans',sans-serif", transition:'border-color 0.15s' }}
                  onFocus={e => e.target.style.borderColor = '#5C3472'}
                  onBlur={e  => e.target.style.borderColor = 'rgba(92,52,114,0.35)'} />
              )},
            ].map(f => (
              <div key={f.lbl}>
                <label style={{ ...cinzel(), display:'block', marginBottom:'6px', fontSize:'8px' }}>{f.lbl}</label>
                {f.el}
              </div>
            ))}
          </div>
          <button onClick={handleGenerate} disabled={!buildingId || loading}
            style={{ width:'100%', padding:'11px 24px', background: buildingId && !loading ? '#5C3472' : 'rgba(92,52,114,0.2)', border:'1px solid rgba(92,52,114,0.45)', borderRadius:'6px', color:'#F0EDE8', ...cinzel('#F0EDE8'), fontSize:'10px', cursor: buildingId && !loading ? 'pointer' : 'not-allowed', transition:'filter 0.15s, transform 0.15s', display:'flex', alignItems:'center', justifyContent:'center', gap:'10px' }}
            onMouseEnter={e => { if (buildingId && !loading) { e.currentTarget.style.filter='brightness(1.15)'; e.currentTarget.style.transform='translateY(-1px)' }}}
            onMouseLeave={e => { e.currentTarget.style.filter='none'; e.currentTarget.style.transform='none' }}>
            {loading ? <><Spinner />Cargando datos…</> : 'Generar Informe BI'}
          </button>
        </div>

        {/* ── ERROR ── */}
        {error && (
          <div style={{ background:'rgba(196,98,45,0.07)', border:'1px solid rgba(196,98,45,0.25)', borderLeft:'3px solid #C4622D', borderRadius:'8px', padding:'14px 18px', fontSize:'13px', color:'#C4622D', animation:'snap-in 0.3s ease-out forwards' }}>
            {error}
          </div>
        )}

        {/* ── SKELETON ── */}
        {loading && (
          <div style={{ display:'grid', gridTemplateColumns:'repeat(4,1fr)', gap:'14px' }}>
            {[...Array(4)].map((_,i) => (
              <div key={i} style={{ height:'120px', borderRadius:'10px', background:'linear-gradient(90deg,rgba(92,52,114,0.05) 25%,rgba(92,52,114,0.13) 50%,rgba(92,52,114,0.05) 75%)', backgroundSize:'200% 100%', animation:'shimmer 1.6s ease-in-out infinite' }} />
            ))}
          </div>
        )}

        {/* ══ DATA ════════════════════════════════════════════════ */}
        {kpis && !loading && (
          <>
            {/* Building heading */}
            <div style={{ display:'flex', alignItems:'baseline', justifyContent:'space-between', paddingTop:'4px', animation:'fade-in 0.35s ease-out forwards' }}>
              <div>
                <span style={{ fontFamily:"'EB Garamond',serif", fontSize:'27px', fontWeight:400, color:'#F0EDE8' }}>{data?.building_name ?? bldName}</span>
                <span style={{ ...cinzel(), marginLeft:'14px', fontSize:'8px', opacity:.45 }}>{period}</span>
              </div>
              <div style={{ ...cinzel(), fontSize:'8px', opacity:.2 }}>T4 · T9</div>
            </div>

            {/* KPI Hero — T9 Heartbeat · Firma 1 */}
            <KPIHero kpis={kpis} recPct={recPct} />

            {/* KPI Grid — T4 micro-tensions */}
            <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fit,minmax(200px,1fr))', gap:'14px' }}>
              <KPICard label="Mora Total"        value={fmtPct(kpis.mora_pct)}   sub={`${kpis.unidades_mora} de ${kpis.unidades_total} uds.`}      valueColor={moraPctColor(kpis.mora_pct)} terra={kpis.mora_pct > 20} />
              <KPICard label="Al Día"            value={String(kpis.unidades_al_dia)} sub={`${fmtPct((kpis.unidades_al_dia/(kpis.unidades_total||1))*100)} del total`} valueColor="#4ADE80" />
              {kpis.margen_operativo !== undefined && (
                <KPICard label="Margen Operativo" value={fmtPct(kpis.margen_operativo)} sub={kpis.ingresos_totales ? `${fmtK(kpis.ingresos_totales)} − ${fmtK(kpis.gastos_totales??0)}` : '—'} valueColor={kpis.margen_operativo>=15?'#4ADE80':kpis.margen_operativo>=5?'#FBBF24':'#C4622D'} />
              )}
              <KPICard label="Cartera Mora"     value={fmt$(kpis.mora_total)}    sub="acumulado al cierre"                                       valueColor="#C4622D" />
            </div>

            {/* Mora chart */}
            <div style={{ background:'#1C2233', border:'1px solid rgba(92,52,114,0.12)', borderRadius:'10px', overflow:'hidden', animation:'fade-in 0.4s 0.15s ease-out both' }}>
              <div style={{ padding:'16px 24px 12px', borderBottom:'1px solid rgba(255,255,255,0.05)', display:'flex', alignItems:'center', justifyContent:'space-between' }}>
                {/* Shimmer line — Firma S17 */}
                <div style={{ ...cinzel() }}>3 · Distribución de Mora por Fase</div>
                <div style={{ ...cinzel(), fontSize:'8px', opacity:.3 }}>unidades inmobiliarias</div>
              </div>
              <div style={{ padding:'24px' }}><MoraFasesChart kpis={kpis} /></div>
            </div>

            {/* EEFF */}
            {data?.eeff && (
              <EEFFSection eeff={data.eeff} status={eeffStatus} onAdvance={handleEeffAdvance} />
            )}

            {/* Download CTA */}
            <div style={{ background:'rgba(92,52,114,0.07)', border:'1px solid rgba(92,52,114,0.28)', borderRadius:'10px', padding:'22px 24px', display:'flex', alignItems:'center', justifyContent:'space-between', gap:'20px', flexWrap:'wrap', animation:'fade-in 0.4s 0.25s ease-out both', transition:'border-color 0.2s' }}
              onMouseEnter={e => e.currentTarget.style.borderColor = 'rgba(92,52,114,0.5)'}
              onMouseLeave={e => e.currentTarget.style.borderColor = 'rgba(92,52,114,0.28)'}>
              <div>
                <div style={{ ...cinzel('#EAD9F5'), marginBottom:'6px' }}>Suite HTML · 5 Paneles</div>
                <div style={{ fontFamily:"'EB Garamond',serif", fontSize:'15px', fontStyle:'italic', color:'rgba(240,237,232,0.4)' }}>Informe autónomo · compartible con la Junta Directiva</div>
              </div>
              <button onClick={handleDownload} disabled={dlLoading}
                style={{ padding:'10px 22px', background:'#5C3472', border:'1px solid rgba(92,52,114,0.5)', borderRadius:'6px', color:'#F0EDE8', ...cinzel('#F0EDE8'), fontSize:'10px', cursor: dlLoading?'wait':'pointer', transition:'filter 0.15s, transform 0.15s', whiteSpace:'nowrap' }}
                onMouseEnter={e => { if(!dlLoading){ e.currentTarget.style.filter='brightness(1.15)'; e.currentTarget.style.transform='translateY(-1px)' }}}
                onMouseLeave={e => { e.currentTarget.style.filter='none'; e.currentTarget.style.transform='none' }}>
                {dlLoading ? 'Generando…' : 'Descargar Suite HTML'}
              </button>
            </div>
          </>
        )}
      </div>

      {/* ══ FOOTER ══════════════════════════════════════════════ */}
      <footer style={{ position:'fixed', bottom:0, left:0, right:0, borderTop:'2px solid #5C3472', background:'rgba(14,16,24,0.97)', backdropFilter:'blur(12px)', WebkitBackdropFilter:'blur(12px)', padding:'7px 28px', display:'flex', alignItems:'center', justifyContent:'space-between', gap:'12px', zIndex:100 }}>
        <div style={{ display:'inline-flex', alignItems:'baseline', gap:0, lineHeight:1 }}>
          <span style={{ fontFamily:"'EB Garamond',serif", fontWeight:400, color:'rgba(240,237,232,0.55)', fontSize:'14px' }}>Forum</span>
          <span style={{ fontFamily:"'DM Sans',sans-serif", fontWeight:700, color:'#C4622D', letterSpacing:'0.06em', fontSize:'13px' }}>PH</span>
          <span style={{ fontFamily:"'DM Sans',sans-serif", fontWeight:700, color:'#C4622D', letterSpacing:'0.04em', fontSize:'13px' }}>s</span>
          <span style={{ fontSize:'9px', color:'rgba(240,237,232,0.2)', letterSpacing:'0.06em', marginLeft:'8px', fontFamily:"'DM Sans',sans-serif" }}>BI v3.0</span>
        </div>
        <div style={{ fontSize:'9px', color:'rgba(200,196,190,0.18)', letterSpacing:'0.04em', fontFamily:"'DM Sans',sans-serif" }}>© 2026 ForumPHs · Ley 284 de 2022</div>
      </footer>

      <style>{`
        @keyframes spin    { to{transform:rotate(360deg)} }
        @keyframes shimmer { 0%{background-position:200% 0} 100%{background-position:-200% 0} }
        @keyframes hb-pulse{ 0%,100%{box-shadow:0 0 0 0 rgba(92,52,114,0)} 30%{box-shadow:0 0 0 6px rgba(92,52,114,0.18)} 60%{box-shadow:0 0 0 12px rgba(92,52,114,0)} }
        @keyframes kpi-in  { from{opacity:0;transform:translateY(10px) scale(0.97)} to{opacity:1;transform:none} }
        @keyframes fade-in { from{opacity:0;transform:translateY(8px)} to{opacity:1;transform:none} }
        @keyframes snap-in { from{opacity:0;transform:scale(0.96)} to{opacity:1;transform:none} }
        @media (prefers-reduced-motion:reduce){*{animation-duration:0.01ms!important}}
      `}</style>
    </div>
  )
}

function Spinner() {
  return <span style={{ width:'13px', height:'13px', border:'2px solid rgba(240,237,232,0.15)', borderTopColor:'rgba(240,237,232,0.7)', borderRadius:'50%', display:'inline-block', animation:'spin 0.8s linear infinite', flexShrink:0 }} />
}

function KPIHero({ kpis, recPct }: { kpis: KPIData; recPct: number }) {
  const heroColor = recPct>=90 ? '#EAD9F5' : recPct>=75 ? '#FBBF24' : '#C4622D'
  return (
    <div style={{ background:'#1C2233', border:`1px solid rgba(92,52,114,${recPct>=90?'0.55':'0.3'})`, borderRadius:'12px', padding:'28px 32px', position:'relative', overflow:'hidden', animation:'hb-pulse 3s ease-in-out infinite, snap-in 0.4s ease-out forwards', transition:'border-color 0.3s' }}>
      <div style={{ position:'absolute', fontFamily:"'DM Sans',sans-serif", fontSize:'180px', fontWeight:700, color:'rgba(92,52,114,0.04)', lineHeight:1, top:'-30px', right:'-10px', pointerEvents:'none', userSelect:'none', zIndex:0 }} aria-hidden>{Math.round(recPct)}</div>
      <div style={{ position:'relative', zIndex:1 }}>
        <div style={{ fontFamily:"'Cinzel',serif", fontSize:'9px', fontWeight:600, letterSpacing:'0.22em', textTransform:'uppercase' as const, color:'rgba(184,176,168,0.7)', marginBottom:'8px' }}>Tasa de Recaudación · {kpis.unidades_total} unidades</div>
        <div style={{ fontFamily:"'EB Garamond',serif", fontSize:'clamp(4rem,8vw,6rem)', fontWeight:400, lineHeight:1, letterSpacing:'-0.02em', color:heroColor, animation:'kpi-in 0.5s cubic-bezier(0.34,1.56,0.64,1) forwards' }}>{recPct.toFixed(1)}%</div>
        <div style={{ display:'flex', gap:'24px', marginTop:'14px', flexWrap:'wrap' }}>
          {[
            { lbl:'Recaudado', val: '$'+kpis.recaudacion_total.toLocaleString('en-US',{minimumFractionDigits:2}), col:'#F0EDE8' },
            { lbl:'Esperado',  val: '$'+kpis.cuota_esperada.toLocaleString('en-US',{minimumFractionDigits:2}),    col:'rgba(184,176,168,0.6)' },
            { lbl:'En mora',   val: '$'+kpis.mora_total.toLocaleString('en-US',{minimumFractionDigits:2}),        col:'#C4622D' },
          ].map(item => (
            <div key={item.lbl}>
              <div style={{ fontFamily:"'Cinzel',serif", fontSize:'8px', letterSpacing:'0.15em', textTransform:'uppercase' as const, color:'rgba(240,237,232,0.3)', marginBottom:'3px' }}>{item.lbl}</div>
              <div style={{ fontFamily:"'EB Garamond',serif", fontSize:'20px', fontWeight:400, color:item.col }}>{item.val}</div>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

function KPICard({ label, value, sub, valueColor, terra=false }: { label:string; value:string; sub:string; valueColor:string; terra?:boolean }) {
  return (
    <div style={{ background:'#1C2233', border: terra ? '1px solid rgba(196,98,45,0.3)' : '1px solid rgba(255,255,255,0.06)', borderLeft: terra ? '3px solid #C4622D' : undefined, borderRadius:'10px', padding:'18px 20px', transition:'border-color 0.2s, transform 0.2s, box-shadow 0.2s', cursor:'default', animation:'snap-in 0.4s ease-out forwards' }}
      onMouseEnter={e => { const el=e.currentTarget; el.style.borderColor=terra?'rgba(196,98,45,0.5)':'rgba(92,52,114,0.3)'; el.style.transform='translateY(-2px)'; el.style.boxShadow='0 8px 20px rgba(0,0,0,0.3)' }}
      onMouseLeave={e => { const el=e.currentTarget; el.style.borderColor=terra?'rgba(196,98,45,0.3)':'rgba(255,255,255,0.06)'; el.style.transform='none'; el.style.boxShadow='none' }}>
      <div style={{ fontFamily:"'Cinzel',serif", fontSize:'9px', fontWeight:600, letterSpacing:'0.2em', textTransform:'uppercase' as const, color:'rgba(184,176,168,0.55)', marginBottom:'7px' }}>{label}</div>
      <div style={{ fontFamily:"'EB Garamond',serif", fontSize:'clamp(1.75rem,3vw,2.25rem)', fontWeight:400, lineHeight:1, letterSpacing:'-0.01em', color:valueColor, animation:'kpi-in 0.4s cubic-bezier(0.34,1.56,0.64,1) forwards' }}>{value}</div>
      <div style={{ fontFamily:"'DM Sans',sans-serif", fontSize:'11px', color:'rgba(184,176,168,0.45)', marginTop:'6px' }}>{sub}</div>
    </div>
  )
}

function MoraFasesChart({ kpis }: { kpis: KPIData }) {
  const phases = [
    { label:'Al Día',  value:kpis.unidades_al_dia, color:'#4ADE80' },
    { label:'Fase I',  value:kpis.fase_i,           color:'#FBBF24' },
    { label:'Fase II', value:kpis.fase_ii,          color:'#E8855A' },
    { label:'Fase III',value:kpis.fase_iii,         color:'#C4622D' },
    { label:'Fase IV', value:kpis.fase_iv,          color:'#5C3472' },
  ]
  const total  = kpis.unidades_total || 1
  const maxVal = Math.max(...phases.map(p => p.value), 1)
  const LABEL_W=72, BAR_H=26, BAR_GAP=14, BAR_MAX=360, SVG_W=LABEL_W+BAR_MAX+100, SVG_H=phases.length*(BAR_H+BAR_GAP)+4

  return (
    <>
      <svg viewBox={`0 0 ${SVG_W} ${SVG_H}`} style={{ width:'100%', minWidth:'300px', display:'block', overflow:'visible' }}>
        {phases.map((ph,i) => {
          const y=i*(BAR_H+BAR_GAP), barW=(ph.value/maxVal)*BAR_MAX, pct=((ph.value/total)*100).toFixed(1)
          return (
            <g key={ph.label}>
              <text x={LABEL_W-8} y={y+BAR_H/2+4} textAnchor="end" style={{ fontFamily:"'Cinzel',serif", fontSize:'8.5px', letterSpacing:'0.12em', fill:'rgba(184,176,168,0.5)', textTransform:'uppercase' }}>{ph.label}</text>
              <rect x={LABEL_W} y={y} width={BAR_MAX} height={BAR_H} rx={3} fill="rgba(255,255,255,0.04)" />
              {ph.value>0 && <rect x={LABEL_W} y={y} width={Math.max(barW,4)} height={BAR_H} rx={3} fill={ph.color} opacity={0.82} />}
              <text x={LABEL_W+BAR_MAX+12} y={y+BAR_H/2+4} style={{ fontFamily:"'EB Garamond',serif", fontSize:'14px', fill:'rgba(240,237,232,0.65)' }}>
                {ph.value}<tspan style={{ fontFamily:"'DM Sans',sans-serif", fontSize:'10px', fill:'rgba(184,176,168,0.38)' }}> ({pct}%)</tspan>
              </text>
            </g>
          )
        })}
      </svg>
      <div style={{ marginTop:'18px', height:'5px', borderRadius:'3px', overflow:'hidden', display:'flex', background:'rgba(255,255,255,0.04)' }}>
        {phases.map(ph => <div key={ph.label} style={{ width:`${(ph.value/total)*100}%`, background:ph.color, minWidth:ph.value>0?'3px':'0' }} />)}
      </div>
    </>
  )
}

function EEFFSection({ eeff, status, onAdvance }: { eeff: EEFFData; status: string; onAdvance: () => void }) {
  const st    = EEFF_STATES[status]
  const nextSt = st?.next ? EEFF_STATES[st.next] : null
  return (
    <div style={{ background:'#1C2233', border:'1px solid rgba(92,52,114,0.12)', borderRadius:'10px', overflow:'hidden', animation:'fade-in 0.4s 0.2s ease-out both' }}>
      <div style={{ padding:'16px 24px 12px', borderBottom:'1px solid rgba(255,255,255,0.05)', display:'flex', alignItems:'center', justifyContent:'space-between', flexWrap:'wrap', gap:'10px' }}>
        <div style={{ fontFamily:"'Cinzel',serif", fontSize:'9px', fontWeight:600, letterSpacing:'0.2em', textTransform:'uppercase' as const, color:'rgba(184,176,168,0.55)' }}>4 · Estado Financiero Preliminar</div>
        <div style={{ display:'flex', alignItems:'center', gap:'7px' }}>
          <span style={{ width:'7px', height:'7px', borderRadius:'50%', background:st?.color??'#6B6460', display:'inline-block', animation:'dot-breathe 2.5s ease-in-out infinite' }} />
          <span style={{ fontFamily:"'Cinzel',serif", fontSize:'8px', letterSpacing:'0.14em', textTransform:'uppercase' as const, color:st?.color??'#6B6460' }}>{st?.label??status}</span>
        </div>
      </div>
      <div style={{ padding:'22px 24px' }}>
        <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fit,minmax(120px,1fr))', gap:'16px', marginBottom:'18px' }}>
          {[
            { lbl:'Ingresos', val:'$'+eeff.ingresos.toLocaleString('en-US',{minimumFractionDigits:2}), col:'#4ADE80' },
            { lbl:'Gastos',   val:'$'+eeff.gastos.toLocaleString('en-US',{minimumFractionDigits:2}),   col:'rgba(184,176,168,0.6)' },
            { lbl:'Utilidad', val:'$'+eeff.utilidad.toLocaleString('en-US',{minimumFractionDigits:2}), col: eeff.utilidad>=0?'#EAD9F5':'#C4622D' },
            { lbl:'Margen',   val:eeff.margen.toFixed(1)+'%',                                          col: eeff.margen>=15?'#4ADE80':eeff.margen>=5?'#FBBF24':'#C4622D' },
          ].map(r => (
            <div key={r.lbl}>
              <div style={{ fontFamily:"'Cinzel',serif", fontSize:'8px', letterSpacing:'0.18em', textTransform:'uppercase' as const, color:'rgba(240,237,232,0.3)', marginBottom:'4px' }}>{r.lbl}</div>
              <div style={{ fontFamily:"'EB Garamond',serif", fontSize:'22px', fontWeight:400, color:r.col }}>{r.val}</div>
            </div>
          ))}
        </div>
        <div style={{ height:'1px', background:'rgba(92,52,114,0.2)', marginBottom:'16px' }} />
        <div style={{ fontFamily:"'EB Garamond',serif", fontSize:'13px', fontStyle:'italic', color:'rgba(240,237,232,0.28)', marginBottom:'16px', borderLeft:'2px solid rgba(92,52,114,0.25)', paddingLeft:'12px', lineHeight:1.6 }}>
          Estado preliminar · pendiente firma CPA Marlene Molina (PE-11-2157 · 0488-2020)
        </div>
        {st?.next && nextSt && (
          <button onClick={onAdvance}
            style={{ padding:'8px 18px', background:'transparent', border:`1px solid ${st.color}`, borderRadius:'6px', color:st.color, fontFamily:"'Cinzel',serif", fontSize:'8px', fontWeight:600, letterSpacing:'0.14em', textTransform:'uppercase' as const, cursor:'pointer', transition:'background 0.15s, transform 0.15s' }}
            onMouseEnter={e => { e.currentTarget.style.background=`${st.color}22`; e.currentTarget.style.transform='translateY(-1px)' }}
            onMouseLeave={e => { e.currentTarget.style.background='transparent'; e.currentTarget.style.transform='none' }}>
            Avanzar a: {nextSt.label}
          </button>
        )}
        {!st?.next && (
          <div style={{ display:'flex', alignItems:'center', gap:'7px', fontFamily:"'Cinzel',serif", fontSize:'8px', letterSpacing:'0.14em', textTransform:'uppercase' as const, color:'#4ADE80' }}>
            <span style={{ width:'6px', height:'6px', borderRadius:'50%', background:'#4ADE80', display:'inline-block', animation:'dot-breathe 2.5s ease-in-out infinite' }} />
            EEFF oficial firmado
          </div>
        )}
      </div>
    </div>
  )
}
