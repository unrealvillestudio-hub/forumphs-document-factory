import "jsr:@supabase/functions-js/edge-runtime.d.ts";

const FPHS_URL = 'https://tajuoqdbnsnzkhyqvdgs.supabase.co';
const FPHS_KEY = Deno.env.get('FPHS_SERVICE_KEY') ?? '';
const ANTHROPIC_KEY = Deno.env.get('forumphs_document_factory') ?? Deno.env.get('ANTHROPIC_API_KEY') ?? '';
const SB_URL = Deno.env.get('SUPABASE_URL') ?? '';
const SB_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';

const CPA_DISCLAIMER = 'Los estados e indicadores financieros presentados en este informe son preliminares y están sujetos a revisión y firma por la Contadora Pública Autorizada Marlene Molina, C.P.A. Nº 0488-2020.';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'content-type,authorization',
  'Access-Control-Allow-Methods': 'POST, OPTIONS'
};

async function fphs<T>(path: string): Promise<T> {
  const r = await fetch(`${FPHS_URL}/rest/v1/${path}`, {
    headers: { 'apikey': FPHS_KEY, 'Authorization': `Bearer ${FPHS_KEY}` }
  });
  if (!r.ok) throw new Error(`FPHS ${path}: ${r.status}`);
  return r.json() as Promise<T>;
}

async function fphsUpsert(table: string, data: Record<string, unknown>) {
  return fetch(`${FPHS_URL}/rest/v1/${table}`, {
    method: 'POST',
    headers: {
      'apikey': FPHS_KEY,
      'Authorization': `Bearer ${FPHS_KEY}`,
      'Content-Type': 'application/json',
      'Prefer': 'return=representation,resolution=merge-duplicates'
    },
    body: JSON.stringify(data)
  });
}

function inferFase(meses: number): string {
  if (meses <= 0) return 'AL_DIA';
  if (meses <= 2) return 'FASE_I';
  if (meses <= 4) return 'FASE_II';
  return 'FASE_III';
}

function logTokens(input: number, output: number, notes: string) {
  if (!SB_URL || !SB_KEY) return;
  fetch(`${SB_URL}/rest/v1/ops_token_sessions`, {
    method: 'POST',
    headers: {
      'apikey': SB_KEY, 'Authorization': `Bearer ${SB_KEY}`,
      'Content-Type': 'application/json', 'Prefer': 'return=minimal'
    },
    body: JSON.stringify({
      session_type: 'edge_function', model_id: 'claude-sonnet-4-6',
      brand_id: 'ForumPHs', lab: 'document-factory',
      input_tokens: input, output_tokens: output, notes
    })
  }).catch(() => {});
}

async function generateNarrative(
  buildingName: string,
  periodo: string,
  kpis: Record<string, number>,
  moraUnits: Array<Record<string, unknown>>
): Promise<{ text: string; inputTokens: number; outputTokens: number }> {
  const d = new Date(periodo + '-02');
  const mesNombre = d.toLocaleDateString('es-PA', { month: 'long', year: 'numeric' });
  const pctCobro = kpis.porcentaje_cobro?.toFixed(1) ?? '0.0';
  const criticalUnits = moraUnits.filter(u => u.fase === 'FASE_III').slice(0, 5);

  const prompt = `Eres redactor profesional de informes de gestión para PH (Propiedad Horizontal) en Panamá, conforme a la Ley 284 de 2022.\n\nGenera la narrativa ejecutiva del Informe Mensual de Gestión — ${buildingName} — ${mesNombre}.\n\nKPIs DEL MES:\n• Total unidades: ${kpis.total_unidades}\n• Unidades al día: ${kpis.unidades_al_dia} (${((kpis.unidades_al_dia / kpis.total_unidades) * 100).toFixed(1)}%)\n• Unidades en mora: ${kpis.unidades_mora}\n• Recaudación efectiva: $${kpis.monto_recaudado?.toFixed(2)}\n• Saldo pendiente: $${kpis.monto_pendiente?.toFixed(2)}\n• % de cobro: ${pctCobro}%\n\nDISTRIBUCIÓN DE MORA:\n• Fase I (1-2 meses): ${kpis.mora_fase_i_count} unidades / $${kpis.mora_fase_i_monto?.toFixed(2)}\n• Fase II (3-4 meses): ${kpis.mora_fase_ii_count} unidades / $${kpis.mora_fase_ii_monto?.toFixed(2)}\n• Fase III (5+ meses): ${kpis.mora_fase_iii_count} unidades / $${kpis.mora_fase_iii_monto?.toFixed(2)}\n${criticalUnits.length > 0 ? '\nUNIDADES FASE III (críticas):\n' + criticalUnits.map(u => '• Unidad ' + u.unit_code + ': $' + u.monto_pendiente + ' — ' + u.meses_mora + ' meses').join('\n') : ''}\n\nINSTRUCCIONES:\n1. Tercera persona formal y objetiva — tono ejecutivo\n2. Tres párrafos exactos: (a) resumen ejecutivo, (b) análisis mora + protocolo F-I/F-II/F-III, (c) perspectivas y recomendaciones a la JD\n3. No inventes datos\n4. Máximo 220 palabras\n5. Sin títulos ni bullets — solo 3 párrafos corridos\n\nResponde SOLO la narrativa.`;

  const r = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-api-key': ANTHROPIC_KEY, 'anthropic-version': '2023-06-01' },
    body: JSON.stringify({ model: 'claude-sonnet-4-6', max_tokens: 700, messages: [{ role: 'user', content: prompt }] })
  });
  if (!r.ok) throw new Error(`Claude ${r.status}`);
  const d2 = await r.json();
  return {
    text: d2.content?.[0]?.text ?? '',
    inputTokens: d2.usage?.input_tokens ?? 0,
    outputTokens: d2.usage?.output_tokens ?? 0
  };
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: CORS });
  const json = (data: unknown, status = 200) =>
    new Response(JSON.stringify(data), { status, headers: { ...CORS, 'Content-Type': 'application/json' } });

  try {
    const body = await req.json();
    const { building_id, periodo, data_input, generado_por } = body;

    if (!building_id || !periodo) return json({ error: 'building_id y periodo son requeridos' }, 400);
    if (!/^\d{4}-\d{2}$/.test(periodo)) return json({ error: 'periodo debe ser YYYY-MM' }, 400);

    const buildings = await fphs<Array<Record<string, unknown>>>(`buildings?id=eq.${building_id}&select=id,name,total_units`);
    const building = buildings[0];
    if (!building) return json({ error: 'Edificio no encontrado' }, 404);

    const units = await fphs<Array<Record<string, string>>>(`units?building_id=eq.${building_id}&select=id,unit_code`);
    const totalUnidades = units.length;

    let kpis: Record<string, number>;
    let moraUnits: Array<Record<string, unknown>> = [];

    if (data_input) {
      const cuotaTotal = data_input.cuota_mensual_total ?? 0;
      const recaudado = data_input.monto_recaudado ?? 0;
      const pendiente = data_input.monto_pendiente ?? 0;
      const fi: Array<Record<string, unknown>> = data_input.mora_fase_i ?? [];
      const fii: Array<Record<string, unknown>> = data_input.mora_fase_ii ?? [];
      const fiii: Array<Record<string, unknown>> = data_input.mora_fase_iii ?? [];
      moraUnits = [...fi, ...fii, ...fiii];

      kpis = {
        total_unidades: data_input.total_unidades ?? totalUnidades,
        unidades_al_dia: data_input.unidades_al_dia ?? (totalUnidades - moraUnits.length),
        unidades_mora: moraUnits.length,
        monto_recaudado: recaudado,
        monto_pendiente: pendiente,
        porcentaje_cobro: cuotaTotal > 0 ? (recaudado / cuotaTotal) * 100 : (data_input.porcentaje_cobro ?? 0),
        mora_fase_i_count: fi.length,
        mora_fase_ii_count: fii.length,
        mora_fase_iii_count: fiii.length,
        mora_fase_i_monto: fi.reduce((s: number, u: Record<string, number>) => s + (u.monto_pendiente ?? 0), 0),
        mora_fase_ii_monto: fii.reduce((s: number, u: Record<string, number>) => s + (u.monto_pendiente ?? 0), 0),
        mora_fase_iii_monto: fiii.reduce((s: number, u: Record<string, number>) => s + (u.monto_pendiente ?? 0), 0),
      };

      const periodoDate = periodo + '-01';
      for (const mu of moraUnits) {
        const unit = units.find(u => u.unit_code === mu.unit_code);
        if (!unit) continue;
        await fphsUpsert('mora_mensual', {
          building_id, unit_id: unit.id, periodo: periodoDate,
          meses_mora: mu.meses_mora ?? 1,
          monto_pendiente: mu.monto_pendiente ?? 0,
          fase: inferFase(Number(mu.meses_mora ?? 1)),
          nota: mu.nota ?? null
        });
      }
    } else {
      kpis = {
        total_unidades: totalUnidades, unidades_al_dia: totalUnidades, unidades_mora: 0,
        monto_recaudado: 0, monto_pendiente: 0, porcentaje_cobro: 0,
        mora_fase_i_count: 0, mora_fase_ii_count: 0, mora_fase_iii_count: 0,
        mora_fase_i_monto: 0, mora_fase_ii_monto: 0, mora_fase_iii_monto: 0
      };
    }

    const { text: narrativa, inputTokens, outputTokens } = await generateNarrative(
      String(building.name), periodo, kpis, moraUnits
    );
    logTokens(inputTokens, outputTokens, `fphs-bi-report: ${building.name} ${periodo}`);

    const informeRes = await fphsUpsert('informes', {
      building_id, periodo: periodo + '-01', tipo: 'mensual',
      ...kpis, narrativa_claude: narrativa,
      generado_por: generado_por ?? 'system', status: 'borrador'
    });
    const informeRows = await informeRes.json();
    const informe = Array.isArray(informeRows) ? informeRows[0] : informeRows;

    return json({
      success: true,
      informe: { ...informe, building_name: building.name },
      kpis, narrativa, mora_units: moraUnits, cpa_disclaimer: CPA_DISCLAIMER
    });

  } catch (e) {
    return json({ error: String(e) }, 500);
  }
});
