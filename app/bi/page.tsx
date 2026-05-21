'use client';

import { useState, useEffect, useCallback } from 'react';

/* ─── Constants ─────────────────────────────────────────────────────────── */
const BUILDINGS = [
  { id: '2b61944c-6a14-4177-a870-7bbecea17803', name: 'Venezia Tower',          units: 182 },
  { id: 'd30e6888-1fc3-43bc-960c-94a012b753d0', name: 'PH Lefevre 75 Don Enrique', units: 184 },
  { id: 'e90da0fd-bb6e-4e4d-9015-50e0c17a1794', name: 'PH Los Alamos',           units: 329 },
  { id: '4a798598-3b94-438e-9b49-bdc15985d365', name: 'PH Luxor Towers 300',     units: 143 },
  { id: '33560559-1fec-47fc-9086-206817a00153', name: 'PH Torres de Castilla',   units: 305 },
  { id: '16a68732-256d-49d6-ae47-adcd72225c1a', name: 'PH Firenze Tower',        units: 79  },
  { id: '3429020f-c002-42c8-97d3-afd5ea2552a2', name: 'PH Plaza España',         units: 71  },
  { id: '7e11008d-89da-4228-8e16-39bb24d0b37f', name: 'PH Parque Central Arraijan', units: 81 },
];

const FASE_CONFIG = {
  AL_DIA:  { label: 'Al día',   color: '#4ADE80', bg: 'rgba(74,222,128,0.12)' },
  FASE_I:  { label: 'Fase I',   color: '#EAD9F5', bg: 'rgba(234,217,245,0.12)' },
  FASE_II: { label: 'Fase II',  color: '#F5C07A', bg: 'rgba(245,192,122,0.12)' },
  FASE_III:{ label: 'Fase III', color: '#F07A7A', bg: 'rgba(240,122,122,0.12)' },
  FASE_IV: { label: 'Fase IV',  color: '#E05050', bg: 'rgba(224,80,80,0.12)'  },
};

const STATUS_CONFIG: Record<string, { label: string; color: string; next?: string; nextLabel?: string }> = {
  borrador:      { label: 'Borrador',       color: '#9090A0', next: 'enviado_jd',    nextLabel: 'Enviar a JD →' },
  enviado_jd:    { label: 'Enviado a JD',   color: '#EAD9F5', next: 'pendiente_cpa', nextLabel: 'Enviar a CPA →' },
  pendiente_cpa: { label: 'Pendiente CPA',  color: '#F5C07A', next: 'oficial',       nextLabel: 'Marcar como Oficial →' },
  oficial:       { label: 'Oficial ✓',      color: '#4ADE80' },
};

const CPA_DISCLAIMER = 'Los estados e indicadores financieros presentados son preliminares y están sujetos a revisión y firma por la Contadora Pública Autorizada Marlene Molina, C.P.A. Nº 0488-2020.';

/* ─── Types ─────────────────────────────────────────────────────────────── */
interface KPIs {
  total_unidades: number;
  unidades_al_dia: number;
  unidades_mora: number;
  porcentaje_cobro: number;
  monto_esperado: number;
  monto_recaudado: number;
  monto_pendiente: number;
  mora_fase_i_count: number; mora_fase_i_monto: number;
  mora_fase_ii_count: number; mora_fase_ii_monto: number;
  mora_fase_iii_count: number; mora_fase_iii_monto: number;
  mora_fase_iv_count: number; mora_fase_iv_monto: number;
  mora_pct_total: number;
  recargo_mes: number;
}

interface MoraUnit { unit_code: string; meses_mora: number; monto_pendiente: number; fase: string; }
interface EeffPreliminar { id: string; status: string; created_at: string; }

interface ManualInput extends Partial<KPIs> {
  cuota_mensual_total?: number;
  mora_fase_i: MoraUnit[];
  mora_fase_ii: MoraUnit[];
  mora_fase_iii: MoraUnit[];
  mora_fase_iv: MoraUnit[];
}

/* ─── SVG Charts ────────────────────────────────────────────────────────── */
function DonutChart({ kpis }: { kpis: KPIs }) {
  const total = kpis.total_unidades || 1;
  const slices = [
    { key: 'AL_DIA',   value: kpis.unidades_al_dia },
    { key: 'FASE_I',   value: kpis.mora_fase_i_count },
    { key: 'FASE_II',  value: kpis.mora_fase_ii_count },
    { key: 'FASE_III', value: kpis.mora_fase_iii_count },
    { key: 'FASE_IV',  value: kpis.mora_fase_iv_count },
  ].filter(s => s.value > 0) as Array<{ key: keyof typeof FASE_CONFIG; value: number }>;

  const cx = 60, cy = 60, r = 48, inner = 30;
  let angle = -Math.PI / 2;
  const paths: React.ReactNode[] = [];

  slices.forEach((sl, i) => {
    const sweep = (sl.value / total) * 2 * Math.PI;
    if (sweep < 0.01) return;
    const x1 = cx + r * Math.cos(angle), y1 = cy + r * Math.sin(angle);
    const x2 = cx + r * Math.cos(angle + sweep), y2 = cy + r * Math.sin(angle + sweep);
    const ix1 = cx + inner * Math.cos(angle), iy1 = cy + inner * Math.sin(angle);
    const ix2 = cx + inner * Math.cos(angle + sweep), iy2 = cy + inner * Math.sin(angle + sweep);
    const large = sweep > Math.PI ? 1 : 0;
    paths.push(
      <path key={i}
        d={`M${ix1},${iy1} L${x1},${y1} A${r},${r} 0 ${large},1 ${x2},${y2} L${ix2},${iy2} A${inner},${inner} 0 ${large},0 ${ix1},${iy1} Z`}
        fill={FASE_CONFIG[sl.key].color} opacity={0.85} />
    );
    angle += sweep;
  });

  return (
    <svg viewBox="0 0 120 120" width={100} height={100}>
      {paths}
      <text x={cx} y={cy - 4} textAnchor="middle" fill="#F0EDE8" fontSize={14} fontWeight={700} fontFamily="DM Sans, sans-serif">
        {kpis.porcentaje_cobro?.toFixed(0)}%
      </text>
      <text x={cx} y={cy + 10} textAnchor="middle" fill="rgba(240,237,232,0.45)" fontSize={7} fontFamily="DM Sans, sans-serif">cobro</text>
    </svg>
  );
}

function CobroBar({ pct }: { pct: number }) {
  const w = Math.min(100, Math.max(0, pct));
  const color = w >= 90 ? '#4ADE80' : w >= 70 ? '#EAD9F5' : w >= 50 ? '#F5C07A' : '#F07A7A';
  return (
    <div style={{ marginBottom: 16 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, color: 'rgba(240,237,232,0.5)', marginBottom: 6 }}>
        <span>% de cobro</span><span style={{ color, fontWeight: 600 }}>{pct.toFixed(1)}%</span>
      </div>
      <div style={{ height: 6, background: 'rgba(92,52,114,0.2)', borderRadius: 3, overflow: 'hidden' }}>
        <div style={{ height: '100%', width: `${w}%`, background: color, borderRadius: 3, transition: 'width 0.6s ease' }} />
      </div>
      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 9, color: 'rgba(240,237,232,0.25)', marginTop: 3 }}>
        <span>0%</span><span>50%</span><span>100%</span>
      </div>
    </div>
  );
}

/* ─── KPI Card ───────────────────────────────────────────────────────────── */
function KpiCard({ label, value, sub, accent }: { label: string; value: string; sub?: string; accent?: boolean }) {
  return (
    <div style={{
      background: accent ? 'rgba(92,52,114,0.18)' : 'rgba(28,34,51,0.8)',
      border: `1px solid ${accent ? 'rgba(92,52,114,0.5)' : 'rgba(92,52,114,0.15)'}`,
      borderRadius: 10, padding: '14px 16px',
    }}>
      <div style={{ fontSize: 10, letterSpacing: '0.12em', textTransform: 'uppercase', color: 'rgba(196,98,45,0.85)', marginBottom: 5 }}>{label}</div>
      <div style={{ fontSize: 22, fontWeight: 700, color: '#F0EDE8', fontFamily: 'DM Sans, sans-serif', lineHeight: 1 }}>{value}</div>
      {sub && <div style={{ fontSize: 10, color: 'rgba(240,237,232,0.4)', marginTop: 4 }}>{sub}</div>}
    </div>
  );
}

/* ─── Mora Phase Row ─────────────────────────────────────────────────────── */
function FaseRow({ fase, count, monto, units }: { fase: keyof typeof FASE_CONFIG; count: number; monto: number; units?: MoraUnit[] }) {
  const [open, setOpen] = useState(false);
  const cfg = FASE_CONFIG[fase];
  if (!count) return null;
  return (
    <div style={{ marginBottom: 2 }}>
      <div
        onClick={() => units?.length ? setOpen(o => !o) : undefined}
        style={{
          display: 'flex', alignItems: 'center', gap: 10,
          padding: '8px 12px', background: cfg.bg,
          border: `1px solid ${cfg.color}30`,
          borderRadius: open ? '8px 8px 0 0' : 8,
          cursor: units?.length ? 'pointer' : 'default',
        }}>
        <span style={{ width: 8, height: 8, borderRadius: '50%', background: cfg.color, flexShrink: 0 }} />
        <span style={{ fontSize: 12, fontWeight: 600, color: cfg.color, flex: 1 }}>{cfg.label}</span>
        <span style={{ fontSize: 12, color: 'rgba(240,237,232,0.6)' }}>{count} uds</span>
        <span style={{ fontSize: 12, color: 'rgba(240,237,232,0.5)', minWidth: 80, textAlign: 'right' }}>
          ${monto.toFixed(2)}
        </span>
        {units?.length ? <span style={{ fontSize: 10, color: 'rgba(240,237,232,0.3)' }}>{open ? '▲' : '▼'}</span> : null}
      </div>
      {open && units && units.length > 0 && (
        <div style={{ border: `1px solid ${cfg.color}20`, borderTop: 'none', borderRadius: '0 0 8px 8px', overflow: 'hidden' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 11 }}>
            <thead>
              <tr style={{ background: 'rgba(14,16,24,0.5)' }}>
                {['Unidad', 'Meses', 'Pendiente'].map(h => (
                  <th key={h} style={{ padding: '6px 10px', textAlign: 'left', color: 'rgba(240,237,232,0.4)', fontWeight: 500, letterSpacing: '0.06em', fontSize: 9, textTransform: 'uppercase' }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {units.map((u, i) => (
                <tr key={i} style={{ borderTop: '1px solid rgba(92,52,114,0.08)' }}>
                  <td style={{ padding: '6px 10px', color: '#F0EDE8', fontWeight: 600 }}>{u.unit_code}</td>
                  <td style={{ padding: '6px 10px', color: 'rgba(240,237,232,0.6)' }}>{u.meses_mora}</td>
                  <td style={{ padding: '6px 10px', color: 'rgba(240,237,232,0.6)' }}>${u.monto_pendiente.toFixed(2)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

/* ─── EEFF Status Bar ────────────────────────────────────────────────────── */
function EeffStatusBar({ eeff, onStatusChange }: { eeff: EeffPreliminar; onStatusChange: (id: string, status: string) => void }) {
  const cfg = STATUS_CONFIG[eeff.status] ?? STATUS_CONFIG.borrador;
  const steps = ['borrador', 'enviado_jd', 'pendiente_cpa', 'oficial'];
  const currentIdx = steps.indexOf(eeff.status);

  return (
    <div style={{ background: 'rgba(28,34,51,0.8)', border: '1px solid rgba(92,52,114,0.2)', borderRadius: 10, padding: '14px 18px', marginBottom: 16 }}>
      <div style={{ fontSize: 10, letterSpacing: '0.12em', textTransform: 'uppercase', color: 'rgba(196,98,45,0.8)', marginBottom: 12 }}>Estado EEFF Preliminar</div>

      {/* Step indicators */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 0, marginBottom: 14 }}>
        {steps.map((s, i) => {
          const scfg = STATUS_CONFIG[s];
          const done = i < currentIdx;
          const active = i === currentIdx;
          return (
            <div key={s} style={{ display: 'flex', alignItems: 'center', flex: i < steps.length - 1 ? 1 : 'none' }}>
              <div style={{
                width: 20, height: 20, borderRadius: '50%', flexShrink: 0,
                background: done ? '#4ADE80' : active ? scfg.color : 'rgba(92,52,114,0.2)',
                border: `2px solid ${done ? '#4ADE80' : active ? scfg.color : 'rgba(92,52,114,0.3)'}`,
                display: 'flex', alignItems: 'center', justifyContent: 'center',
              }}>
                {done && <span style={{ fontSize: 10, color: '#0E1018' }}>✓</span>}
              </div>
              <div style={{ fontSize: 9, color: active ? scfg.color : done ? '#4ADE80' : 'rgba(240,237,232,0.3)', marginLeft: 4, marginRight: 8, whiteSpace: 'nowrap' }}>
                {scfg.label.replace(' ✓', '')}
              </div>
              {i < steps.length - 1 && (
                <div style={{ flex: 1, height: 1, background: done ? '#4ADE80' : 'rgba(92,52,114,0.2)', marginRight: 8 }} />
              )}
            </div>
          );
        })}
      </div>

      {eeff.status !== 'oficial' && cfg.next && (
        <button
          onClick={() => onStatusChange(eeff.id, cfg.next!)}
          style={{
            fontSize: 11, fontWeight: 600, letterSpacing: '0.06em',
            padding: '7px 16px', borderRadius: 7, cursor: 'pointer',
            background: 'rgba(92,52,114,0.25)', border: '1px solid rgba(92,52,114,0.5)',
            color: '#EAD9F5',
          }}>
          {cfg.nextLabel}
        </button>
      )}

      {eeff.status !== 'oficial' && (
        <div style={{ marginTop: 10, fontSize: 10, color: 'rgba(240,237,232,0.35)', lineHeight: 1.6, fontStyle: 'italic' }}>
          {CPA_DISCLAIMER}
        </div>
      )}
    </div>
  );
}

/* ─── Manual Mora Editor ────────────────────────────────────────────────── */
const IS = { background: 'rgba(28,34,51,0.8)', border: '1px solid rgba(92,52,114,0.3)', borderRadius: 8, padding: '8px 12px', color: '#F0EDE8', fontSize: 13, width: '100%', boxSizing: 'border-box' as const, outline: 'none' };

function MoraEditor({ fase, units, onChange, color, label }: {
  fase: string; units: MoraUnit[]; onChange: (u: MoraUnit[]) => void; color: string; label: string;
}) {
  const add = () => onChange([...units, { unit_code: '', meses_mora: 1, monto_pendiente: 0, fase }]);
  const remove = (i: number) => onChange(units.filter((_, j) => j !== i));
  const upd = (i: number, f: keyof MoraUnit, v: string | number) => {
    const c = [...units]; c[i] = { ...c[i], [f]: v }; onChange(c);
  };
  return (
    <div style={{ marginBottom: 12 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}>
        <span style={{ fontSize: 11, fontWeight: 600, color, letterSpacing: '0.06em', textTransform: 'uppercase' }}>
          {label} — {units.length} uds
        </span>
        <button onClick={add} style={{ fontSize: 11, color, background: `${color}15`, border: `1px solid ${color}40`, borderRadius: 6, padding: '2px 10px', cursor: 'pointer' }}>+ Agregar</button>
      </div>
      {units.map((u, i) => (
        <div key={i} style={{ display: 'grid', gridTemplateColumns: '2fr 1fr 1.5fr auto', gap: 5, marginBottom: 5 }}>
          <input placeholder="Código" value={u.unit_code} onChange={e => upd(i, 'unit_code', e.target.value)} style={IS} />
          <input type="number" placeholder="Meses" value={u.meses_mora || ''} onChange={e => upd(i, 'meses_mora', Number(e.target.value))} style={IS} />
          <input type="number" placeholder="$0.00" value={u.monto_pendiente || ''} onChange={e => upd(i, 'monto_pendiente', Number(e.target.value))} style={IS} />
          <button onClick={() => remove(i)} style={{ background: 'rgba(196,98,45,0.1)', border: '1px solid rgba(196,98,45,0.3)', borderRadius: 6, color: '#C4622D', cursor: 'pointer', padding: '0 10px', fontSize: 14 }}>×</button>
        </div>
      ))}
    </div>
  );
}

/* ─── Main page ─────────────────────────────────────────────────────────── */
export default function BIPage() {
  const [buildingId, setBuildingId] = useState('');
  const [periodo, setPeriodo] = useState(new Date().toISOString().slice(0, 7));
  const [mode, setMode] = useState<'auto' | 'manual'>('auto');
  const [autoKpis, setAutoKpis] = useState<KPIs | null>(null);
  const [autoMora, setAutoMora] = useState<MoraUnit[]>([]);
  const [eeffPreliminar, setEeffPreliminar] = useState<EeffPreliminar | null>(null);
  const [loading, setLoading] = useState(false);
  const [fetching, setFetching] = useState(false);
  const [step, setStep] = useState('');
  const [result, setResult] = useState<{ kpis: KPIs; narrativa: string; informe: { id: string; building_name: string }; cpa_disclaimer: string } | null>(null);
  const [error, setError] = useState('');

  const [manual, setManual] = useState<ManualInput>({
    cuota_mensual_total: 0, monto_recaudado: 0, monto_pendiente: 0,
    unidades_al_dia: 0, total_unidades: 0,
    mora_fase_i: [], mora_fase_ii: [], mora_fase_iii: [], mora_fase_iv: [],
  });

  const building = BUILDINGS.find(b => b.id === buildingId);
  const mesNombre = periodo ? new Date(periodo + '-02').toLocaleDateString('es-PA', { month: 'long', year: 'numeric' }) : '';

  // Fetch auto data when building + period change
  const fetchAutoData = useCallback(async () => {
    if (!buildingId || !periodo) return;
    setFetching(true);
    try {
      const r = await fetch(`/api/bi/data?building_id=${buildingId}&period=${periodo}`);
      const d = await r.json();
      if (d.has_auto_data && d.kpis) {
        setAutoKpis(d.kpis as KPIs);
        setAutoMora(d.mora_detail ?? []);
        setMode('auto');
      } else {
        setAutoKpis(null);
        setAutoMora([]);
        setMode('manual');
      }
      if (d.eeff_preliminar) setEeffPreliminar(d.eeff_preliminar);
    } catch { setMode('manual'); }
    finally { setFetching(false); }
  }, [buildingId, periodo]);

  useEffect(() => { fetchAutoData(); }, [fetchAutoData]);

  async function generate() {
    if (!buildingId) { setError('Selecciona un edificio'); return; }
    setError(''); setLoading(true); setResult(null);
    try {
      setStep('Consolidando datos…');
      await new Promise(r => setTimeout(r, 300));
      setStep('Generando narrativa con IA…');

      const kpisToSend = mode === 'auto' && autoKpis ? autoKpis : {
        total_unidades: manual.total_unidades ?? building?.units ?? 0,
        unidades_al_dia: manual.unidades_al_dia ?? 0,
        unidades_mora: (manual.mora_fase_i?.length ?? 0) + (manual.mora_fase_ii?.length ?? 0) + (manual.mora_fase_iii?.length ?? 0) + (manual.mora_fase_iv?.length ?? 0),
        monto_recaudado: manual.monto_recaudado ?? 0,
        monto_pendiente: manual.monto_pendiente ?? 0,
        porcentaje_cobro: (manual.cuota_mensual_total ?? 0) > 0 ? ((manual.monto_recaudado ?? 0) / (manual.cuota_mensual_total ?? 1)) * 100 : 0,
        mora_fase_i_count: manual.mora_fase_i?.length ?? 0,
        mora_fase_ii_count: manual.mora_fase_ii?.length ?? 0,
        mora_fase_iii_count: manual.mora_fase_iii?.length ?? 0,
        mora_fase_iv_count: manual.mora_fase_iv?.length ?? 0,
        mora_fase_i_monto: manual.mora_fase_i?.reduce((s, u) => s + u.monto_pendiente, 0) ?? 0,
        mora_fase_ii_monto: manual.mora_fase_ii?.reduce((s, u) => s + u.monto_pendiente, 0) ?? 0,
        mora_fase_iii_monto: manual.mora_fase_iii?.reduce((s, u) => s + u.monto_pendiente, 0) ?? 0,
        mora_fase_iv_monto: manual.mora_fase_iv?.reduce((s, u) => s + u.monto_pendiente, 0) ?? 0,
        mora_pct_total: 0,
        recargo_mes: 0,
        monto_esperado: manual.cuota_mensual_total ?? 0,
      };

      const allMoraUnits = mode === 'auto' ? autoMora : [
        ...(manual.mora_fase_i ?? []),
        ...(manual.mora_fase_ii ?? []),
        ...(manual.mora_fase_iii ?? []),
        ...(manual.mora_fase_iv ?? []),
      ];

      const res = await fetch('/api/bi/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          building_id: buildingId,
          periodo,
          generado_por: 'document-factory-v2',
          data_input: {
            ...kpisToSend,
            cuota_mensual_total: mode === 'manual' ? (manual.cuota_mensual_total ?? 0) : (kpisToSend.monto_esperado ?? 0),
            mora_fase_i:   allMoraUnits.filter(u => u.fase === 'FASE_I'),
            mora_fase_ii:  allMoraUnits.filter(u => u.fase === 'FASE_II'),
            mora_fase_iii: allMoraUnits.filter(u => u.fase === 'FASE_III'),
            mora_fase_iv:  allMoraUnits.filter(u => u.fase === 'FASE_IV'),
          },
        }),
      });

      setStep('Guardando informe…');
      const data = await res.json();
      if (!res.ok || data.error) throw new Error(data.error ?? 'Error del servidor');

      setResult({ kpis: data.kpis, narrativa: data.narrativa, informe: { id: data.informe?.id, building_name: data.informe?.building_name ?? building?.name ?? '' }, cpa_disclaimer: data.cpa_disclaimer });
      if (!eeffPreliminar) {
        setEeffPreliminar({ id: data.informe?.id, status: 'borrador', created_at: new Date().toISOString() });
      }
      setStep('');
    } catch (e) { setError(String(e)); }
    finally { setLoading(false); }
  }

  async function handleStatusChange(id: string, status: string) {
    try {
      const r = await fetch('/api/bi/status', {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id, status }),
      });
      const d = await r.json();
      if (d.eeff_preliminar) setEeffPreliminar(d.eeff_preliminar);
    } catch (e) { setError(String(e)); }
  }

  const displayKpis: KPIs | null = result?.kpis ?? (mode === 'auto' ? autoKpis : null);
  const displayMora: MoraUnit[] = mode === 'auto' ? autoMora : [
    ...(manual.mora_fase_i ?? []).map(u => ({ ...u, fase: 'FASE_I' })),
    ...(manual.mora_fase_ii ?? []).map(u => ({ ...u, fase: 'FASE_II' })),
    ...(manual.mora_fase_iii ?? []).map(u => ({ ...u, fase: 'FASE_III' })),
    ...(manual.mora_fase_iv ?? []).map(u => ({ ...u, fase: 'FASE_IV' })),
  ];

  return (
    <div style={{ minHeight: '100vh', background: 'var(--carbon, #1C2233)', color: '#F0EDE8', fontFamily: 'DM Sans, sans-serif' }}>

      {/* Header */}
      <div style={{ position: 'sticky', top: 44, zIndex: 100, background: 'rgba(28,34,51,0.97)', backdropFilter: 'blur(12px)', borderBottom: '1px solid rgba(92,52,114,0.2)', padding: '0 28px', height: 52, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/FPHS_logo-wt.png" alt="ForumPHs" style={{ height: 18, width: 'auto' }} />
          <span style={{ color: 'rgba(200,196,190,0.2)', fontSize: 11 }}>·</span>
          <span style={{ fontFamily: 'DM Sans, sans-serif', fontSize: 11, fontWeight: 500, letterSpacing: '0.1em', textTransform: 'uppercase' as const, color: 'rgba(200,196,190,0.4)' }}>
            Informe BI
          </span>
          {fetching && <span style={{ fontSize: 10, color: 'rgba(92,52,114,0.7)', letterSpacing: '0.06em' }}>· cargando datos…</span>}
        </div>
        {mode === 'auto' && autoKpis && (
          <span style={{ fontSize: 10, padding: '3px 10px', borderRadius: 20, background: 'rgba(74,222,128,0.1)', border: '1px solid rgba(74,222,128,0.3)', color: '#4ADE80', letterSpacing: '0.06em' }}>
            ● Datos automáticos
          </span>
        )}
        {mode === 'manual' && !fetching && (
          <span style={{ fontSize: 10, padding: '3px 10px', borderRadius: 20, background: 'rgba(245,192,122,0.1)', border: '1px solid rgba(245,192,122,0.3)', color: '#F5C07A', letterSpacing: '0.06em' }}>
            ✎ Entrada manual
          </span>
        )}
      </div>

      <div style={{ maxWidth: 960, margin: '0 auto', padding: '32px 24px 120px', display: 'grid', gridTemplateColumns: result ? '380px 1fr' : '1fr', gap: 28 }}>

        {/* ── FORM ── */}
        <div>
          <div style={{ marginBottom: 28 }}>
            <div style={{ fontSize: 10, letterSpacing: '0.2em', textTransform: 'uppercase', color: '#C4622D', marginBottom: 6 }}>Informe Mensual de Gestión</div>
            <h1 style={{ fontSize: 32, fontWeight: 800, color: '#F0EDE8', margin: 0, lineHeight: 1.1 }}>Módulo BI</h1>
            <p style={{ fontSize: 13, color: 'rgba(240,237,232,0.4)', marginTop: 6, fontFamily: 'EB Garamond, serif', fontStyle: 'italic' }}>
              Indicadores financieros + narrativa ejecutiva · Día 5 del mes
            </p>
          </div>

          {/* Edificio + Periodo */}
          <div style={{ background: 'rgba(28,34,51,0.6)', border: '1px solid rgba(92,52,114,0.2)', borderRadius: 12, padding: 20, marginBottom: 16 }}>
            <div style={{ fontSize: 10, letterSpacing: '0.12em', textTransform: 'uppercase', color: '#C4622D', marginBottom: 14 }}>1 · Edificio & Período</div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 12 }}>
              <div>
                <label style={{ fontSize: 10, letterSpacing: '0.1em', textTransform: 'uppercase', color: 'rgba(240,237,232,0.45)', display: 'block', marginBottom: 5 }}>Edificio</label>
                <select value={buildingId} onChange={e => setBuildingId(e.target.value)} style={{ ...IS, cursor: 'pointer' }}>
                  <option value="">— Seleccionar —</option>
                  {BUILDINGS.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}
                </select>
              </div>
              <div>
                <label style={{ fontSize: 10, letterSpacing: '0.1em', textTransform: 'uppercase', color: 'rgba(240,237,232,0.45)', display: 'block', marginBottom: 5 }}>Período</label>
                <input type="month" value={periodo} onChange={e => setPeriodo(e.target.value)} style={{ ...IS, cursor: 'pointer' }} />
              </div>
            </div>
            {building && (
              <div style={{ fontSize: 11, color: 'rgba(240,237,232,0.4)', background: 'rgba(92,52,114,0.08)', borderRadius: 7, padding: '7px 10px' }}>
                {building.units} unidades · {mesNombre}
                {autoKpis && <span style={{ marginLeft: 8, color: '#4ADE80' }}>· Datos disponibles en Supabase</span>}
              </div>
            )}
          </div>

          {/* Manual input — only shown when no auto data */}
          {mode === 'manual' && !fetching && (
            <>
              <div style={{ background: 'rgba(28,34,51,0.6)', border: '1px solid rgba(92,52,114,0.2)', borderRadius: 12, padding: 20, marginBottom: 16 }}>
                <div style={{ fontSize: 10, letterSpacing: '0.12em', textTransform: 'uppercase', color: '#C4622D', marginBottom: 14 }}>2 · Datos Financieros</div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                  {[
                    { label: 'Cuota total esperada ($)', key: 'cuota_mensual_total' },
                    { label: 'Monto recaudado ($)',      key: 'monto_recaudado' },
                    { label: 'Monto pendiente ($)',      key: 'monto_pendiente' },
                    { label: 'Unidades al día',          key: 'unidades_al_dia' },
                  ].map(f => (
                    <div key={f.key}>
                      <label style={{ fontSize: 10, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'rgba(240,237,232,0.4)', display: 'block', marginBottom: 4 }}>{f.label}</label>
                      <input type="number" step="0.01" placeholder="0.00"
                        value={(manual[f.key as keyof ManualInput] as number) || ''}
                        onChange={e => setManual(p => ({ ...p, [f.key]: Number(e.target.value) }))}
                        style={IS} />
                    </div>
                  ))}
                </div>
              </div>

              <div style={{ background: 'rgba(28,34,51,0.6)', border: '1px solid rgba(92,52,114,0.2)', borderRadius: 12, padding: 20, marginBottom: 16 }}>
                <div style={{ fontSize: 10, letterSpacing: '0.12em', textTransform: 'uppercase', color: '#C4622D', marginBottom: 4 }}>3 · Distribución de Mora</div>
                <div style={{ fontSize: 10, color: 'rgba(240,237,232,0.3)', marginBottom: 14 }}>Código · Meses · Monto pendiente ($)</div>
                <MoraEditor fase="FASE_I"   label="Fase I — 1-2 meses"   units={manual.mora_fase_i ?? []}   onChange={v => setManual(p => ({ ...p, mora_fase_i: v }))}   color={FASE_CONFIG.FASE_I.color} />
                <MoraEditor fase="FASE_II"  label="Fase II — 3-4 meses"  units={manual.mora_fase_ii ?? []}  onChange={v => setManual(p => ({ ...p, mora_fase_ii: v }))}  color={FASE_CONFIG.FASE_II.color} />
                <MoraEditor fase="FASE_III" label="Fase III — 5-6 meses" units={manual.mora_fase_iii ?? []} onChange={v => setManual(p => ({ ...p, mora_fase_iii: v }))} color={FASE_CONFIG.FASE_III.color} />
                <MoraEditor fase="FASE_IV"  label="Fase IV — 7+ meses"   units={manual.mora_fase_iv ?? []}  onChange={v => setManual(p => ({ ...p, mora_fase_iv: v }))}  color={FASE_CONFIG.FASE_IV.color} />
              </div>
            </>
          )}

          {/* Auto mode summary */}
          {mode === 'auto' && autoKpis && (
            <div style={{ background: 'rgba(74,222,128,0.05)', border: '1px solid rgba(74,222,128,0.2)', borderRadius: 12, padding: '12px 16px', marginBottom: 16 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <div style={{ fontSize: 11, color: '#4ADE80' }}>Datos cargados desde Supabase</div>
                <button onClick={() => setMode('manual')} style={{ fontSize: 10, color: 'rgba(240,237,232,0.4)', background: 'transparent', border: '1px solid rgba(240,237,232,0.15)', borderRadius: 6, padding: '3px 10px', cursor: 'pointer' }}>
                  Editar manualmente
                </button>
              </div>
              <div style={{ fontSize: 11, color: 'rgba(240,237,232,0.5)', marginTop: 4 }}>
                {autoKpis.unidades_al_dia} al día · {autoKpis.unidades_mora} en mora · {autoKpis.porcentaje_cobro?.toFixed(1)}% cobro
              </div>
            </div>
          )}

          {error && (
            <div style={{ background: 'rgba(196,98,45,0.1)', border: '1px solid rgba(196,98,45,0.4)', borderRadius: 9, padding: '10px 14px', fontSize: 12, color: '#F0A07A', marginBottom: 14 }}>
              {error}
            </div>
          )}

          <button onClick={generate} disabled={loading || !buildingId}
            style={{ width: '100%', padding: '13px 24px', background: loading ? 'rgba(92,52,114,0.3)' : 'rgba(92,52,114,0.85)', border: '1px solid rgba(92,52,114,0.6)', borderRadius: 10, color: '#F0EDE8', fontSize: 14, fontWeight: 600, letterSpacing: '0.06em', cursor: loading ? 'not-allowed' : 'pointer', transition: 'all 0.2s' }}>
            {loading ? `⏳ ${step || 'Generando…'}` : '⚡ Generar Informe BI'}
          </button>
        </div>

        {/* ── RESULT ── */}
        {(result || displayKpis) && (
          <div>
            <style>{`@media print { body > *:not(#bi-result) { display:none!important } #bi-result { position:fixed;inset:0;background:white!important;color:#1A1612!important;padding:32px;overflow:auto } .no-print{display:none!important} }`}</style>

            <div id="bi-result">
              {/* Result header */}
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 20 }}>
                <div>
                  <div style={{ fontSize: 9, letterSpacing: '0.14em', textTransform: 'uppercase', color: '#C4622D', marginBottom: 5 }}>Informe Mensual de Gestión</div>
                  <div style={{ fontSize: 18, fontWeight: 700, color: '#F0EDE8', lineHeight: 1.2 }}>
                    {result?.informe.building_name ?? building?.name}
                  </div>
                  <div style={{ fontSize: 12, color: 'rgba(240,237,232,0.45)', marginTop: 3, fontFamily: 'EB Garamond, serif', fontStyle: 'italic' }}>{mesNombre}</div>
                </div>
                <button onClick={() => window.print()} className="no-print"
                  style={{ fontSize: 10, color: '#EAD9F5', background: 'rgba(92,52,114,0.2)', border: '1px solid rgba(92,52,114,0.4)', borderRadius: 7, padding: '5px 12px', cursor: 'pointer' }}>
                  🖨 PDF
                </button>
              </div>

              {/* EEFF status */}
              {eeffPreliminar && result && (
                <EeffStatusBar eeff={eeffPreliminar} onStatusChange={handleStatusChange} />
              )}

              {/* Charts row */}
              {displayKpis && (
                <div style={{ display: 'flex', gap: 16, marginBottom: 16, alignItems: 'center' }}>
                  <div style={{ background: 'rgba(28,34,51,0.6)', border: '1px solid rgba(92,52,114,0.15)', borderRadius: 10, padding: '12px 16px', display: 'flex', alignItems: 'center', gap: 12 }}>
                    <DonutChart kpis={displayKpis} />
                    <div>
                      <div style={{ fontSize: 9, letterSpacing: '0.1em', textTransform: 'uppercase', color: 'rgba(196,98,45,0.7)', marginBottom: 8 }}>Distribución</div>
                      {(Object.keys(FASE_CONFIG) as Array<keyof typeof FASE_CONFIG>).map(k => {
                        const countMap: Record<string, number> = { AL_DIA: displayKpis.unidades_al_dia, FASE_I: displayKpis.mora_fase_i_count, FASE_II: displayKpis.mora_fase_ii_count, FASE_III: displayKpis.mora_fase_iii_count, FASE_IV: displayKpis.mora_fase_iv_count };
                        const c = countMap[k] ?? 0;
                        if (!c) return null;
                        return (
                          <div key={k} style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 3 }}>
                            <span style={{ width: 8, height: 8, borderRadius: 2, background: FASE_CONFIG[k].color, flexShrink: 0 }} />
                            <span style={{ fontSize: 10, color: FASE_CONFIG[k].color }}>{FASE_CONFIG[k].label}</span>
                            <span style={{ fontSize: 10, color: 'rgba(240,237,232,0.4)', marginLeft: 4 }}>{c}</span>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                  <div style={{ flex: 1 }}>
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginBottom: 12 }}>
                      <KpiCard label="Recaudado" value={`$${(displayKpis.monto_recaudado ?? 0).toFixed(0)}`} accent />
                      <KpiCard label="Pendiente" value={`$${(displayKpis.monto_pendiente ?? 0).toFixed(0)}`} />
                      <KpiCard label="Al día" value={String(displayKpis.unidades_al_dia ?? 0)} sub={`de ${displayKpis.total_unidades ?? 0} uds`} />
                      <KpiCard label="En mora" value={String(displayKpis.unidades_mora ?? 0)} />
                    </div>
                    <CobroBar pct={displayKpis.porcentaje_cobro ?? 0} />
                  </div>
                </div>
              )}

              {/* Mora phases */}
              {displayKpis && displayKpis.unidades_mora > 0 && (
                <div style={{ background: 'rgba(28,34,51,0.6)', border: '1px solid rgba(92,52,114,0.15)', borderRadius: 10, padding: 16, marginBottom: 16 }}>
                  <div style={{ fontSize: 10, letterSpacing: '0.1em', textTransform: 'uppercase', color: '#C4622D', marginBottom: 12 }}>Distribución de Mora</div>
                  {(['FASE_I','FASE_II','FASE_III','FASE_IV'] as const).map(f => {
                    const countMap = { FASE_I: displayKpis.mora_fase_i_count, FASE_II: displayKpis.mora_fase_ii_count, FASE_III: displayKpis.mora_fase_iii_count, FASE_IV: displayKpis.mora_fase_iv_count };
                    const montoMap = { FASE_I: displayKpis.mora_fase_i_monto, FASE_II: displayKpis.mora_fase_ii_monto, FASE_III: displayKpis.mora_fase_iii_monto, FASE_IV: displayKpis.mora_fase_iv_monto };
                    return <FaseRow key={f} fase={f} count={countMap[f] ?? 0} monto={montoMap[f] ?? 0} units={displayMora.filter(u => u.fase === f)} />;
                  })}
                </div>
              )}

              {/* Narrativa */}
              {result && (
                <div style={{ background: 'rgba(28,34,51,0.6)', border: '1px solid rgba(92,52,114,0.15)', borderRadius: 10, padding: 18, marginBottom: 14 }}>
                  <div style={{ fontSize: 10, letterSpacing: '0.1em', textTransform: 'uppercase', color: '#C4622D', marginBottom: 12 }}>Análisis Ejecutivo</div>
                  <div style={{ fontSize: 13, lineHeight: 1.8, color: 'rgba(240,237,232,0.82)', fontFamily: 'EB Garamond, serif', whiteSpace: 'pre-line' }}>
                    {result.narrativa}
                  </div>
                </div>
              )}

              {/* CPA disclaimer — only if not oficial */}
              {(!eeffPreliminar || eeffPreliminar.status !== 'oficial') && (
                <div style={{ background: 'rgba(92,52,114,0.05)', border: '1px solid rgba(92,52,114,0.15)', borderRadius: 9, padding: '12px 16px' }}>
                  <div style={{ fontSize: 9, letterSpacing: '0.1em', textTransform: 'uppercase', color: 'rgba(240,237,232,0.3)', marginBottom: 5 }}>Disclaimer CPA</div>
                  <div style={{ fontSize: 10, color: 'rgba(240,237,232,0.38)', lineHeight: 1.7 }}>{CPA_DISCLAIMER}</div>
                </div>
              )}
            </div>
          </div>
        )}
      </div>

      <footer style={{ position: 'fixed', bottom: 0, left: 0, right: 0, borderTop: '2px solid #00FFD1', background: '#0F0F0F', padding: '8px 28px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <img src="/FPHS_logo-wt.png" alt="ForumPHs" style={{ height: 14, width: 'auto', opacity: 0.6 }} />
          <span style={{ fontSize: 9, color: 'rgba(200,196,190,0.3)', letterSpacing: '0.04em' }}>BI v2.0</span>
        </div>
        <div style={{ fontSize: 9, color: 'rgba(200,196,190,0.22)', letterSpacing: '0.04em' }}>© 2026 ForumPHs · Ley 284 de 2022</div>
        <div style={{ fontSize: 9, color: 'rgba(200,196,190,0.25)', letterSpacing: '0.04em' }}>fphs-bi-report · fphs-bi-data · fphs-bi-status</div>
      </footer>
    </div>
  );
}
