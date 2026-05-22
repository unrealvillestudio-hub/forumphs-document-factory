'use client'

import { useState, useCallback, useRef } from 'react'
import type { FIESchema, FIEMonth } from '@/lib/fie/schema'
import { FIE_DEFAULT_SCENARIOS, emptyFIESchema } from '@/lib/fie/schema'

type Step = 'upload' | 'review' | 'generating' | 'done'

const fmt$ = (n: number) => '$' + n.toLocaleString('en-US', { minimumFractionDigits:2, maximumFractionDigits:2 })
const cinzel = (color='rgba(184,176,168,0.55)'): React.CSSProperties => ({
  fontFamily:"'Cinzel',serif", fontSize:'9px', fontWeight:600, letterSpacing:'0.22em', textTransform:'uppercase' as const, color
})
const COST_LABELS: Record<string,string> = {
  salarios:'Planilla / Salarios', css:'CSS Obrero-Patronal', honorarios:'Honorarios Profesionales',
  viaticos:'Viáticos', servicios:'Servicios / Facturas', stack:'Stack Tecnológico', otros:'Otros',
}
const hov = (el: HTMLElement, on: boolean, borderOn='rgba(92,52,114,0.3)', borderOff='rgba(92,52,114,0.15)') => {
  el.style.borderColor = on ? borderOn : borderOff
  el.style.transform   = on ? 'translateY(-2px)' : 'none'
  el.style.boxShadow   = on ? '0 8px 24px rgba(0,0,0,0.3)' : 'none'
}

export default function FIEPage() {
  const [step, setStep]           = useState<Step>('upload')
  const [schema, setSchema]       = useState<FIESchema | null>(null)
  const [error, setError]         = useState<string | null>(null)
  const [parsing, setParsing]     = useState(false)
  const [dragOver, setDragOver]   = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)

  const handleFile = useCallback(async (file: File) => {
    setError(null); setParsing(true)
    try {
      const fd = new FormData(); fd.append('file', file)
      const res  = await fetch('/api/fie/parse', { method:'POST', body:fd })
      const data = await res.json()
      if (!res.ok || data.error) throw new Error(data.error ?? `HTTP ${res.status}`)
      const merged: FIESchema = { ...emptyFIESchema(data.schema.building_name), ...data.schema, scenarios: data.schema.scenarios ?? FIE_DEFAULT_SCENARIOS, generated_at: new Date().toISOString(), currency:'USD' }
      setSchema(merged); setStep('review')
    } catch(e: unknown) { setError(e instanceof Error ? e.message : 'Error al procesar') }
    finally { setParsing(false) }
  }, [])

  const onDrop = (e: React.DragEvent) => { e.preventDefault(); setDragOver(false); const f=e.dataTransfer.files?.[0]; if(f) handleFile(f) }
  const onFileChange = (e: React.ChangeEvent<HTMLInputElement>) => { const f=e.target.files?.[0]; if(f) handleFile(f) }

  const handleGenerate = useCallback(async () => {
    if (!schema) return
    setStep('generating'); setError(null)
    try {
      const res  = await fetch('/api/fie/generate', { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({schema}) })
      if (!res.ok) throw new Error(`Error ${res.status}`)
      const html = await res.text()
      const blob = new Blob([html], { type:'text/html' })
      const url  = URL.createObjectURL(blob)
      const a    = document.createElement('a')
      a.href=url; a.download=`FIE_${schema.building_name.replace(/[^a-zA-Z0-9]/g,'_')}_${schema.period_label.replace(/ /g,'_')}.html`; a.click()
      URL.revokeObjectURL(url); setStep('done')
    } catch(e: unknown) { setError(e instanceof Error ? e.message : 'Error'); setStep('review') }
  }, [schema])

  const updateField = (key: keyof FIESchema, value: unknown) => setSchema(s => s ? {...s,[key]:value} : s)
  const updateCost  = (key: string, value: number) => setSchema(s => s ? {...s,cost_breakdown:{...s.cost_breakdown,[key]:value}} : s)
  const updateMonth = (i: number, key: keyof FIEMonth, value: number|string) =>
    setSchema(s => {
      if (!s) return s
      const months=[...s.eeff_months]; months[i]={...months[i],[key]:value}
      if (key==='ingresos'||key==='gastos') { const util=months[i].ingresos-months[i].gastos; months[i].utilidad=util; months[i].margen=months[i].ingresos>0?(util/months[i].ingresos)*100:0 }
      return {...s,eeff_months:months}
    })
  const addMonth    = () => setSchema(s => s ? {...s,eeff_months:[...s.eeff_months,{month:'',ingresos:0,gastos:0,utilidad:0,margen:0}]} : s)
  const removeMonth = (i: number) => setSchema(s => s ? {...s,eeff_months:s.eeff_months.filter((_,idx)=>idx!==i)} : s)

  const inputStyle: React.CSSProperties = { background:'rgba(14,16,24,0.85)', border:'1px solid rgba(92,52,114,0.3)', borderRadius:'6px', padding:'8px 12px', color:'#F0EDE8', fontSize:'13px', width:'100%', outline:'none', fontFamily:"'DM Sans',sans-serif", transition:'border-color 0.15s' }

  return (
    <div style={{ minHeight:'100vh', background:'#0E1018', color:'#F0EDE8', fontFamily:"'DM Sans',sans-serif", paddingBottom:'80px', position:'relative', zIndex:1 }}>

      {/* ══ HERO ════════════════════════════════════════════════ */}
      <div style={{ position:'relative', overflow:'hidden', padding:'48px 0 32px', borderBottom:'1px solid rgba(92,52,114,0.12)' }}>
        <div style={{ position:'absolute', inset:0, background:'radial-gradient(circle at 80% 10%, rgba(92,52,114,0.18), transparent 60%)', pointerEvents:'none' }} />
        <div style={{ maxWidth:'960px', margin:'0 auto', padding:'0 28px', position:'relative', zIndex:1 }}>
          <div style={{ ...cinzel('#C4622D'), marginBottom:'10px', opacity:.85, animation:'fade-in 0.4s ease-out forwards' }}>Financial Intelligence Engine · Nivel 2</div>
          <div style={{ fontFamily:"'Cormorant Garamond',serif", fontSize:'clamp(2.2rem,5vw,4rem)', fontWeight:300, fontStyle:'italic', lineHeight:1.0, color:'#EAD9F5', marginBottom:'10px', animation:'fade-in 0.5s 0.1s ease-out both' }}>
            Normalizer &amp; Suite FIE
          </div>
          <p style={{ fontFamily:"'EB Garamond',serif", fontSize:'16px', fontStyle:'italic', color:'rgba(240,237,232,0.4)', margin:0, animation:'fade-in 0.5s 0.2s ease-out both' }}>
            .xlsx / .pdf → JSON schema → Claude → HTML 7 paneles + simulador interactivo
          </p>
        </div>
      </div>

      {/* ── STEPPER ── */}
      <div style={{ maxWidth:'960px', margin:'0 auto', padding:'20px 28px 0' }}>
        <div style={{ display:'flex', gap:0, borderBottom:'1px solid rgba(255,255,255,0.06)' }}>
          {(['upload','review','done'] as const).map((s,i) => (
            <div key={s} style={{ display:'flex', alignItems:'center', gap:'8px', padding:'10px 16px', borderBottom:`2px solid ${step===s?'#C4622D':'transparent'}`, transition:'border-color 0.2s' }}>
              <span style={{ ...cinzel(step===s?'#C4622D':'rgba(240,237,232,0.2)'), transition:'color 0.2s' }}>{i+1} · {s==='upload'?'Subir archivo':s==='review'?'Revisar & editar':'Listo'}</span>
            </div>
          ))}
        </div>
      </div>

      <div style={{ maxWidth:'960px', margin:'0 auto', padding:'28px' }}>

        {/* ── ERROR ── */}
        {error && (
          <div style={{ background:'rgba(196,98,45,0.07)', border:'1px solid rgba(196,98,45,0.25)', borderLeft:'3px solid #C4622D', borderRadius:'8px', padding:'14px 18px', fontSize:'13px', color:'#C4622D', marginBottom:'20px', animation:'snap-in 0.3s ease-out forwards' }}>
            {error}
          </div>
        )}

        {/* ════ UPLOAD ════ */}
        {step==='upload' && (
          <div style={{ display:'grid', gap:'16px', animation:'snap-in 0.35s ease-out forwards' }}>
            <div
              onDragOver={e => { e.preventDefault(); setDragOver(true) }}
              onDragLeave={() => setDragOver(false)}
              onDrop={onDrop}
              onClick={() => fileRef.current?.click()}
              style={{ border:`2px dashed ${dragOver?'#C4622D':'rgba(92,52,114,0.3)'}`, borderRadius:'12px', padding:'56px 32px', textAlign:'center', cursor:'pointer', background: dragOver?'rgba(196,98,45,0.06)':'rgba(28,34,51,0.4)', transition:'all 0.2s', position:'relative', overflow:'hidden' }}>
              <div style={{ position:'absolute', fontFamily:"'DM Sans',sans-serif", fontSize:'160px', fontWeight:700, color:'rgba(92,52,114,0.04)', lineHeight:1, top:'-20px', right:'-10px', pointerEvents:'none', userSelect:'none' }} aria-hidden>.xlsx</div>
              <input ref={fileRef} type="file" accept=".xlsx,.xls,.csv,.pdf" onChange={onFileChange} style={{ display:'none' }} />
              {parsing ? (
                <div style={{ display:'flex', flexDirection:'column', alignItems:'center', gap:'14px' }}>
                  <div style={{ width:'28px', height:'28px', border:'2px solid rgba(92,52,114,0.2)', borderTopColor:'#5C3472', borderRadius:'50%', animation:'spin 0.8s linear infinite' }} />
                  <span style={{ ...cinzel(), fontSize:'10px' }}>Normalizando con Claude…</span>
                </div>
              ) : (
                <div style={{ position:'relative', zIndex:1 }}>
                  <div style={{ width:'48px', height:'48px', background:'rgba(92,52,114,0.1)', border:'1px solid rgba(92,52,114,0.3)', borderRadius:'50%', display:'flex', alignItems:'center', justifyContent:'center', margin:'0 auto 16px', transition:'all 0.2s' }}>
                    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="rgba(92,52,114,0.8)" strokeWidth="1.5"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="12" y1="18" x2="12" y2="12"/><line x1="9" y1="15" x2="15" y2="15"/></svg>
                  </div>
                  <p style={{ fontFamily:"'DM Sans',sans-serif", fontSize:'15px', fontWeight:500, color:'#F0EDE8', marginBottom:'6px' }}>Arrastra el EEFF aquí o haz clic</p>
                  <p style={{ fontSize:'12px', color:'rgba(240,237,232,0.35)' }}>.xlsx · .xls · .csv · .pdf</p>
                </div>
              )}
            </div>
            <div style={{ textAlign:'center' }}>
              <button onClick={() => { setSchema(emptyFIESchema('ForumPHs — Consolidado')); setStep('review') }}
                style={{ background:'transparent', border:'1px solid rgba(92,52,114,0.25)', borderRadius:'6px', padding:'9px 20px', color:'rgba(240,237,232,0.4)', ...cinzel('rgba(240,237,232,0.4)'), fontSize:'9px', cursor:'pointer', transition:'all 0.15s' }}
                onMouseEnter={e => { e.currentTarget.style.borderColor='rgba(92,52,114,0.5)'; e.currentTarget.style.color='rgba(240,237,232,0.65)' }}
                onMouseLeave={e => { e.currentTarget.style.borderColor='rgba(92,52,114,0.25)'; e.currentTarget.style.color='rgba(240,237,232,0.4)' }}>
                Ingresar datos manualmente
              </button>
            </div>
          </div>
        )}

        {/* ════ REVIEW ════ */}
        {step==='review' && schema && (
          <div style={{ display:'grid', gap:'18px', animation:'fade-in 0.35s ease-out forwards' }}>

            {/* Metadata */}
            <Section title="Identificación">
              <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:'12px' }}>
                {[{lbl:'Nombre del edificio / empresa',key:'building_name'},{lbl:'Período',key:'period_label'}].map(f => (
                  <div key={f.key}>
                    <label style={{ ...cinzel(), display:'block', marginBottom:'5px', fontSize:'8px' }}>{f.lbl}</label>
                    <input value={String(schema[f.key as keyof FIESchema]??'')} onChange={e => updateField(f.key as keyof FIESchema,e.target.value)}
                      style={inputStyle}
                      onFocus={e => e.target.style.borderColor='#5C3472'}
                      onBlur={e  => e.target.style.borderColor='rgba(92,52,114,0.3)'} />
                  </div>
                ))}
              </div>
            </Section>

            {/* EEFF months */}
            <Section title={`EEFF Mensual · ${schema.eeff_months.length} meses`} action={
              <button onClick={addMonth} style={{ background:'rgba(92,52,114,0.2)', border:'1px solid rgba(92,52,114,0.3)', borderRadius:'5px', padding:'5px 12px', color:'#EAD9F5', ...cinzel('#EAD9F5'), fontSize:'8px', cursor:'pointer', transition:'all 0.15s' }}
                onMouseEnter={e => { e.currentTarget.style.background='rgba(92,52,114,0.35)' }}
                onMouseLeave={e => { e.currentTarget.style.background='rgba(92,52,114,0.2)' }}>
                + Mes
              </button>
            }>
              {schema.eeff_months.length===0 && <p style={{ ...cinzel(), fontSize:'10px', opacity:.35, textAlign:'center', padding:'20px' }}>Sin meses — agrega uno o sube un archivo</p>}
              <div style={{ display:'grid', gap:'8px' }}>
                {schema.eeff_months.map((m,i) => (
                  <div key={i} style={{ background:'rgba(14,16,24,0.6)', border:'1px solid rgba(255,255,255,0.05)', borderRadius:'8px', padding:'12px', transition:'border-color 0.15s' }}
                    onMouseEnter={e => e.currentTarget.style.borderColor='rgba(92,52,114,0.2)'}
                    onMouseLeave={e => e.currentTarget.style.borderColor='rgba(255,255,255,0.05)'}>
                    <div style={{ display:'grid', gridTemplateColumns:'20px auto 1fr 1fr 1fr auto', gap:'10px', alignItems:'center' }}>
                      <div style={{ ...cinzel('#5C3472'), fontSize:'8px', textAlign:'center' }}>{i+1}</div>
                      <div>
                        <div style={{ ...cinzel(), fontSize:'7px', marginBottom:'3px' }}>Mes</div>
                        <input value={m.month} onChange={e => updateMonth(i,'month',e.target.value)} style={{ ...inputStyle, width:'90px' }}
                          onFocus={e => e.target.style.borderColor='#5C3472'} onBlur={e => e.target.style.borderColor='rgba(92,52,114,0.3)'} />
                      </div>
                      {(['ingresos','gastos'] as const).map(k => (
                        <div key={k}>
                          <div style={{ ...cinzel(), fontSize:'7px', marginBottom:'3px' }}>{k}</div>
                          <input type="number" value={String(m[k]??0)} onChange={e => updateMonth(i,k,parseFloat(e.target.value)||0)} style={inputStyle}
                            onFocus={e => e.target.style.borderColor='#5C3472'} onBlur={e => e.target.style.borderColor='rgba(92,52,114,0.3)'} />
                        </div>
                      ))}
                      <div>
                        <div style={{ ...cinzel(), fontSize:'7px', marginBottom:'3px' }}>Utilidad</div>
                        <div style={{ ...inputStyle as object, background:'rgba(255,255,255,0.02)', color:'rgba(184,176,168,0.5)', border:'1px solid rgba(255,255,255,0.04)', padding:'8px 12px', borderRadius:'6px' }}>{m.utilidad.toFixed(2)}</div>
                      </div>
                      <button onClick={() => removeMonth(i)} style={{ background:'transparent', border:'none', color:'rgba(196,98,45,0.4)', cursor:'pointer', fontSize:'16px', lineHeight:1, padding:'4px', transition:'color 0.15s' }}
                        onMouseEnter={e => e.currentTarget.style.color='#C4622D'}
                        onMouseLeave={e => e.currentTarget.style.color='rgba(196,98,45,0.4)'}>×</button>
                    </div>
                  </div>
                ))}
              </div>
            </Section>

            {/* Cost breakdown */}
            <Section title="Desglose de Costos">
              <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fit,minmax(180px,1fr))', gap:'12px' }}>
                {Object.entries(schema.cost_breakdown).map(([key,val]) => (
                  <div key={key}>
                    <label style={{ ...cinzel(), display:'block', marginBottom:'5px', fontSize:'7px' }}>{COST_LABELS[key]??key}</label>
                    <input type="number" value={String(val??0)} onChange={e => updateCost(key,parseFloat(e.target.value)||0)} style={inputStyle}
                      onFocus={e => e.target.style.borderColor='#5C3472'} onBlur={e => e.target.style.borderColor='rgba(92,52,114,0.3)'} />
                  </div>
                ))}
              </div>
            </Section>

            {/* Constants */}
            <Section title="Constantes del Simulador">
              <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fit,minmax(200px,1fr))', gap:'12px' }}>
                {[
                  {lbl:'Ingresos base / mes',key:'base_income'},
                  {lbl:'Gastos operativos base / mes',key:'base_ops'},
                  {lbl:'Costo por PH nuevo',key:'cost_per_new_ph'},
                  {lbl:'Reservas laborales / mes',key:'labor_res_monthly'},
                  {lbl:'Contingencia / mes',key:'contingency_monthly'},
                  {lbl:'Pasivo laboral histórico',key:'historic_liability'},
                ].map(f => (
                  <div key={f.key}>
                    <label style={{ ...cinzel(), display:'block', marginBottom:'5px', fontSize:'7px' }}>{f.lbl}</label>
                    <div style={{ position:'relative' }}>
                      <span style={{ position:'absolute', left:'10px', top:'50%', transform:'translateY(-50%)', color:'#6B6460', fontSize:'12px' }}>$</span>
                      <input type="number" value={String(schema[f.key as keyof FIESchema]??0)} onChange={e => updateField(f.key as keyof FIESchema, parseFloat(e.target.value)||0)}
                        style={{ ...inputStyle, paddingLeft:'22px' }}
                        onFocus={e => e.target.style.borderColor='#5C3472'} onBlur={e => e.target.style.borderColor='rgba(92,52,114,0.3)'} />
                    </div>
                  </div>
                ))}
              </div>
            </Section>

            {/* Summary */}
            {schema.eeff_months.length>0 && (
              <div style={{ background:'rgba(92,52,114,0.07)', border:'1px solid rgba(92,52,114,0.25)', borderRadius:'10px', padding:'16px 22px', display:'flex', gap:'24px', flexWrap:'wrap', animation:'fade-in 0.3s ease-out forwards' }}>
                {[
                  {lbl:'Meses',val:String(schema.eeff_months.length)},
                  {lbl:'Ingresos prom/mes',val:fmt$(schema.eeff_months.reduce((s,m)=>s+m.ingresos,0)/schema.eeff_months.length)},
                  {lbl:'Utilidad total',val:fmt$(schema.eeff_months.reduce((s,m)=>s+m.utilidad,0))},
                  {lbl:'Margen prom',val:(schema.eeff_months.reduce((s,m)=>s+m.margen,0)/schema.eeff_months.length).toFixed(1)+'%'},
                ].map(k => (
                  <div key={k.lbl}>
                    <div style={{ ...cinzel(), fontSize:'7px', marginBottom:'3px' }}>{k.lbl}</div>
                    <div style={{ fontFamily:"'EB Garamond',serif", fontSize:'20px', color:'#F0EDE8' }}>{k.val}</div>
                  </div>
                ))}
              </div>
            )}

            {/* CTA Generate */}
            <button onClick={handleGenerate}
              style={{ width:'100%', padding:'14px', background:'#5C3472', border:'1px solid rgba(92,52,114,0.5)', borderRadius:'8px', color:'#F0EDE8', ...cinzel('#F0EDE8'), fontSize:'11px', cursor:'pointer', transition:'filter 0.15s, transform 0.15s', letterSpacing:'0.16em' }}
              onMouseEnter={e => { e.currentTarget.style.filter='brightness(1.15)'; e.currentTarget.style.transform='translateY(-1px)' }}
              onMouseLeave={e => { e.currentTarget.style.filter='none'; e.currentTarget.style.transform='none' }}>
              Generar Suite FIE · 7 Paneles + Simulador
            </button>
          </div>
        )}

        {/* ════ GENERATING ════ */}
        {step==='generating' && (
          <div style={{ textAlign:'center', padding:'80px 0', animation:'fade-in 0.3s ease-out forwards' }}>
            <div style={{ width:'36px', height:'36px', border:'3px solid rgba(92,52,114,0.2)', borderTopColor:'#5C3472', borderRadius:'50%', animation:'spin 0.8s linear infinite', margin:'0 auto 20px' }} />
            <div style={cinzel()}>Claude generando narrativa + 7 paneles…</div>
            <p style={{ fontFamily:"'EB Garamond',serif", fontSize:'14px', fontStyle:'italic', color:'rgba(240,237,232,0.3)', marginTop:'8px' }}>10–20 segundos</p>
          </div>
        )}

        {/* ════ DONE ════ */}
        {step==='done' && schema && (
          <div style={{ textAlign:'center', padding:'60px 0', animation:'snap-in 0.4s ease-out forwards' }}>
            <div style={{ width:'48px', height:'48px', background:'rgba(74,222,128,0.1)', borderRadius:'50%', display:'flex', alignItems:'center', justifyContent:'center', margin:'0 auto 16px' }}>
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#4ADE80" strokeWidth="2"><polyline points="20 6 9 17 4 12"/></svg>
            </div>
            <div style={{ fontFamily:"'EB Garamond',serif", fontSize:'24px', color:'#F0EDE8', marginBottom:'6px' }}>Suite FIE descargada</div>
            <p style={{ fontFamily:"'DM Sans',sans-serif", fontSize:'13px', color:'#6B6460', marginBottom:'24px' }}>{schema.building_name} · {schema.period_label}</p>
            <div style={{ display:'flex', gap:'12px', justifyContent:'center', flexWrap:'wrap' }}>
              {[
                { lbl:'Editar y regenerar',  action:()=>setStep('review'), style:{ background:'transparent', border:'1px solid rgba(92,52,114,0.35)', color:'rgba(240,237,232,0.5)' } },
                { lbl:'Nuevo análisis',       action:()=>{ setSchema(null); setStep('upload') }, style:{ background:'rgba(92,52,114,0.2)', border:'1px solid rgba(92,52,114,0.4)', color:'#EAD9F5' } },
              ].map(btn => (
                <button key={btn.lbl} onClick={btn.action}
                  style={{ padding:'10px 20px', ...btn.style as object, borderRadius:'6px', ...cinzel((btn.style as any).color) as object, fontSize:'9px', cursor:'pointer', transition:'all 0.15s' }}
                  onMouseEnter={e => { e.currentTarget.style.filter='brightness(1.15)'; e.currentTarget.style.transform='translateY(-1px)' }}
                  onMouseLeave={e => { e.currentTarget.style.filter='none'; e.currentTarget.style.transform='none' }}>
                  {btn.lbl}
                </button>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* ══ FOOTER ══════════════════════════════════════════════ */}
      <footer style={{ position:'fixed', bottom:0, left:0, right:0, borderTop:'2px solid #5C3472', background:'rgba(14,16,24,0.97)', backdropFilter:'blur(12px)', WebkitBackdropFilter:'blur(12px)', padding:'7px 28px', display:'flex', alignItems:'center', justifyContent:'space-between', gap:'12px', zIndex:100 }}>
        <div style={{ display:'inline-flex', alignItems:'baseline', gap:0, lineHeight:1 }}>
          <span style={{ fontFamily:"'EB Garamond',serif", fontWeight:400, color:'rgba(240,237,232,0.55)', fontSize:'14px' }}>Forum</span>
          <span style={{ fontFamily:"'DM Sans',sans-serif", fontWeight:700, color:'#C4622D', letterSpacing:'0.06em', fontSize:'13px' }}>PH</span>
          <span style={{ fontFamily:"'DM Sans',sans-serif", fontWeight:700, color:'#C4622D', letterSpacing:'0.04em', fontSize:'13px' }}>s</span>
          <span style={{ fontFamily:"'DM Sans',sans-serif", fontSize:'9px', color:'rgba(240,237,232,0.2)', letterSpacing:'0.06em', marginLeft:'8px' }}>FIE v1.0 · Normalizer</span>
        </div>
        <div style={{ fontFamily:"'DM Sans',sans-serif", fontSize:'9px', color:'rgba(200,196,190,0.18)', letterSpacing:'0.04em' }}>Financial Intelligence Engine · Nivel 2</div>
      </footer>

      <style>{`
        @keyframes spin    { to{transform:rotate(360deg)} }
        @keyframes fade-in { from{opacity:0;transform:translateY(8px)} to{opacity:1;transform:none} }
        @keyframes snap-in { from{opacity:0;transform:scale(0.96)} to{opacity:1;transform:none} }
        @keyframes dot-breathe { 0%,100%{opacity:1;transform:scale(1)} 50%{opacity:.5;transform:scale(0.65)} }
        @media (prefers-reduced-motion:reduce){*{animation-duration:0.01ms!important}}
      `}</style>
    </div>
  )
}

function Section({ title, children, action }: { title:string; children:React.ReactNode; action?:React.ReactNode }) {
  return (
    <div style={{ background:'#1C2233', border:'1px solid rgba(92,52,114,0.18)', borderRadius:'10px', padding:'22px', animation:'fade-in 0.35s ease-out forwards', transition:'border-color 0.2s' }}
      onMouseEnter={e => e.currentTarget.style.borderColor='rgba(92,52,114,0.3)'}
      onMouseLeave={e => e.currentTarget.style.borderColor='rgba(92,52,114,0.18)'}>
      <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:'18px' }}>
        <div style={{ fontFamily:"'Cinzel',serif", fontSize:'9px', fontWeight:600, letterSpacing:'0.2em', textTransform:'uppercase' as const, color:'#C4622D' }}>{title}</div>
        {action}
      </div>
      {children}
    </div>
  )
}
