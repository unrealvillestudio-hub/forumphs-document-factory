// ── FIE HTML Template · 7 Paneles + Simulador
// ForumPHs · Document Factory · 2026-05-22
// Output: archivo HTML autónomo · Chart.js 4.4.0 CDN · sin dependencias adicionales

import type { FIESchema } from './schema'

// ─── HELPERS ────────────────────────────────────────────────────
const fmt$ = (n: number) =>
  '$' + n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

const fmtK = (n: number) =>
  n >= 1000 ? '$' + (n / 1000).toFixed(1) + 'k' : fmt$(n)

const fmtPct = (n: number) => n.toFixed(1) + '%'

const pctColor = (p: number) =>
  p >= 20 ? '#4ADE80' : p >= 10 ? '#FBBF24' : p >= 0 ? '#E8855A' : '#C4622D'

// ─── COST LABELS ───────────────────────────────────────────────
const COST_LABELS: Record<string, string> = {
  salarios:   'Planilla y Salarios',
  css:        'Cuota Obrero-Patronal (CSS)',
  honorarios: 'Honorarios Profesionales',
  viaticos:   'Viáticos y Movilización',
  servicios:  'Honorarios de Servicios',
  stack:      'Stack Tecnológico',
  otros:      'Otros Gastos',
}

// ─── SIMULADOR JS (embebido en el HTML) ─────────────────────────
function simuladorScript(schema: FIESchema): string {
  const {
    base_income, base_ops, cost_per_new_ph,
    labor_res_monthly, contingency_monthly, historic_liability,
  } = schema

  return `
<script>
(function() {
  // ── Constantes ──────────────────────────────────────────────
  const BASE_INCOME    = ${base_income};
  const BASE_OPS       = ${base_ops};
  const COST_PER_PH    = ${cost_per_new_ph};
  const LABOR_RES      = ${labor_res_monthly};
  const CONTINGENCY    = ${contingency_monthly};
  const HISTORIC_LIAB  = ${historic_liability};
  const MONTHS         = 180;

  // ── Simulación ──────────────────────────────────────────────
  function simulate(newPHs, phFee, phMonth, liabMonths, capPct, invPct) {
    let liab    = HISTORIC_LIAB;
    let capFund = 0;
    let invFund = 0;
    const liabPayment = HISTORIC_LIAB / liabMonths;
    const monthly     = [];

    let liabClearedM = null, cap50kM = null, inv50kM = null;

    for (let m = 0; m < MONTHS; m++) {
      const extraInc = m >= phMonth - 1 ? newPHs * phFee         : 0;
      const extraOps = m >= phMonth - 1 ? newPHs * COST_PER_PH   : 0;
      const income   = BASE_INCOME + extraInc;
      const ops      = BASE_OPS    + extraOps;
      const surplus  = income - ops - LABOR_RES - CONTINGENCY;

      // Pasivo laboral
      if (liab > 0) {
        liab = Math.max(0, liab - liabPayment);
        if (liab === 0 && liabClearedM === null) liabClearedM = m;
      }

      // Fondos
      if (surplus > 0 && liab === 0) {
        capFund += surplus * (capPct / 100);
        invFund += surplus * (invPct / 100);
      } else if (surplus > 0) {
        // Mientras hay pasivo, solo acumulamos una pequeña parte
        capFund += surplus * (capPct / 100) * 0.3;
      }

      if (capFund >= 50000 && cap50kM === null) cap50kM = m;
      if (invFund >= 50000 && inv50kM === null) inv50kM = m;

      monthly.push({
        m, income, ops,
        utilidad: income - ops,
        cap: capFund, inv: invFund,
        total: capFund + invFund,
        liab,
      });
    }

    return { monthly, liabClearedM, cap50kM, inv50kM };
  }

  // ── Formato de fecha desde mes ordinal ─────────────────────
  function monthLabel(m) {
    if (m === null) return '—';
    const baseYear  = 2026;
    const baseMon   = 2; // Marzo = mes 0
    const totalMon  = baseMon + m;
    const y         = baseYear + Math.floor(totalMon / 12);
    const mo        = totalMon % 12;
    const names     = ['Ene','Feb','Mar','Abr','May','Jun','Jul','Ago','Sep','Oct','Nov','Dic'];
    return names[mo] + ' ' + y;
  }

  // ── Chart.js instance ───────────────────────────────────────
  let chart = null;

  function updateChart(monthly) {
    const labels = monthly.filter((_, i) => i % 6 === 0).map(r => monthLabel(r.m));
    const capData = monthly.filter((_, i) => i % 6 === 0).map(r => Math.round(r.cap));
    const invData = monthly.filter((_, i) => i % 6 === 0).map(r => Math.round(r.inv));
    const liabData = monthly.filter((_, i) => i % 6 === 0).map(r => Math.round(r.liab));

    if (chart) {
      chart.data.labels             = labels;
      chart.data.datasets[0].data   = capData;
      chart.data.datasets[1].data   = invData;
      chart.data.datasets[2].data   = liabData;
      chart.update('none');
    } else {
      const ctx = document.getElementById('simChart').getContext('2d');
      chart = new Chart(ctx, {
        type: 'line',
        data: {
          labels,
          datasets: [
            {
              label: 'Fondo Capitalización',
              data: capData,
              borderColor: '#5C3472',
              backgroundColor: 'rgba(92,52,114,0.1)',
              borderWidth: 2,
              tension: 0.4,
              fill: true,
              pointRadius: 0,
            },
            {
              label: 'Fondo Inversión',
              data: invData,
              borderColor: '#C4622D',
              backgroundColor: 'rgba(196,98,45,0.08)',
              borderWidth: 2,
              tension: 0.4,
              fill: true,
              pointRadius: 0,
            },
            {
              label: 'Pasivo Laboral',
              data: liabData,
              borderColor: 'rgba(184,176,168,0.4)',
              backgroundColor: 'transparent',
              borderWidth: 1.5,
              borderDash: [4, 4],
              tension: 0.2,
              pointRadius: 0,
            },
          ],
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          interaction: { mode: 'index', intersect: false },
          plugins: {
            legend: {
              labels: {
                color: '#B8B0A8',
                font: { family: 'DM Sans', size: 11 },
                boxWidth: 12,
              },
            },
            tooltip: {
              backgroundColor: '#1C2233',
              titleColor: '#F0EDE8',
              bodyColor: '#B8B0A8',
              borderColor: 'rgba(92,52,114,0.3)',
              borderWidth: 1,
              callbacks: {
                label: ctx => ' ' + ctx.dataset.label + ': $' +
                  ctx.parsed.y.toLocaleString('en-US', { maximumFractionDigits: 0 }),
              },
            },
          },
          scales: {
            x: {
              ticks: { color: '#6B6460', font: { family: 'DM Sans', size: 10 } },
              grid:  { color: 'rgba(255,255,255,0.04)' },
            },
            y: {
              ticks: {
                color: '#6B6460',
                font: { family: 'DM Sans', size: 10 },
                callback: v => '$' + (v / 1000).toFixed(0) + 'k',
              },
              grid: { color: 'rgba(255,255,255,0.04)' },
            },
          },
        },
      });
    }
  }

  // ── Leer sliders y actualizar ────────────────────────────────
  function run() {
    const newPHs    = parseInt(document.getElementById('sl-phs').value);
    const phFee     = parseInt(document.getElementById('sl-fee').value);
    const phMonth   = parseInt(document.getElementById('sl-month').value);
    const liabM     = parseInt(document.getElementById('sl-liab').value);
    const capPct    = parseInt(document.getElementById('sl-cap').value);
    const invPct    = parseInt(document.getElementById('sl-inv').value);

    // Display values
    document.getElementById('val-phs').textContent   = newPHs;
    document.getElementById('val-fee').textContent   = '$' + phFee.toLocaleString('en-US');
    document.getElementById('val-month').textContent = 'Mes ' + phMonth;
    document.getElementById('val-liab').textContent  = liabM + ' meses';
    document.getElementById('val-cap').textContent   = capPct + '%';
    document.getElementById('val-inv').textContent   = invPct + '%';

    const { monthly, liabClearedM, cap50kM, inv50kM } = simulate(
      newPHs, phFee, phMonth, liabM, capPct, invPct
    );

    // Update result cards
    document.getElementById('res-liab').textContent  = monthLabel(liabClearedM);
    document.getElementById('res-cap').textContent   = monthLabel(cap50kM);
    document.getElementById('res-inv').textContent   = monthLabel(inv50kM);
    // Income at end of sim
    const last = monthly[monthly.length - 1];
    document.getElementById('res-inc').textContent  =
      '$' + Math.round(BASE_INCOME + (newPHs * phFee)).toLocaleString('en-US');

    updateChart(monthly);
  }

  // ── Event listeners ─────────────────────────────────────────
  document.querySelectorAll('.sim-slider').forEach(sl => {
    sl.addEventListener('input', run);
  });

  // ── Init ─────────────────────────────────────────────────────
  document.addEventListener('DOMContentLoaded', function() {
    // Esperar a que Chart.js cargue
    function tryInit() {
      if (typeof Chart !== 'undefined') { run(); }
      else { setTimeout(tryInit, 150); }
    }
    tryInit();
  });
})();
</script>`
}

// ─── PANEL HELPERS ──────────────────────────────────────────────
function vsStrip(schema: FIESchema): string {
  const cols = schema.eeff_months.slice(-6) // max 6 meses
  if (!cols.length) return '<p style="color:#6B6460;font-style:italic">Sin datos de período</p>'
  return `
<div style="overflow-x:auto">
<table style="width:100%;border-collapse:collapse;font-family:'DM Sans',sans-serif;font-size:13px">
  <thead>
    <tr>
      <th style="text-align:left;padding:8px 12px;font-family:'Cinzel',serif;font-size:9px;letter-spacing:.18em;text-transform:uppercase;color:#6B6460;border-bottom:1px solid rgba(255,255,255,.07)">Métrica</th>
      ${cols.map(m => `<th style="text-align:right;padding:8px 12px;font-family:'Cinzel',serif;font-size:9px;letter-spacing:.14em;color:#6B6460;border-bottom:1px solid rgba(255,255,255,.07)">${m.month}</th>`).join('')}
    </tr>
  </thead>
  <tbody>
    ${[
      { label: 'Ingresos',  key: 'ingresos', fmt: fmt$ },
      { label: 'Gastos',    key: 'gastos',   fmt: fmt$ },
      { label: 'Utilidad',  key: 'utilidad', fmt: fmt$ },
      { label: 'Margen',    key: 'margen',   fmt: (v: number) => fmtPct(v) },
    ].map(row => `
    <tr>
      <td style="padding:8px 12px;color:#B8B0A8;border-bottom:1px solid rgba(255,255,255,.04)">${row.label}</td>
      ${cols.map(m => {
        const val = m[row.key as keyof typeof m] as number
        const isMargen = row.key === 'margen'
        const color = isMargen ? pctColor(val) : val < 0 ? '#C4622D' : '#F0EDE8'
        return `<td style="text-align:right;padding:8px 12px;color:${color};border-bottom:1px solid rgba(255,255,255,.04);font-family:'EB Garamond',serif;font-size:15px">${(row.fmt as Function)(val)}</td>`
      }).join('')}
    </tr>`).join('')}
  </tbody>
</table>
</div>`
}

function costHierarchy(schema: FIESchema): string {
  const bd    = schema.cost_breakdown
  const total = Object.entries(bd).reduce((s, [, v]) => s + (v ?? 0), 0)
  const sorted = Object.entries(bd)
    .filter(([, v]) => v && v > 0)
    .sort(([, a], [, b]) => (b ?? 0) - (a ?? 0))

  return sorted.map(([key, val], i) => {
    const pct  = total > 0 ? ((val ?? 0) / total) * 100 : 0
    const label = COST_LABELS[key] ?? key
    return `
<div style="margin-bottom:12px">
  <div style="display:flex;justify-content:space-between;align-items:baseline;margin-bottom:5px">
    <span style="font-family:'DM Sans',sans-serif;font-size:13px;color:#B8B0A8">${i + 1}. ${label}</span>
    <span style="font-family:'EB Garamond',serif;font-size:16px;color:#F0EDE8">${fmt$(val ?? 0)} <span style="font-size:12px;color:#6B6460">(${fmtPct(pct)})</span></span>
  </div>
  <div style="height:3px;background:rgba(255,255,255,.05);border-radius:2px">
    <div style="height:3px;width:${fmtPct(pct)};background:${i === 0 ? '#5C3472' : i === 1 ? '#EAD9F5' : 'rgba(92,52,114,0.4)'};border-radius:2px"></div>
  </div>
</div>`
  }).join('')
}

function fondosCards(schema: FIESchema): string {
  const surplus = schema.base_income - schema.base_ops - schema.labor_res_monthly - schema.contingency_monthly
  const funds = [
    {
      name:  'Operativo',
      color: '#5C3472',
      desc:  'Cubre gastos corrientes y reserva de operación mensual.',
      amount: schema.base_ops,
      note:  'Gastos fijos mensuales',
    },
    {
      name:  'Reserva Laboral',
      color: '#EAD9F5',
      desc:  `Liquidación progresiva del pasivo histórico (${fmt$(schema.historic_liability)}) + provisión mensual.`,
      amount: schema.labor_res_monthly,
      note:  'Aporte mensual requerido',
    },
    {
      name:  'Contingencia',
      color: '#C4622D',
      desc:  'Reparaciones urgentes, gastos imprevistos, emergencias del PH.',
      amount: schema.contingency_monthly,
      note:  'Reserva mensual',
    },
    {
      name:  'Capitalización e Inversión',
      color: '#4ADE80',
      desc:  'Crecimiento del portafolio, capacitaciones, nuevas marcas, expansión.',
      amount: Math.max(0, surplus),
      note:  'Superávit disponible / mes',
    },
  ]

  return `<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:14px">` +
    funds.map(f => `
<div style="background:rgba(28,34,51,0.8);border-top:3px solid ${f.color};border-radius:8px;padding:18px 20px">
  <div style="font-family:'Cinzel',serif;font-size:9px;font-weight:600;letter-spacing:.2em;text-transform:uppercase;color:${f.color};margin-bottom:8px">${f.name}</div>
  <div style="font-family:'EB Garamond',serif;font-size:22px;color:#F0EDE8;margin-bottom:8px">${fmt$(f.amount)}</div>
  <div style="font-family:'DM Sans',sans-serif;font-size:11px;color:#6B6460;margin-bottom:6px;line-height:1.5">${f.desc}</div>
  <div style="font-family:'Cinzel',serif;font-size:8px;letter-spacing:.12em;text-transform:uppercase;color:rgba(240,237,232,.3)">${f.note}</div>
</div>`).join('') + `</div>`
}

function scenarioGrid(schema: FIESchema): string {
  const scens = schema.scenarios ?? []
  return `<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:14px">` +
    scens.map(s => {
      const monthlyInc = schema.base_income + s.new_phs * s.ph_fee
      const monthlyOps = schema.base_ops + s.new_phs * schema.cost_per_new_ph
      const surplus    = monthlyInc - monthlyOps - schema.labor_res_monthly - schema.contingency_monthly
      return `
<div style="background:rgba(28,34,51,0.8);border:1px solid rgba(255,255,255,.06);border-left:3px solid ${s.color};border-radius:8px;padding:18px 20px">
  <div style="font-family:'Cinzel',serif;font-size:9px;font-weight:600;letter-spacing:.2em;text-transform:uppercase;color:${s.color};margin-bottom:10px">${s.label}</div>
  <div style="margin-bottom:10px">
    <div style="font-family:'Cinzel',serif;font-size:8px;letter-spacing:.12em;text-transform:uppercase;color:rgba(240,237,232,.3);margin-bottom:3px">PHs nuevos</div>
    <div style="font-family:'EB Garamond',serif;font-size:20px;color:#F0EDE8">${s.new_phs === 0 ? '—' : '+' + s.new_phs + ' × ' + fmt$(s.ph_fee) + '/mes'}</div>
  </div>
  <div style="height:1px;background:rgba(255,255,255,.06);margin-bottom:10px"></div>
  <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px">
    <div>
      <div style="font-family:'Cinzel',serif;font-size:7px;letter-spacing:.12em;text-transform:uppercase;color:rgba(240,237,232,.3)">Ingresos/mes</div>
      <div style="font-family:'EB Garamond',serif;font-size:15px;color:#F0EDE8">${fmtK(monthlyInc)}</div>
    </div>
    <div>
      <div style="font-family:'Cinzel',serif;font-size:7px;letter-spacing:.12em;text-transform:uppercase;color:rgba(240,237,232,.3)">Superávit/mes</div>
      <div style="font-family:'EB Garamond',serif;font-size:15px;color:${surplus >= 0 ? '#4ADE80' : '#C4622D'}">${fmtK(surplus)}</div>
    </div>
  </div>
</div>`}).join('') + `</div>`
}

// ─── PANEL WRAPPER ──────────────────────────────────────────────
function panel(n: number, title: string, content: string, narrative?: string): string {
  return `
<!-- ════ PANEL ${String(n).padStart(2,'0')} ════ -->
<section class="panel" id="panel-${String(n).padStart(2,'0')}">
  <div class="panel-num">0${n > 9 ? '' : '0'}${n}</div>
  <h2 class="panel-title">${title}</h2>
  ${narrative ? `<div class="narrative">${narrative}</div>` : ''}
  <div class="panel-body">${content}</div>
</section>`
}

// ─── MAIN TEMPLATE FUNCTION ─────────────────────────────────────
export function generateFIEHtml(schema: FIESchema): string {
  const { building_name, period_label, narrative } = schema
  const summary  = schema.eeff_months.length
    ? {
        avgMargen:     schema.eeff_months.reduce((s,m) => s + m.margen,   0) / schema.eeff_months.length,
        totalIngresos: schema.eeff_months.reduce((s,m) => s + m.ingresos, 0),
        totalGastos:   schema.eeff_months.reduce((s,m) => s + m.gastos,   0),
        totalUtilidad: schema.eeff_months.reduce((s,m) => s + m.utilidad, 0),
      }
    : { avgMargen: 0, totalIngresos: 0, totalGastos: 0, totalUtilidad: 0 }

  const lastMonth = schema.eeff_months[schema.eeff_months.length - 1]

  return `<!DOCTYPE html>
<html lang="es">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Suite FIE · ${building_name} · ${period_label}</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link href="https://fonts.googleapis.com/css2?family=Cormorant+Garamond:ital,wght@1,300&family=EB+Garamond:ital,wght@0,400;1,400&family=Cinzel:wght@400;600&family=DM+Sans:wght@300;400;500;600;700&display=swap" rel="stylesheet">
<script src="https://cdn.jsdelivr.net/npm/chart.js@4.4.0/dist/chart.umd.min.js"></script>
<style>
/* ── Reset ── */
*, *::before, *::after { box-sizing:border-box; margin:0; padding:0; }
html { font-size:16px; -webkit-font-smoothing:antialiased; }
body { background:#0E1018; color:#F0EDE8; font-family:'DM Sans',sans-serif; line-height:1.6; }
@media print {
  body { background:#fff; color:#1A1612; }
  .panel { page-break-inside:avoid; border-color:rgba(0,0,0,.1) !important; }
  .sim-panel { display:none; }
}

/* ── Variables ── */
:root {
  --am:#5C3472; --am-d:#3A1F4A; --am-l:#EAD9F5;
  --terra:#C4622D; --carbon:#1C2233; --carbon-d:#0E1018;
  --parch:#F0EDE8; --dust:#B8B0A8; --stone:#6B6460;
  --success:#4ADE80; --warning:#FBBF24;
}

/* ── Layout ── */
.container { max-width:960px; margin:0 auto; padding:0 28px; }

/* ── Cover ── */
.cover {
  position:relative; overflow:hidden;
  padding:80px 0 60px; text-align:center;
  background:var(--carbon-d);
  border-bottom:3px solid var(--am);
}
.cover::before {
  content:'';position:absolute;inset:0;
  background:radial-gradient(circle at 80% 15%,rgba(92,52,114,.22),transparent 55%);
  pointer-events:none;
}
.cover-eyebrow {
  font-family:'Cinzel',serif; font-size:9px; font-weight:600;
  letter-spacing:.22em; text-transform:uppercase; color:var(--terra);
  margin-bottom:14px; opacity:.85;
}
.cover-building {
  font-family:'Cormorant Garamond',serif; font-size:clamp(2.2rem,5vw,4rem);
  font-weight:300; font-style:italic; color:var(--am-l); line-height:1.1;
  margin-bottom:10px;
}
.cover-title {
  font-family:'EB Garamond',serif; font-size:clamp(1.4rem,3vw,2rem);
  font-weight:400; color:var(--parch); margin-bottom:20px;
}
.cover-kpis {
  display:flex; justify-content:center; gap:32px; flex-wrap:wrap;
  margin-top:28px; padding-top:28px; border-top:1px solid rgba(255,255,255,.08);
}
.cover-kpi { text-align:center; }
.cover-kpi-val {
  font-family:'EB Garamond',serif; font-size:clamp(2rem,4vw,3rem);
  font-weight:400; line-height:1; color:var(--parch);
}
.cover-kpi-lbl {
  font-family:'Cinzel',serif; font-size:8px; letter-spacing:.18em;
  text-transform:uppercase; color:var(--stone); margin-top:5px; display:block;
}

/* ── Nav ── */
.fie-nav {
  position:sticky; top:0; z-index:100;
  background:rgba(14,16,24,.97); backdrop-filter:blur(12px);
  border-bottom:1px solid rgba(92,52,114,.2);
  padding:0 28px; overflow-x:auto; white-space:nowrap;
  display:flex; align-items:center; gap:2px; height:44px;
  scrollbar-width:none;
}
.fie-nav::-webkit-scrollbar { display:none; }
.fie-nav-item {
  font-family:'Cinzel',serif; font-size:9px; font-weight:600;
  letter-spacing:.12em; text-transform:uppercase; color:rgba(240,237,232,.35);
  padding:4px 12px; border-radius:5px; cursor:pointer; text-decoration:none;
  transition:all .15s; white-space:nowrap; flex-shrink:0;
}
.fie-nav-item:hover { color:var(--parch); background:rgba(92,52,114,.1); }

/* ── Panels ── */
.panel {
  padding:60px 0 48px;
  border-bottom:1px solid rgba(255,255,255,.05);
}
.panel:last-of-type { border-bottom:none; }
.panel-num {
  font-family:'Cinzel',serif; font-size:9px; font-weight:600;
  letter-spacing:.22em; color:var(--terra); margin-bottom:8px; opacity:.8;
}
.panel-title {
  font-family:'EB Garamond',serif; font-size:clamp(1.5rem,3vw,2.2rem);
  font-weight:400; line-height:1.2; color:var(--parch); margin-bottom:20px;
}
.narrative {
  font-family:'EB Garamond',serif; font-size:16px; font-style:italic;
  color:rgba(240,237,232,.55); line-height:1.7; margin-bottom:28px;
  border-left:2px solid rgba(92,52,114,.35); padding-left:16px;
}
.panel-body { /* contenido */ }

/* ── Simulador (Panel 07) ── */
.sim-panel { background:var(--carbon-d); }
.sim-grid {
  display:grid; grid-template-columns:1fr 1fr; gap:20px;
}
@media(max-width:640px) { .sim-grid { grid-template-columns:1fr; } }
.slider-group { margin-bottom:16px; }
.slider-label {
  display:flex; justify-content:space-between; align-items:baseline;
  font-family:'Cinzel',serif; font-size:9px; letter-spacing:.14em;
  text-transform:uppercase; color:var(--stone); margin-bottom:6px;
}
.slider-val { color:var(--am-l); }
.sim-slider {
  -webkit-appearance:none; width:100%; height:3px;
  background:rgba(92,52,114,.25); border-radius:2px; outline:none; cursor:pointer;
}
.sim-slider::-webkit-slider-thumb {
  -webkit-appearance:none; width:14px; height:14px;
  border-radius:50%; background:var(--am); cursor:pointer;
  box-shadow:0 0 0 3px rgba(92,52,114,.2);
}
.sim-results {
  display:grid; grid-template-columns:repeat(2,1fr); gap:12px; margin-top:20px;
}
.sim-card {
  background:var(--carbon); border:1px solid rgba(92,52,114,.2);
  border-radius:8px; padding:16px;
}
.sim-card-lbl {
  font-family:'Cinzel',serif; font-size:8px; font-weight:600;
  letter-spacing:.18em; text-transform:uppercase; color:var(--stone); margin-bottom:6px;
}
.sim-card-val {
  font-family:'EB Garamond',serif; font-size:22px; color:var(--am-l);
}
.chart-wrap { height:260px; margin-top:24px; }

/* ── Footer ── */
.fie-footer {
  border-top:2px solid var(--am);
  background:var(--carbon-d); padding:16px 28px;
  display:flex; align-items:center; justify-content:space-between;
  flex-wrap:wrap; gap:12px;
}
.fie-footer-wm { display:inline-flex; align-items:baseline; gap:0; }
.fie-footer-disc {
  font-family:'DM Sans',sans-serif; font-size:10px; color:rgba(240,237,232,.25);
  max-width:520px; line-height:1.5;
}
</style>
</head>
<body>

<!-- ══ COVER ══════════════════════════════════════════════════ -->
<header class="cover" id="top">
  <div class="container" style="position:relative;z-index:1">
    <div class="cover-eyebrow">Financial Intelligence Engine · ForumPHs</div>
    <div class="cover-building">${building_name}</div>
    <div class="cover-title">Suite de Inteligencia Financiera · ${period_label}</div>
    ${schema.eeff_months.length ? `
    <div class="cover-kpis">
      <div class="cover-kpi">
        <div class="cover-kpi-val" style="color:${pctColor(summary.avgMargen)}">${fmtPct(summary.avgMargen)}</div>
        <span class="cover-kpi-lbl">Margen Promedio</span>
      </div>
      <div class="cover-kpi">
        <div class="cover-kpi-val">${fmtK(summary.totalIngresos)}</div>
        <span class="cover-kpi-lbl">Ingresos Totales</span>
      </div>
      <div class="cover-kpi">
        <div class="cover-kpi-val" style="color:${summary.totalUtilidad >= 0 ? 'var(--success)' : 'var(--terra)'}">${fmtK(summary.totalUtilidad)}</div>
        <span class="cover-kpi-lbl">Utilidad Neta</span>
      </div>
      <div class="cover-kpi">
        <div class="cover-kpi-val">${schema.eeff_months.length}</div>
        <span class="cover-kpi-lbl">Meses Analizados</span>
      </div>
    </div>` : ''}
  </div>
</header>

<!-- ══ NAVIGATION ════════════════════════════════════════════ -->
<nav class="fie-nav">
  <a class="fie-nav-item" href="#panel-01">01 · Comparativa</a>
  <a class="fie-nav-item" href="#panel-02">02 · Estado Actual</a>
  <a class="fie-nav-item" href="#panel-03">03 · Costos</a>
  <a class="fie-nav-item" href="#panel-04">04 · Fondos</a>
  <a class="fie-nav-item" href="#panel-05">05 · Proyección</a>
  <a class="fie-nav-item" href="#panel-06">06 · Hoja de Ruta</a>
  <a class="fie-nav-item" href="#panel-07">07 · Simulador</a>
</nav>

<!-- ══ PANELS ════════════════════════════════════════════════ -->
<main class="container">

${panel(1, 'Comparativa Real de Períodos', vsStrip(schema), narrative?.panel_01)}

${panel(2, 'Estado Actual · Indicadores del Período',
  /* Panel 02 — KPI cards del último mes */
  lastMonth ? `
<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:14px">
  ${[
    { lbl: 'Ingresos', val: fmt$(lastMonth.ingresos), color: '#F0EDE8' },
    { lbl: 'Gastos',   val: fmt$(lastMonth.gastos),   color: '#B8B0A8' },
    { lbl: 'Utilidad', val: fmt$(lastMonth.utilidad), color: lastMonth.utilidad >= 0 ? '#4ADE80' : '#C4622D' },
    { lbl: 'Margen',   val: fmtPct(lastMonth.margen),  color: pctColor(lastMonth.margen) },
  ].map(k => `
<div style="background:#1C2233;border:1px solid rgba(255,255,255,.06);border-radius:10px;padding:18px 20px">
  <div style="font-family:'Cinzel',serif;font-size:9px;font-weight:600;letter-spacing:.2em;text-transform:uppercase;color:#6B6460;margin-bottom:7px">${k.lbl}</div>
  <div style="font-family:'EB Garamond',serif;font-size:clamp(1.6rem,3vw,2.2rem);color:${k.color};line-height:1">${k.val}</div>
</div>`).join('')}
</div>` : '<p style="color:#6B6460;font-style:italic">Sin datos disponibles</p>',
  narrative?.panel_02)}

${panel(3, 'Estructura de Costos · Desglose', costHierarchy(schema), narrative?.panel_03)}

${panel(4, 'Los 4 Fondos de Sostenibilidad', fondosCards(schema), narrative?.panel_04)}

${panel(5, 'Proyección · Escenarios de Crecimiento', scenarioGrid(schema), narrative?.panel_05)}

${panel(6, 'Hoja de Ruta · Hitos Financieros',
  /* Panel 06 — Milestones */
  `<div style="position:relative;padding-left:24px">
    <div style="position:absolute;left:7px;top:8px;bottom:8px;width:2px;background:rgba(92,52,114,.3)"></div>
    ${[
      { dot:'#6B6460', label:'Inicio provisión pasivo laboral', date:'Mayo 2026',   note:'$1,014.89/mes · VENCIDO' },
      { dot:'#FBBF24', label:'Incorporar 1er PH nuevo',        date:'Jun 2026',     note:'Meta crítica de crecimiento' },
      { dot:'#5C3472', label:'Pasivo laboral liquidado',        date:null,           note:'Calculable en simulador' },
      { dot:'#C4622D', label:'Margen sostenido >20%',           date:null,           note:'Con 10 PHs en cartera' },
      { dot:'#4ADE80', label:'Fondo Capitalización $50k',       date:null,           note:'Calculable en simulador' },
      { dot:'#4ADE80', label:'Fondo Inversión $50k',            date:null,           note:'Calculable en simulador' },
    ].map(ms => `
<div style="position:relative;padding:10px 0 10px 20px;margin-bottom:4px">
  <span style="position:absolute;left:-3px;top:16px;width:12px;height:12px;border-radius:50%;background:${ms.dot};display:block;flex-shrink:0"></span>
  <div style="font-family:'DM Sans',sans-serif;font-size:13px;color:#F0EDE8;font-weight:500">${ms.label}</div>
  <div style="font-family:'DM Sans',sans-serif;font-size:11px;color:#6B6460;margin-top:2px">${ms.date ?? '→ Simulador'} · ${ms.note}</div>
</div>`).join('')}
</div>`,
  narrative?.panel_06)}

</main>

<!-- ══ PANEL 07 — SIMULADOR ═══════════════════════════════════ -->
<section class="panel sim-panel" id="panel-07">
  <div class="container">
    <div class="panel-num">007</div>
    <h2 class="panel-title" style="font-size:clamp(1.5rem,3vw,2.5rem)">Timing &amp; Metas — Simulador Interactivo</h2>
    <div class="narrative">
      Ajusta los parámetros para proyectar cuándo ForumPHs alcanza cada hito financiero.
      El modelo corre 180 iteraciones mensuales (15 años) con los supuestos actuales como base.
    </div>

    <div class="sim-grid">
      <!-- Sliders -->
      <div>
        <div class="slider-group">
          <div class="slider-label">PHs nuevos <span class="slider-val" id="val-phs">2</span></div>
          <input class="sim-slider" id="sl-phs" type="range" min="0" max="6" step="1" value="2">
        </div>
        <div class="slider-group">
          <div class="slider-label">Tarifa por PH <span class="slider-val" id="val-fee">$2,500</span></div>
          <input class="sim-slider" id="sl-fee" type="range" min="1000" max="5000" step="100" value="2500">
        </div>
        <div class="slider-group">
          <div class="slider-label">Mes de incorporación <span class="slider-val" id="val-month">Mes 3</span></div>
          <input class="sim-slider" id="sl-month" type="range" min="1" max="12" step="1" value="3">
        </div>
        <div class="slider-group">
          <div class="slider-label">Plazo liquidar pasivo <span class="slider-val" id="val-liab">24 meses</span></div>
          <input class="sim-slider" id="sl-liab" type="range" min="10" max="36" step="2" value="24">
        </div>
        <div class="slider-group">
          <div class="slider-label">% Capitalización <span class="slider-val" id="val-cap">20%</span></div>
          <input class="sim-slider" id="sl-cap" type="range" min="5" max="35" step="5" value="20">
        </div>
        <div class="slider-group">
          <div class="slider-label">% Inversión <span class="slider-val" id="val-inv">15%</span></div>
          <input class="sim-slider" id="sl-inv" type="range" min="5" max="30" step="5" value="15">
        </div>
      </div>

      <!-- Resultados -->
      <div>
        <div class="sim-results">
          <div class="sim-card">
            <div class="sim-card-lbl">Pasivo liquidado</div>
            <div class="sim-card-val" id="res-liab">—</div>
          </div>
          <div class="sim-card">
            <div class="sim-card-lbl">Fondo Cap. $50k</div>
            <div class="sim-card-val" id="res-cap">—</div>
          </div>
          <div class="sim-card">
            <div class="sim-card-lbl">Fondo Inv. $50k</div>
            <div class="sim-card-val" id="res-inv">—</div>
          </div>
          <div class="sim-card">
            <div class="sim-card-lbl">Ingreso mensual</div>
            <div class="sim-card-val" id="res-inc">—</div>
          </div>
        </div>
        <div class="chart-wrap">
          <canvas id="simChart"></canvas>
        </div>
      </div>
    </div>
  </div>
</section>

<!-- ══ FOOTER ════════════════════════════════════════════════ -->
<footer class="fie-footer">
  <div class="fie-footer-wm">
    <span style="font-family:'EB Garamond',serif;font-weight:400;color:rgba(240,237,232,.55);font-size:14px">Forum</span>
    <span style="font-family:'DM Sans',sans-serif;font-weight:700;color:#C4622D;letter-spacing:.06em;font-size:13px">PH</span>
    <span style="font-family:'DM Sans',sans-serif;font-weight:700;color:#C4622D;letter-spacing:.04em;font-size:13px">s</span>
    <span style="font-family:'DM Sans',sans-serif;font-size:9px;color:rgba(240,237,232,.2);letter-spacing:.06em;margin-left:8px">FIE v1.0 · ${period_label}</span>
  </div>
  <div class="fie-footer-disc">
    Los estados e indicadores financieros presentados son preliminares y están sujetos a revisión y firma por la
    Contadora Pública Autorizada Marlene Molina, C.P.A. No. 0488-2020.
    Generado por ForumPHs Document Factory · Ley 284 de 2022.
  </div>
</footer>

${simuladorScript(schema)}
</body>
</html>`
}
