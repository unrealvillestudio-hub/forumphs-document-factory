'use client';

import { useState } from 'react';

/* ─── Static building list (from Supabase ForumPHs — tajuoqdbnsnzkhyqvdgs) ─── */
const BUILDINGS = [
  { id: '2b61944c-6a14-4177-a870-7bbecea17803', name: 'Venezia Tower', units: 182 },
  { id: 'd30e6888-1fc3-43bc-960c-94a012b753d0', name: 'PH Lefevre 75 Don Enrique', units: 184 },
  { id: 'e90da0fd-bb6e-4e4d-9015-50e0c17a1794', name: 'PH Los Alamos', units: 329 },
  { id: '4a798598-3b94-438e-9b49-bdc15985d365', name: 'PH Luxor Towers 300', units: 143 },
  { id: '33560559-1fec-47fc-9086-206817a00153', name: 'PH Torres de Castilla', units: 305 },
  { id: '16a68732-256d-49d6-ae47-adcd72225c1a', name: 'PH Firenze Tower', units: 79 },
  { id: '3429020f-c002-42c8-97d3-afd5ea2552a2', name: 'PH Plaza España', units: 71 },
  { id: '7e11008d-89da-4228-8e16-39bb24d0b37f', name: 'PH Parque Central Arraijan', units: 81 },
];

/* ─── Types ─────────────────────────────────────────────────────────────────── */
interface MoraUnit {
  unit_code: string;
  meses_mora: number;
  monto_pendiente: number;
  fase?: string;
  nota?: string;
}

interface FormData {
  building_id: string;
  periodo: string;
  cuota_mensual_total: number;
  monto_recaudado: number;
  monto_pendiente: number;
  unidades_al_dia: number;
  mora_fase_i: MoraUnit[];
  mora_fase_ii: MoraUnit[];
  mora_fase_iii: MoraUnit[];
}

interface InformeResult {
  informe: Record<string, unknown>;
  kpis: Record<string, number>;
  narrativa: string;
  mora_units: MoraUnit[];
  cpa_disclaimer: string;
  building_name: string;
}

/* ─── Helper components ────────────────────────────────────────────────────── */
function KpiCard({ label, value, sub, accent }: { label: string; value: string; sub?: string; accent?: boolean }) {
  return (
    <div style={{
      background: accent ? 'rgba(92,52,114,0.18)' : 'rgba(28,34,51,0.8)',
      border: `1px solid ${accent ? 'rgba(92,52,114,0.5)' : 'rgba(92,52,114,0.18)'}`,
      borderRadius: 12, padding: '18px 20px', minWidth: 140,
    }}>
      <div style={{ fontSize: 11, letterSpacing: '0.12em', textTransform: 'uppercase', color: 'rgba(196,98,45,0.85)', marginBottom: 6 }}>{label}</div>
      <div style={{ fontSize: 26, fontWeight: 700, color: '#F0EDE8', fontFamily: 'DM Sans, sans-serif' }}>{value}</div>
      {sub && <div style={{ fontSize: 11, color: 'rgba(240,237,232,0.45)', marginTop: 4 }}>{sub}</div>}
    </div>
  );
}

function MoraTable({ title, units, fase, color }: { title: string; units: MoraUnit[]; fase: string; color: string }) {
  if (units.length === 0) return null;
  const total = units.reduce((s, u) => s + u.monto_pendiente, 0);
  return (
    <div style={{ marginBottom: 20 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8 }}>
        <span style={{ width: 10, height: 10, borderRadius: '50%', background: color, display: 'inline-block' }} />
        <span style={{ fontSize: 12, fontWeight: 600, color, letterSpacing: '0.08em', textTransform: 'uppercase' }}>{title}</span>
        <span style={{ fontSize: 11, color: 'rgba(240,237,232,0.4)', marginLeft: 'auto' }}>
          {units.length} uds · ${total.toFixed(2)}
        </span>
      </div>
      <div style={{ background: 'rgba(28,34,51,0.6)', border: '1px solid rgba(92,52,114,0.15)', borderRadius: 8, overflow: 'hidden' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
          <thead>
            <tr style={{ borderBottom: '1px solid rgba(92,52,114,0.2)' }}>
              {['Unidad', 'Meses', 'Monto', 'Fase'].map(h => (
                <th key={h} style={{ padding: '8px 12px', textAlign: 'left', color: 'rgba(240,237,232,0.45)', fontWeight: 500, letterSpacing: '0.06em', textTransform: 'uppercase', fontSize: 10 }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {units.map((u, i) => (
              <tr key={i} style={{ borderBottom: i < units.length - 1 ? '1px solid rgba(92,52,114,0.08)' : 'none' }}>
                <td style={{ padding: '8px 12px', color: '#F0EDE8', fontWeight: 600 }}>{u.unit_code}</td>
                <td style={{ padding: '8px 12px', color: 'rgba(240,237,232,0.7)' }}>{u.meses_mora}</td>
                <td style={{ padding: '8px 12px', color: 'rgba(240,237,232,0.7)' }}>${u.monto_pendiente.toFixed(2)}</td>
                <td style={{ padding: '8px 12px' }}>
                  <span style={{ fontSize: 10, padding: '2px 8px', borderRadius: 20, background: `${color}22`, color, border: `1px solid ${color}55`, letterSpacing: '0.06em' }}>{fase}</span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

/* ─── MoraEditor: dynamic rows per fase ──────────────────────────────────────*/
function MoraEditor({ fase, units, onChange, color }: {
  fase: 'mora_fase_i' | 'mora_fase_ii' | 'mora_fase_iii';
  units: MoraUnit[];
  onChange: (units: MoraUnit[]) => void;
  color: string;
}) {
  const faseLabel = fase === 'mora_fase_i' ? 'Fase I (1–2 meses)' : fase === 'mora_fase_ii' ? 'Fase II (3–4 meses)' : 'Fase III (5+ meses)';
  const add = () => onChange([...units, { unit_code: '', meses_mora: fase === 'mora_fase_i' ? 1 : fase === 'mora_fase_ii' ? 3 : 5, monto_pendiente: 0 }]);
  const remove = (i: number) => onChange(units.filter((_, j) => j !== i));
  const update = (i: number, field: keyof MoraUnit, value: string | number) => {
    const copy = [...units];
    copy[i] = { ...copy[i], [field]: value };
    onChange(copy);
  };

  return (
    <div style={{ marginBottom: 16 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
        <span style={{ fontSize: 11, fontWeight: 600, color, letterSpacing: '0.08em', textTransform: 'uppercase' }}>
          {faseLabel} — {units.length} unidad{units.length !== 1 ? 'es' : ''}
        </span>
        <button onClick={add} style={{ fontSize: 11, color, background: `${color}15`, border: `1px solid ${color}40`, borderRadius: 6, padding: '3px 10px', cursor: 'pointer' }}>+ Agregar</button>
      </div>
      {units.map((u, i) => (
        <div key={i} style={{ display: 'grid', gridTemplateColumns: '2fr 1fr 1.5fr auto', gap: 6, marginBottom: 6 }}>
          <input
            placeholder="Ej: 10-B" value={u.unit_code}
            onChange={e => update(i, 'unit_code', e.target.value)}
            style={inputStyle}
          />
          <input
            type="number" placeholder="Meses" value={u.meses_mora}
            onChange={e => update(i, 'meses_mora', Number(e.target.value))}
            style={inputStyle}
          />
          <input
            type="number" placeholder="$0.00" value={u.monto_pendiente || ''}
            onChange={e => update(i, 'monto_pendiente', Number(e.target.value))}
            style={inputStyle}
          />
          <button onClick={() => remove(i)} style={{ background: 'rgba(196,98,45,0.1)', border: '1px solid rgba(196,98,45,0.3)', borderRadius: 6, color: '#C4622D', cursor: 'pointer', padding: '0 10px', fontSize: 14 }}>×</button>
        </div>
      ))}
    </div>
  );
}

/* ─── Shared input style ─────────────────────────────────────────────────────*/
const inputStyle: React.CSSProperties = {
  background: 'rgba(28,34,51,0.8)',
  border: '1px solid rgba(92,52,114,0.3)',
  borderRadius: 8,
  padding: '9px 12px',
  color: '#F0EDE8',
  fontSize: 13,
  width: '100%',
  boxSizing: 'border-box',
  outline: 'none',
};

const labelStyle: React.CSSProperties = {
  fontSize: 11,
  letterSpacing: '0.1em',
  textTransform: 'uppercase',
  color: 'rgba(240,237,232,0.5)',
  display: 'block',
  marginBottom: 6,
};

/* ─── Main page component ───────────────────────────────────────────────────*/
export default function BIPage() {
  const [form, setForm] = useState<FormData>({
    building_id: '',
    periodo: new Date().toISOString().slice(0, 7),
    cuota_mensual_total: 0,
    monto_recaudado: 0,
    monto_pendiente: 0,
    unidades_al_dia: 0,
    mora_fase_i: [],
    mora_fase_ii: [],
    mora_fase_iii: [],
  });
  const [loading, setLoading] = useState(false);
  const [step, setStep] = useState<string>('');
  const [result, setResult] = useState<InformeResult | null>(null);
  const [error, setError] = useState<string>('');

  const selectedBuilding = BUILDINGS.find(b => b.id === form.building_id);

  const set = (field: keyof FormData, value: unknown) =>
    setForm(prev => ({ ...prev, [field]: value }));

  const totalMoraUnits = form.mora_fase_i.length + form.mora_fase_ii.length + form.mora_fase_iii.length;

  async function generate() {
    if (!form.building_id) { setError('Selecciona un edificio'); return; }
    if (!form.periodo) { setError('Selecciona el período'); return; }
    setError('');
    setLoading(true);
    setResult(null);

    try {
      setStep('Consultando base de datos…');
      await new Promise(r => setTimeout(r, 400));
      setStep('Calculando indicadores de mora…');
      await new Promise(r => setTimeout(r, 300));
      setStep('Generando narrativa con IA…');

      const res = await fetch('/api/bi/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          building_id: form.building_id,
          periodo: form.periodo,
          generado_por: 'document-factory',
          data_input: {
            cuota_mensual_total: form.cuota_mensual_total,
            monto_recaudado: form.monto_recaudado,
            monto_pendiente: form.monto_pendiente,
            unidades_al_dia: form.unidades_al_dia || (selectedBuilding?.units ?? 0) - totalMoraUnits,
            total_unidades: selectedBuilding?.units ?? 0,
            mora_fase_i: form.mora_fase_i,
            mora_fase_ii: form.mora_fase_ii,
            mora_fase_iii: form.mora_fase_iii,
          },
        }),
      });

      setStep('Guardando informe…');
      const data = await res.json();
      if (!res.ok || data.error) throw new Error(data.error ?? 'Error del servidor');
      setResult(data);
      setStep('');
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
      if (!error) setStep('');
    }
  }

  function printInforme() {
    window.print();
  }

  const [periodo] = form.periodo ? form.periodo.split('-') : ['', ''];
  const mesNombre = form.periodo
    ? new Date(form.periodo + '-02').toLocaleDateString('es-PA', { month: 'long', year: 'numeric' })
    : '';

  return (
    <div style={{ minHeight: '100vh', background: 'var(--carbon, #1C2233)', color: '#F0EDE8', fontFamily: 'DM Sans, sans-serif' }}>

      {/* ── Header ── */}
      <div style={{ position: 'sticky', top: 44, zIndex: 100, background: 'rgba(28,34,51,0.95)', backdropFilter: 'blur(12px)', borderBottom: '1px solid rgba(92,52,114,0.2)', padding: '0 32px', height: 56, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/FPHS_logo-wt.png" alt="ForumPHs" style={{ height: 20, width: 'auto' }} />
          <span style={{ color: 'rgba(200,196,190,0.2)', fontSize: 12 }}>·</span>
          <span style={{ fontSize: 11, fontWeight: 500, letterSpacing: '0.1em', textTransform: 'uppercase', color: 'rgba(200,196,190,0.4)' }}>Informe BI</span>
        </div>
        <a href="/" style={{ fontSize: 11, color: 'rgba(200,196,190,0.4)', textDecoration: 'none', letterSpacing: '0.06em', display: 'flex', alignItems: 'center', gap: 6 }}>
          ← Actas
        </a>
      </div>

      <div style={{ maxWidth: 900, margin: '0 auto', padding: '40px 24px 120px', display: 'grid', gridTemplateColumns: result ? '1fr 1fr' : '1fr', gap: 32 }}>

        {/* ── Left: Form ── */}
        <div>
          <div style={{ marginBottom: 32 }}>
            <div style={{ fontSize: 11, letterSpacing: '0.2em', textTransform: 'uppercase', color: '#C4622D', marginBottom: 8 }}>Informe Mensual de Gestión</div>
            <h1 style={{ fontSize: 36, fontWeight: 800, color: '#F0EDE8', margin: 0, lineHeight: 1.1 }}>Módulo BI</h1>
            <p style={{ fontSize: 14, color: 'rgba(240,237,232,0.45)', marginTop: 8, fontFamily: 'EB Garamond, serif', fontStyle: 'italic' }}>
              Indicadores financieros + narrativa ejecutiva · Día 5 del mes
            </p>
          </div>

          {/* Edificio + Periodo */}
          <div style={{ background: 'rgba(28,34,51,0.6)', border: '1px solid rgba(92,52,114,0.2)', borderRadius: 14, padding: 24, marginBottom: 20 }}>
            <div style={{ fontSize: 11, letterSpacing: '0.12em', textTransform: 'uppercase', color: '#C4622D', marginBottom: 16 }}>1 · Edificio &amp; Período</div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, marginBottom: 16 }}>
              <div>
                <label style={labelStyle}>Edificio</label>
                <select value={form.building_id} onChange={e => set('building_id', e.target.value)}
                  style={{ ...inputStyle, cursor: 'pointer' }}>
                  <option value="">— Seleccionar —</option>
                  {BUILDINGS.map(b => (
                    <option key={b.id} value={b.id}>{b.name}</option>
                  ))}
                </select>
              </div>
              <div>
                <label style={labelStyle}>Período (mes)</label>
                <input type="month" value={form.periodo}
                  onChange={e => set('periodo', e.target.value)}
                  style={{ ...inputStyle, cursor: 'pointer' }} />
              </div>
            </div>
            {selectedBuilding && (
              <div style={{ fontSize: 12, color: 'rgba(240,237,232,0.4)', background: 'rgba(92,52,114,0.08)', borderRadius: 8, padding: '8px 12px' }}>
                {selectedBuilding.units} unidades inmobiliarias · {mesNombre}
              </div>
            )}
          </div>

          {/* Financiero */}
          <div style={{ background: 'rgba(28,34,51,0.6)', border: '1px solid rgba(92,52,114,0.2)', borderRadius: 14, padding: 24, marginBottom: 20 }}>
            <div style={{ fontSize: 11, letterSpacing: '0.12em', textTransform: 'uppercase', color: '#C4622D', marginBottom: 16 }}>2 · Datos Financieros</div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
              <div>
                <label style={labelStyle}>Cuota total esperada ($)</label>
                <input type="number" step="0.01" placeholder="0.00" value={form.cuota_mensual_total || ''}
                  onChange={e => set('cuota_mensual_total', Number(e.target.value))}
                  style={inputStyle} />
              </div>
              <div>
                <label style={labelStyle}>Monto recaudado ($)</label>
                <input type="number" step="0.01" placeholder="0.00" value={form.monto_recaudado || ''}
                  onChange={e => set('monto_recaudado', Number(e.target.value))}
                  style={inputStyle} />
              </div>
              <div>
                <label style={labelStyle}>Monto pendiente ($)</label>
                <input type="number" step="0.01" placeholder="0.00" value={form.monto_pendiente || ''}
                  onChange={e => set('monto_pendiente', Number(e.target.value))}
                  style={inputStyle} />
              </div>
              <div>
                <label style={labelStyle}>Unidades al día</label>
                <input type="number" placeholder="Auto" value={form.unidades_al_dia || ''}
                  onChange={e => set('unidades_al_dia', Number(e.target.value))}
                  style={inputStyle} />
                <div style={{ fontSize: 10, color: 'rgba(240,237,232,0.3)', marginTop: 4 }}>Dejar vacío = auto</div>
              </div>
            </div>
            {form.cuota_mensual_total > 0 && form.monto_recaudado > 0 && (
              <div style={{ marginTop: 14, padding: '10px 14px', background: 'rgba(92,52,114,0.1)', borderRadius: 8, fontSize: 13 }}>
                % cobro estimado: <strong style={{ color: '#EAD9F5' }}>{((form.monto_recaudado / form.cuota_mensual_total) * 100).toFixed(1)}%</strong>
              </div>
            )}
          </div>

          {/* Mora */}
          <div style={{ background: 'rgba(28,34,51,0.6)', border: '1px solid rgba(92,52,114,0.2)', borderRadius: 14, padding: 24, marginBottom: 24 }}>
            <div style={{ fontSize: 11, letterSpacing: '0.12em', textTransform: 'uppercase', color: '#C4622D', marginBottom: 4 }}>3 · Distribución de Mora</div>
            <div style={{ fontSize: 11, color: 'rgba(240,237,232,0.35)', marginBottom: 18 }}>
              Agregar unidades en mora por fase · Columnas: código, meses, monto ($)
            </div>
            <MoraEditor fase="mora_fase_i" units={form.mora_fase_i} onChange={v => set('mora_fase_i', v)} color="#EAD9F5" />
            <MoraEditor fase="mora_fase_ii" units={form.mora_fase_ii} onChange={v => set('mora_fase_ii', v)} color="#F5C07A" />
            <MoraEditor fase="mora_fase_iii" units={form.mora_fase_iii} onChange={v => set('mora_fase_iii', v)} color="#F07A7A" />
            {totalMoraUnits > 0 && (
              <div style={{ fontSize: 12, color: 'rgba(240,237,232,0.4)', marginTop: 8 }}>
                Total en mora: {totalMoraUnits} unidades · $
                {(
                  [...form.mora_fase_i, ...form.mora_fase_ii, ...form.mora_fase_iii]
                    .reduce((s, u) => s + u.monto_pendiente, 0)
                    .toFixed(2)
                )}
              </div>
            )}
          </div>

          {error && (
            <div style={{ background: 'rgba(196,98,45,0.1)', border: '1px solid rgba(196,98,45,0.4)', borderRadius: 10, padding: '12px 16px', fontSize: 13, color: '#F0A07A', marginBottom: 16 }}>
              {error}
            </div>
          )}

          <button
            onClick={generate}
            disabled={loading || !form.building_id}
            style={{
              width: '100%', padding: '14px 24px',
              background: loading ? 'rgba(92,52,114,0.3)' : 'rgba(92,52,114,0.85)',
              border: '1px solid rgba(92,52,114,0.6)',
              borderRadius: 12, color: '#F0EDE8',
              fontSize: 14, fontWeight: 600, letterSpacing: '0.06em',
              cursor: loading ? 'not-allowed' : 'pointer',
              transition: 'all 0.2s ease',
            }}
          >
            {loading ? `⏳ ${step || 'Generando…'}` : '⚡ Generar Informe BI'}
          </button>
        </div>

        {/* ── Right: Result preview ── */}
        {result && (
          <div id="bi-informe-preview">

            {/* ── Print styles ── */}
            <style>{`
              @media print {
                body > *:not(#bi-informe-preview) { display: none !important; }
                #bi-informe-preview { position: fixed; inset: 0; background: white !important; color: black !important; padding: 32px; }
                .no-print { display: none !important; }
              }
            `}</style>

            {/* Header preview */}
            <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 24 }}>
              <div>
                <div style={{ fontSize: 10, letterSpacing: '0.15em', textTransform: 'uppercase', color: '#C4622D', marginBottom: 6 }}>Informe Mensual de Gestión</div>
                <div style={{ fontSize: 20, fontWeight: 700, color: '#F0EDE8', lineHeight: 1.2 }}>{result.informe.building_name as string}</div>
                <div style={{ fontSize: 13, color: 'rgba(240,237,232,0.5)', marginTop: 4, fontFamily: 'EB Garamond, serif', fontStyle: 'italic' }}>
                  {new Date(form.periodo + '-02').toLocaleDateString('es-PA', { month: 'long', year: 'numeric' })}
                </div>
              </div>
              <button onClick={printInforme} className="no-print" style={{
                fontSize: 11, color: '#EAD9F5',
                background: 'rgba(92,52,114,0.2)', border: '1px solid rgba(92,52,114,0.4)',
                borderRadius: 8, padding: '6px 14px', cursor: 'pointer', letterSpacing: '0.06em'
              }}>
                🖨 Imprimir / PDF
              </button>
            </div>

            {/* KPI cards */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 10, marginBottom: 20 }}>
              <KpiCard label="% Cobro" value={`${(result.kpis.porcentaje_cobro ?? 0).toFixed(1)}%`} accent />
              <KpiCard label="Recaudado" value={`$${(result.kpis.monto_recaudado ?? 0).toFixed(2)}`} />
              <KpiCard label="Unidades al día" value={String(result.kpis.unidades_al_dia ?? 0)} sub={`de ${result.kpis.total_unidades ?? 0} total`} />
              <KpiCard label="En mora" value={String(result.kpis.unidades_mora ?? 0)} sub={`$${(result.kpis.monto_pendiente ?? 0).toFixed(2)} pendiente`} />
            </div>

            {/* Mora breakdown */}
            {(result.kpis.unidades_mora ?? 0) > 0 && (
              <div style={{ background: 'rgba(28,34,51,0.6)', border: '1px solid rgba(92,52,114,0.18)', borderRadius: 12, padding: 20, marginBottom: 20 }}>
                <div style={{ fontSize: 11, letterSpacing: '0.1em', textTransform: 'uppercase', color: '#C4622D', marginBottom: 16 }}>Distribución de Mora</div>
                <MoraTable title="Fase I · 1–2 meses" units={form.mora_fase_i} fase="F-I" color="#EAD9F5" />
                <MoraTable title="Fase II · 3–4 meses" units={form.mora_fase_ii} fase="F-II" color="#F5C07A" />
                <MoraTable title="Fase III · 5+ meses" units={form.mora_fase_iii} fase="F-III" color="#F07A7A" />
              </div>
            )}

            {/* Narrativa */}
            <div style={{ background: 'rgba(28,34,51,0.6)', border: '1px solid rgba(92,52,114,0.18)', borderRadius: 12, padding: 20, marginBottom: 20 }}>
              <div style={{ fontSize: 11, letterSpacing: '0.1em', textTransform: 'uppercase', color: '#C4622D', marginBottom: 14 }}>Análisis Ejecutivo</div>
              <div style={{ fontSize: 14, lineHeight: 1.75, color: 'rgba(240,237,232,0.85)', fontFamily: 'EB Garamond, serif', whiteSpace: 'pre-line' }}>
                {result.narrativa}
              </div>
            </div>

            {/* CPA disclaimer */}
            <div style={{ background: 'rgba(92,52,114,0.06)', border: '1px solid rgba(92,52,114,0.15)', borderRadius: 10, padding: '14px 18px' }}>
              <div style={{ fontSize: 10, letterSpacing: '0.1em', textTransform: 'uppercase', color: 'rgba(240,237,232,0.35)', marginBottom: 6 }}>Disclaimer CPA</div>
              <div style={{ fontSize: 11, color: 'rgba(240,237,232,0.4)', lineHeight: 1.6 }}>{result.cpa_disclaimer}</div>
            </div>

            {/* Status badge */}
            <div style={{ marginTop: 14, display: 'flex', alignItems: 'center', gap: 8, fontSize: 11, color: 'rgba(240,237,232,0.3)' }}>
              <span style={{ width: 6, height: 6, borderRadius: '50%', background: '#5C3472', display: 'inline-block' }} />
              Guardado en Supabase · Status: borrador · ID: {String(result.informe.id ?? '').slice(0, 8)}…
            </div>
          </div>
        )}
      </div>

      {/* Footer */}
      <footer style={{ position: 'fixed', bottom: 0, left: 0, right: 0, borderTop: '2px solid #00FFD1', background: '#0F0F0F', padding: '10px 32px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/FPHS_logo-wt.png" alt="ForumPHs" style={{ height: 16, width: 'auto', opacity: 0.75 }} />
          <span style={{ fontSize: 10, color: 'rgba(200,196,190,0.35)', letterSpacing: '0.04em' }}>BI Module v1.0</span>
        </div>
        <div style={{ fontSize: 10, color: 'rgba(200,196,190,0.28)', letterSpacing: '0.05em' }}>© 2026 ForumPHs · Ley 284 de 2022</div>
        <div style={{ fontSize: 10, color: 'rgba(200,196,190,0.3)', letterSpacing: '0.04em' }}>EF: fphs-bi-report · UNRLVL</div>
      </footer>
    </div>
  );
}
