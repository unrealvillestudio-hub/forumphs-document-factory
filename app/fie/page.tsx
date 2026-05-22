'use client'

import { useState, useCallback, useRef } from 'react'
import type { FIESchema, FIEMonth } from '@/lib/fie/schema'
import { FIE_DEFAULT_SCENARIOS, emptyFIESchema } from '@/lib/fie/schema'

type Step   = 'upload' | 'review' | 'generating' | 'done'
type Source = 'file' | 'supabase' | 'manual'

// ─── Buildings (misma lista que BI) ─────────────────────────────
const BUILDINGS = [
  { id: '2b61944c-6a14-4177-a870-7bbecea17803', name: 'Venezia Tower' },
  { id: 'd30e6888-1fc3-43bc-960c-94a012b753d0', name: 'PH Lefevre 75 Don Enrique' },
  { id: 'e90da0fd-bb6e-4e4d-9015-50e0c17a1794', name: 'PH Los Álamos' },
  { id: '4a798598-3b94-438e-9b49-bdc15985d365', name: 'PH Luxor Towers 300' },
  { id: '33560559-1fec-47fc-9086-206817a00153', name: 'PH Torres de Castilla' },
  { id: '16a68732-256d-49d6-ae47-adcd72225c1a', name: 'PH Firenze Tower' },
  { id: '3429020f-c002-42c8-97d3-afd5ea2552a2', name: 'PH Plaza España' },
  { id: '7e11008d-89da-4228-8e16-39bb24d0b37f', name: 'PH Parque Central Arraiján' },
]

const fmt$ = (n: number) => '$' + n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
const cinzel = (color = 'rgba(184,176,168,0.55)'): React.CSSProperties => ({
  fontFamily: "'Cinzel', serif", fontSize: '9px', fontWeight: 600,
  letterSpacing: '0.22em', textTransform: 'uppercase' as const, color,
})
const COST_LABELS: Record<string, string> = {
  salarios: 'Planilla / Salarios', css: 'CSS Obrero-Patronal',
  honorarios: 'Honorarios Profesionales', viaticos: 'Viáticos',
  servicios: 'Servicios / Facturas', stack: 'Stack Tecnológico', otros: 'Otros',
}
const inputStyle: React.CSSProperties = {
  background: 'rgba(14,16,24,0.85)', border: '1px solid rgba(92,52,114,0.3)',
  borderRadius: '6px', padding: '8px 12px', color: '#F0EDE8', fontSize: '13px',
  width: '100%', outline: 'none', fontFamily: "'DM Sans', sans-serif", transition: 'border-color 0.15s',
}

// ════════════════════════════════════════════════════════════════
export default function FIEPage() {
  const [step, setStep]         = useState<Step>('upload')
  const [source, setSource]     = useState<Source>('file')
  const [schema, setSchema]     = useState<FIESchema | null>(null)
  const [error, setError]       = useState<string | null>(null)
  const [loading, setLoading]   = useState(false)
  const [dragOver, setDragOver] = useState(false)
  // Supabase mode
  const [buildingId, setBuildingId]     = useState('')
  const [sbMonths, setSbMonths]         = useState('6')
  const fileRef = useRef<HTMLInputElement>(null)

  // ── LOAD FROM SUPABASE ───────────────────────────────────────
  const handleLoadSupabase = useCallback(async () => {
    if (!buildingId) return
    setError(null); setLoading(true)
    try {
      const res  = await fetch(`/api/fie/supabase?building_id=${buildingId}&months=${sbMonths}`)
      const data = await res.json()
      if (!res.ok || data.error) throw new Error(data.error ?? `HTTP ${res.status}`)
      const merged: FIESchema = {
        ...emptyFIESchema(data.schema.building_name),
        ...data.schema,
        scenarios: data.schema.scenarios ?? FIE_DEFAULT_SCENARIOS,
      }
      setSchema(merged); setSource('supabase'); setStep('review')
    } catch(e: unknown) { setError(e instanceof Error ? e.message : 'Error cargando Supabase') }
    finally { setLoading(false) }
  }, [buildingId, sbMonths])

  // ── LOAD FROM FILE ───────────────────────────────────────────
  const handleFile = useCallback(async (file: File) => {
    setError(null); setLoading(true)
    try {
      const fd = new FormData(); fd.append('file', file)
      const res  = await fetch('/api/fie/parse', { method: 'POST', body: fd })
      const data = await res.json()
      if (!res.ok || data.error) throw new Error(data.error ?? `HTTP ${res.status}`)
      const merged: FIESchema = {
        ...emptyFIESchema(data.schema.building_name),
        ...data.schema,
        scenarios: data.schema.scenarios ?? FIE_DEFAULT_SCENARIOS,
        generated_at: new Date().toISOString(), currency: 'USD',
      }
      setSchema(merged); setSource('file'); setStep('review')
    } catch(e: unknown) { setError(e instanceof Error ? e.message : 'Error procesando archivo') }
    finally { setLoading(false) }
  }, [])

  const onDrop       = (e: React.DragEvent) => { e.preventDefault(); setDragOver(false); const f=e.dataTransfer.files?.[0]; if(f) handleFile(f) }
  const onFileChange = (e: React.ChangeEvent<HTMLInputElement>) => { const f=e.target.files?.[0]; if(f) handleFile(f) }

  // ── GENERATE ─────────────────────────────────────────────────
  const handleGenerate = useCallback(async () => {
    if (!schema) return
    setStep('generating'); setError(null)
    try {
      const res  = await fetch('/api/fie/generate', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ schema }),
      })
      if (!res.ok) throw new Error(`Error ${res.status}`)
      const html = await res.text()
      const blob = new Blob([html], { type: 'text/html' })
      const url  = URL.createObjectURL(blob)
      const a    = document.createElement('a')
      a.href = url
      a.download = `FIE_${schema.building_name.replace(/[^a-zA-Z0-9]/g,'_')}_${schema.period_label.replace(/ /g,'_')}.html`
      a.click(); URL.revokeObjectURL(url); setStep('done')
    } catch(e: unknown) { setError(e instanceof Error ? e.message : 'Error'); setStep('review') }
  }, [schema])

  // ── SCHEMA EDITORS ───────────────────────────────────────────
  const updateField = (key: keyof FIESchema, value: unknown) => setSchema(s => s ? {...s,[key]:value} : s)
  const updateCost  = (key: string, value: number) => setSchema(s => s ? {...s,cost_breakdown:{...s.cost_breakdown,[key]:value}} : s)
  const updateMonth = (i: number, key: keyof FIEMonth, value: number|string) =>
    setSchema(s => {
      if (!s) return s
      const months=[...s.eeff_months]; months[i]={...months[i],[key]:value}
      if (key==='ingresos'||key==='gastos') { const u=months[i].ingresos-months[i].gastos; months[i].utilidad=u; months[i].margen=months[i].ingresos>0?(u/months[i].ingresos)*100:0 }
      return {...s,eeff_months:months}
    })
  const addMonth    = () => setSchema(s => s ? {...s,eeff_months:[...s.eeff_months,{month:'',ingresos:0,gastos:0,utilidad:0,margen:0}]} : s)
  const removeMonth = (i: number) => setSchema(s => s ? {...s,eeff_months:s.eeff_months.filter((_,idx)=>idx!==i)} : s)

  // ── RENDER ───────────────────────────────────────────────────
  return (
    <div style={{ minHeight:'100vh', background:'#0E1018', color:'#F0EDE8', fontFamily:"'DM Sans',sans-serif", paddingBottom:'80px', position:'relative', zIndex:1 }}>

      {/* HERO */}
      <div style={{ position:'relative', overflow:'hidden', padding:'48px 0 32px', borderBottom:'1px solid rgba(92,52,114,0.12)' }}>
        <div style={{ position:'absolute', inset:0, background:'radial-gradient(circle at 80% 10%, rgba(92,52,114,0.18), transparent 60%)', pointerEvents:'none' }} />
        <div style={{ maxWidth:'960px', margin:'0 auto', padding:'0 28px', position:'relative', zIndex:1 }}>
          <div style={{ ...cinzel('#C4622D'), marginBottom:'10px', animation:'fade-in 0.4s ease-out forwards' }}>Financial Intelligence Engine · Nivel 2</div>
          <div style={{ fontFamily:"'Cormorant Garamond',serif", fontSize:'clamp(2.2rem,5vw,4rem)', fontWeight:300, fontStyle:'italic', lineHeight:1, color:'#EAD9F5', marginBottom:'10px', animation:'fade-in 0.5s 0.1s ease-out both' }}>
            Normalizer &amp; Suite FIE
          </div>
          <p style={{ fontFamily:"'EB Garamond',serif", fontSize:'16px', fontStyle:'italic', color:'rgba(240,237,232,0.4)', margin:0, animation:'fade-in 0.5s 0.2s ease-out both' }}>
            Supabase Realtime · .xlsx · .pdf → JSON → Claude → HTML 7 paneles + simulador
          </p>
        </div>
      </div>

      {/* STEPPER */}
      <div style={{ maxWidth:'960px', margin:'0 auto', padding:'20px 28px 0' }}>
        <div style={{ display:'flex', gap:0, borderBottom:'1px solid rgba(255,255,255,0.06)' }}>
          {(['upload','review','done'] as const).map((s,i) => (
            <div key={s} style={{ padding:'10px 16px', borderBottom:`2px solid ${step===s?'#C4622D':'transparent'}`, transition:'border-color 0.2s' }}>
              <span style={{ ...cinzel(step===s?'#C4622D':'rgba(240,237,232,0.2)') }}>{i+1} · {s==='upload'?'Fuente de datos':s==='review'?'Revisar & editar':'Listo'}</span>
            </div>
          ))}
        </div>
      </div>

      <div style={{ maxWidth:'960px', margin:'0 auto', padding:'28px', display:'grid', gap:'16px' }}>

        {/* ERROR */}
        {error && (
          <div style={{ background:'rgba(196,98,45,0.07)', border:'1px solid rgba(196,98,45,0.25)', borderLeft:'3px solid #C4622D', borderRadius:'8px', padding:'14px 18px', fontSize:'13px', color:'#C4622D', animation:'snap-in 0.3s ease-out forwards' }}>
            {error}
          </div>
        )}

        {/* ════ STEP 1: UPLOAD ════ */}
        {step === 'upload' && (
          <div style={{ display:'grid', gap:'16px', animation:'snap-in 0.35s ease-out forwards' }}>

            {/* ── OPCIÓN A: Supabase Realtime ── */}
            <div style={{ background:'#1C2233', border:'1px solid rgba(92,52,114,0.35)', borderRadius:'10px', padding:'22px' }}>
              <div style={{ display:'flex', alignItems:'center', gap:'10px', marginBottom:'16px' }}>
                <div style={{ ...cinzel('#EAD9F5') }}>Cargar desde Supabase</div>
                <span style={{ background:'rgba(92,52,114,0.2)', border:'1px solid rgba(92,52,114,0.35)', borderRadius:'20px', padding:'2px 8px', ...cinzel('#EAD9F5'), fontSize:'7px' }}>Recomendado</span>
              </div>
              <div style={{ display:'grid', gridTemplateColumns:'1fr auto', gap:'12px', marginBottom:'14px' }}>
                <div>
                  <label style={{ ...cinzel(), display:'block', marginBottom:'5px', fontSize:'8px' }}>Edificio</label>
                  <select value={buildingId} onChange={e => setBuildingId(e.target.value)}
                    style={{ ...inputStyle, cursor:'pointer' }}
                    onFocus={e => e.target.style.borderColor='#5C3472'}
                    onBlur={e  => e.target.style.borderColor='rgba(92,52,114,0.3)'}>
                    <option value="">— Seleccionar —</option>
                    {BUILDINGS.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}
                  </select>
                </div>
                <div style={{ minWidth:'90px' }}>
                  <label style={{ ...cinzel(), display:'block', marginBottom:'5px', fontSize:'8px' }}>Meses</label>
                  <select value={sbMonths} onChange={e => setSbMonths(e.target.value)}
                    style={{ ...inputStyle, cursor:'pointer' }}
                    onFocus={e => e.target.style.borderColor='#5C3472'}
                    onBlur={e  => e.target.style.borderColor='rgba(92,52,114,0.3)'}>
                    {['3','6','9','12'].map(m => <option key={m} value={m}>{m} meses</option>)}
                  </select>
                </div>
              </div>
              <button onClick={handleLoadSupabase} disabled={!buildingId || loading}
                style={{ width:'100%', padding:'10px', background: buildingId&&!loading?'#5C3472':'rgba(92,52,114,0.2)', border:'1px solid rgba(92,52,114,0.45)', borderRadius:'6px', color:'#F0EDE8', ...cinzel('#F0EDE8'), fontSize:'10px', cursor:buildingId&&!loading?'pointer':'not-allowed', transition:'filter 0.15s', display:'flex', alignItems:'center', justifyContent:'center', gap:'8px' }}
                onMouseEnter={e => { if(buildingId&&!loading) e.currentTarget.style.filter='brightness(1.15)' }}
                onMouseLeave={e => e.currentTarget.style.filter='none'}>
                {loading ? <><Spinner />Cargando desde Supabase…</> : 'Cargar datos del edificio'}
              </button>
            </div>

            {/* Divider */}
            <div style={{ display:'flex', alignItems:'center', gap:'12px' }}>
              <div style={{ flex:1, height:'1px', background:'rgba(255,255,255,0.06)' }} />
              <span style={{ ...cinzel(), fontSize:'8px', opacity:.4 }}>o subir archivo</span>
              <div style={{ flex:1, height:'1px', background:'rgba(255,255,255,0.06)' }} />
            </div>

            {/* ── OPCIÓN B: Upload archivo ── */}
            <div
              onDragOver={e => { e.preventDefault(); setDragOver(true) }}
              onDragLeave={() => setDragOver(false)}
              onDrop={onDrop}
              onClick={() => fileRef.current?.click()}
              style={{ border:`2px dashed ${dragOver?'#C4622D':'rgba(92,52,114,0.2)'}`, borderRadius:'10px', padding:'32px', textAlign:'center', cursor:'pointer', background:dragOver?'rgba(196,98,45,0.04)':'rgba(28,34,51,0.3)', transition:'all 0.2s' }}>
              <input ref={fileRef} type="file" accept=".xlsx,.xls,.csv,.pdf" onChange={onFileChange} style={{ display:'none' }} />
              {loading ? (
                <div style={{ display:'flex', flexDirection:'column', alignItems:'center', gap:'12px' }}>
                  <Spinner /><span style={{ ...cinzel(), fontSize:'9px' }}>Normalizando con Claude…</span>
                </div>
              ) : (
                <>
                  <p style={{ fontSize:'14px', fontWeight:500, color:'rgba(240,237,232,0.6)', margin:'0 0 4px' }}>Arrastra EEFF aquí</p>
                  <p style={{ fontSize:'11px', color:'rgba(240,237,232,0.3)' }}>.xlsx · .xls · .csv · .pdf</p>
                </>
              )}
            </div>

            {/* ── OPCIÓN C: Manual ── */}
            <div style={{ textAlign:'center' }}>
              <button onClick={() => { setSchema(emptyFIESchema('ForumPHs — Consolidado')); setSource('manual'); setStep('review') }}
                style={{ background:'transparent', border:'1px solid rgba(92,52,114,0.2)', borderRadius:'6px', padding:'8px 18px', color:'rgba(240,237,232,0.35)', ...cinzel('rgba(240,237,232,0.35)'), fontSize:'8px', cursor:'pointer', transition:'all 0.15s' }}
                onMouseEnter={e => { e.currentTarget.style.borderColor='rgba(92,52,114,0.4)'; e.currentTarget.style.color='rgba(240,237,232,0.6)' }}
                onMouseLeave={e => { e.currentTarget.style.borderColor='rgba(92,52,114,0.2)'; e.currentTarget.style.color='rgba(240,237,232,0.35)' }}>
                Ingresar manualmente
              </button>
            </div>
          </div>
        )}

        {/* ════ STEP 2: REVIEW ════ */}
        {step === 'review' && schema && (
          <div style={{ display:'grid', gap:'16px', animation:'fade-in 0.35s ease-out forwards' }}>

            {/* Source badge */}
            <div style={{ display:'flex', alignItems:'center', gap:'8px' }}>
              <span style={{ background: source==='supabase'?'rgba(92,52,114,0.2)':source==='file'?'rgba(196,98,45,0.1)':'rgba(107,100,96,0.15)', border:`1px solid ${source==='supabase'?'rgba(92,52,114,0.4)':source==='file'?'rgba(196,98,45,0.35)':'rgba(107,100,96,0.3)'}`, borderRadius:'20px', padding:'3px 10px', ...cinzel(source==='supabase'?'#EAD9F5':source==='file'?'#C4622D':'#B8B0A8'), fontSize:'8px' }}>
                {source==='supabase'?'Supabase Realtime':source==='file'?'Archivo normalizado':'Manual'}
              </span>
              <span style={{ fontFamily:"'EB Garamond',serif", fontSize:'18px', color:'#F0EDE8' }}>{schema.building_name}</span>
              {schema.eeff_months.length > 0 && (
                <span style={{ ...cinzel(), fontSize:'8px', opacity:.4 }}>{schema.period_label}</span>
              )}
            </div>

            {/* Metadata */}
            <Section title="Identificación">
              <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:'12px' }}>
                {[{lbl:'Nombre del edificio',key:'building_name'},{lbl:'Período',key:'period_label'}].map(f => (
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

            {/* EEFF */}
            <Section title={`EEFF Mensual · ${schema.eeff_months.length} meses`} action={
              <button onClick={addMonth} style={{ background:'rgba(92,52,114,0.15)', border:'1px solid rgba(92,52,114,0.3)', borderRadius:'5px', padding:'4px 10px', color:'#EAD9F5', ...cinzel('#EAD9F5'), fontSize:'8px', cursor:'pointer' }}>
                + Mes
              </button>
            }>
              {schema.eeff_months.length === 0 && (
                <p style={{ ...cinzel(), fontSize:'9px', opacity:.35, textAlign:'center', padding:'16px' }}>Sin datos de EEFF — agrega meses manualmente</p>
              )}
              <div style={{ display:'grid', gap:'8px' }}>
                {schema.eeff_months.map((m,i) => (
                  <div key={i} style={{ background:'rgba(14,16,24,0.6)', border:'1px solid rgba(255,255,255,0.05)', borderRadius:'7px', padding:'10px', display:'grid', gridTemplateColumns:'16px auto 1fr 1fr 1fr auto', gap:'8px', alignItems:'center' }}
                    onMouseEnter={e => e.currentTarget.style.borderColor='rgba(92,52,114,0.2)'}
                    onMouseLeave={e => e.currentTarget.style.borderColor='rgba(255,255,255,0.05)'}>
                    <div style={{ ...cinzel('#5C3472'), fontSize:'7px', textAlign:'center' }}>{i+1}</div>
                    <div>
                      <div style={{ ...cinzel(), fontSize:'7px', marginBottom:'3px' }}>Mes</div>
                      <input value={m.month} onChange={e => updateMonth(i,'month',e.target.value)} style={{ ...inputStyle, width:'88px' }}
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
                      <div style={{ ...inputStyle, background:'rgba(255,255,255,0.02)', color:'rgba(184,176,168,0.5)', border:'1px solid rgba(255,255,255,0.04)', padding:'8px 10px', borderRadius:'6px' }}>{m.utilidad.toFixed(0)}</div>
                    </div>
                    <button onClick={() => removeMonth(i)} style={{ background:'transparent', border:'none', color:'rgba(196,98,45,0.4)', cursor:'pointer', fontSize:'15px', lineHeight:1, transition:'color 0.15s' }}
                      onMouseEnter={e => e.currentTarget.style.color='#C4622D'}
                      onMouseLeave={e => e.currentTarget.style.color='rgba(196,98,45,0.4)'}>×</button>
                  </div>
                ))}
              </div>
            </Section>

            {/* Costos */}
            <Section title="Desglose de Costos (promedio mensual)">
              <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fit,minmax(175px,1fr))', gap:'10px' }}>
                {Object.entries(schema.cost_breakdown).map(([key,val]) => (
                  <div key={key}>
                    <label style={{ ...cinzel(), display:'block', marginBottom:'4px', fontSize:'7px' }}>{COST_LABELS[key]??key}</label>
                    <input type="number" value={String(val??0)} onChange={e => updateCost(key,parseFloat(e.target.value)||0)} style={inputStyle}
                      onFocus={e => e.target.style.borderColor='#5C3472'} onBlur={e => e.target.style.borderColor='rgba(92,52,114,0.3)'} />
                  </div>
                ))}
              </div>
            </Section>

            {/* Constantes simulador */}
            <Section title="Constantes del Simulador">
              <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fit,minmax(190px,1fr))', gap:'10px' }}>
                {[
                  {lbl:'Ingresos base / mes',key:'base_income'},
                  {lbl:'Gastos operativos / mes',key:'base_ops'},
                  {lbl:'Costo por PH nuevo',key:'cost_per_new_ph'},
                  {lbl:'Reservas laborales / mes',key:'labor_res_monthly'},
                  {lbl:'Contingencia / mes',key:'contingency_monthly'},
                  {lbl:'Pasivo laboral histórico',key:'historic_liability'},
                ].map(f => (
                  <div key={f.key}>
                    <label style={{ ...cinzel(), display:'block', marginBottom:'4px', fontSize:'7px' }}>{f.lbl}</label>
                    <div style={{ position:'relative' }}>
                      <span style={{ position:'absolute', left:'10px', top:'50%', transform:'translateY(-50%)', color:'#6B6460', fontSize:'12px' }}>$</span>
                      <input type="number" value={String(schema[f.key as keyof FIESchema]??0)} onChange={e => updateField(f.key as keyof FIESchema,parseFloat(e.target.value)||0)}
                        style={{ ...inputStyle, paddingLeft:'22px' }}
                        onFocus={e => e.target.style.borderColor='#5C3472'} onBlur={e => e.target.style.borderColor='rgba(92,52,114,0.3)'} />
                    </div>
                  </div>
                ))}
              </div>
            </Section>

            {/* Summary */}
            {schema.eeff_months.length > 0 && (
              <div style={{ background:'rgba(92,52,114,0.07)', border:'1px solid rgba(92,52,114,0.22)', borderRadius:'9px', padding:'14px 20px', display:'flex', gap:'22px', flexWrap:'wrap' }}>
                {[
                  {lbl:'Meses',val:String(schema.eeff_months.length)},
                  {lbl:'Ingresos prom/mes',val:fmt$(schema.eeff_months.reduce((s,m)=>s+m.ingresos,0)/schema.eeff_months.length)},
                  {lbl:'Utilidad total',val:fmt$(schema.eeff_months.reduce((s,m)=>s+m.utilidad,0))},
                  {lbl:'Margen prom',val:(schema.eeff_months.reduce((s,m)=>s+m.margen,0)/schema.eeff_months.length).toFixed(1)+'%'},
                ].map(k => (
                  <div key={k.lbl}>
                    <div style={{ ...cinzel(), fontSize:'7px', marginBottom:'3px' }}>{k.lbl}</div>
                    <div style={{ fontFamily:"'EB Garamond',serif", fontSize:'19px', color:'#F0EDE8' }}>{k.val}</div>
                  </div>
                ))}
              </div>
            )}

            {/* CTA */}
            <button onClick={handleGenerate}
              style={{ width:'100%', padding:'13px', background:'#5C3472', border:'1px solid rgba(92,52,114,0.5)', borderRadius:'8px', color:'#F0EDE8', ...cinzel('#F0EDE8'), fontSize:'11px', cursor:'pointer', transition:'filter 0.15s, transform 0.15s', letterSpacing:'0.16em' }}
              onMouseEnter={e => { e.currentTarget.style.filter='brightness(1.15)'; e.currentTarget.style.transform='translateY(-1px)' }}
              onMouseLeave={e => { e.currentTarget.style.filter='none'; e.currentTarget.style.transform='none' }}>
              Generar Suite FIE · 7 Paneles + Simulador
            </button>
          </div>
        )}

        {/* ════ GENERATING ════ */}
        {step === 'generating' && (
          <div style={{ textAlign:'center', padding:'70px 0', animation:'fade-in 0.3s ease-out forwards' }}>
            <div style={{ width:'34px', height:'34px', border:'3px solid rgba(92,52,114,0.15)', borderTopColor:'#5C3472', borderRadius:'50%', animation:'spin 0.8s linear infinite', margin:'0 auto 18px' }} />
            <div style={cinzel()}>Claude generando narrativa + 7 paneles…</div>
            <p style={{ fontFamily:"'EB Garamond',serif", fontSize:'14px', fontStyle:'italic', color:'rgba(240,237,232,0.25)', marginTop:'8px' }}>10–20 segundos</p>
          </div>
        )}

        {/* ════ DONE ════ */}
        {step === 'done' && schema && (
          <div style={{ textAlign:'center', padding:'55px 0', animation:'snap-in 0.4s ease-out forwards' }}>
            <div style={{ width:'46px', height:'46px', background:'rgba(74,222,128,0.1)', borderRadius:'50%', display:'flex', alignItems:'center', justifyContent:'center', margin:'0 auto 14px' }}>
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#4ADE80" strokeWidth="2"><polyline points="20 6 9 17 4 12"/></svg>
            </div>
            <div style={{ fontFamily:"'EB Garamond',serif", fontSize:'22px', color:'#F0EDE8', marginBottom:'5px' }}>Suite FIE descargada</div>
            <p style={{ fontSize:'12px', color:'#6B6460', marginBottom:'22px' }}>{schema.building_name} · {schema.period_label}</p>
            <div style={{ display:'flex', gap:'10px', justifyContent:'center', flexWrap:'wrap' }}>
              <button onClick={() => setStep('review')}
                style={{ padding:'9px 18px', background:'transparent', border:'1px solid rgba(92,52,114,0.3)', borderRadius:'6px', color:'rgba(240,237,232,0.45)', ...cinzel('rgba(240,237,232,0.45)'), fontSize:'8px', cursor:'pointer', transition:'all 0.15s' }}
                onMouseEnter={e => { e.currentTarget.style.borderColor='rgba(92,52,114,0.5)'; e.currentTarget.style.color='rgba(240,237,232,0.65)' }}
                onMouseLeave={e => { e.currentTarget.style.borderColor='rgba(92,52,114,0.3)'; e.currentTarget.style.color='rgba(240,237,232,0.45)' }}>
                Editar y regenerar
              </button>
              <button onClick={() => { setSchema(null); setStep('upload') }}
                style={{ padding:'9px 18px', background:'rgba(92,52,114,0.15)', border:'1px solid rgba(92,52,114,0.35)', borderRadius:'6px', color:'#EAD9F5', ...cinzel('#EAD9F5'), fontSize:'8px', cursor:'pointer', transition:'all 0.15s' }}
                onMouseEnter={e => { e.currentTarget.style.filter='brightness(1.1)' }}
                onMouseLeave={e => { e.currentTarget.style.filter='none' }}>
                Nuevo análisis
              </button>
            </div>
          </div>
        )}
      </div>

      {/* FOOTER */}
      <footer style={{ position:'fixed', bottom:0, left:0, right:0, borderTop:'2px solid #5C3472', background:'rgba(14,16,24,0.97)', backdropFilter:'blur(12px)', WebkitBackdropFilter:'blur(12px)', padding:'7px 28px', display:'flex', alignItems:'center', justifyContent:'space-between', gap:'12px', zIndex:100 }}>
        <div style={{ display:'inline-flex', alignItems:'baseline', gap:0, lineHeight:1 }}>
          <span style={{ fontFamily:"'EB Garamond',serif", fontWeight:400, color:'rgba(240,237,232,0.55)', fontSize:'14px' }}>Forum</span>
          <span style={{ fontFamily:"'DM Sans',sans-serif", fontWeight:700, color:'#C4622D', letterSpacing:'0.06em', fontSize:'13px' }}>PH</span>
          <span style={{ fontFamily:"'DM Sans',sans-serif", fontWeight:700, color:'#C4622D', letterSpacing:'0.04em', fontSize:'13px' }}>s</span>
          <span style={{ fontFamily:"'DM Sans',sans-serif", fontSize:'9px', color:'rgba(240,237,232,0.2)', letterSpacing:'0.06em', marginLeft:'8px' }}>FIE v1.1 · Supabase Realtime</span>
        </div>
        <div style={{ fontFamily:"'DM Sans',sans-serif", fontSize:'9px', color:'rgba(200,196,190,0.18)' }}>Financial Intelligence Engine · Nivel 2</div>
      </footer>

      <style>{`
        @keyframes fade-in  { from{opacity:0;transform:translateY(8px)} to{opacity:1;transform:none} }
        @keyframes snap-in  { from{opacity:0;transform:scale(0.96)} to{opacity:1;transform:none} }
        @keyframes spin     { to{transform:rotate(360deg)} }
        @media (prefers-reduced-motion:reduce){*{animation-duration:0.01ms!important}}
      `}</style>
    </div>
  )
}

function Spinner() {
  return <span style={{ width:'13px', height:'13px', border:'2px solid rgba(240,237,232,0.15)', borderTopColor:'rgba(240,237,232,0.7)', borderRadius:'50%', display:'inline-block', animation:'spin 0.8s linear infinite', flexShrink:0 }} />
}

function Section({ title, children, action }: { title:string; children:React.ReactNode; action?:React.ReactNode }) {
  return (
    <div style={{ background:'#1C2233', border:'1px solid rgba(92,52,114,0.15)', borderRadius:'10px', padding:'20px', transition:'border-color 0.2s' }}
      onMouseEnter={e => e.currentTarget.style.borderColor='rgba(92,52,114,0.28)'}
      onMouseLeave={e => e.currentTarget.style.borderColor='rgba(92,52,114,0.15)'}>
      <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:'16px' }}>
        <div style={{ fontFamily:"'Cinzel',serif", fontSize:'9px', fontWeight:600, letterSpacing:'0.2em', textTransform:'uppercase' as const, color:'#C4622D' }}>{title}</div>
        {action}
      </div>
      {children}
    </div>
  )
}
