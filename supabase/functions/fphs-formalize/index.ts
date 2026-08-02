import "jsr:@supabase/functions-js/edge-runtime.d.ts";

const P = 5;
// R3 — minimum substantive words for a fragment to count as an intervention.
// Starting point for future calibration.
const TRIVIAL_MIN_WORDS = 5;
const SB_URL = Deno.env.get('SUPABASE_URL') ?? '';
const SB_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
// §3.1 — shared secret that gates this endpoint. Callers (the /api/formalize
// server proxy and reprocessPending) present it as `x-formalize-secret`. A NEW
// secret, never reused from forumphs_document_factory or any API key.
const FORMALIZE_SECRET = Deno.env.get('FPHS_FORMALIZE_SECRET') ?? '';

const LOGISTICA_NAMES = /daniel\s*puentes|daniel\s+p\b|hypal|hipal|moderador\s+virtual/i;

const BOLD_RULE = `FORMATO DE IDENTIFICACIÓN DE INTERVINIENTES (regla obligatoria):

1. ADMINISTRACIÓN: Formato: "**[Nombre]**, en representación de la administración," NUNCA uses artículo antes del nombre.
2. PROPIETARIO/A: Formato: "[TRATAMIENTO] **[Nombre completo], propietaria/o de la unidad inmobiliaria [unidad]**,". Para [TRATAMIENTO], DETERMINA el género del interviniente leyendo las marcas gramaticales del texto: artículos y tratamientos ("la propietaria", "doña", "el señor", "don"), y concordancias de adjetivos/participios referidos a la persona ("preocupada", "representado"). Si el texto indica género femenino usa "La señora"; si indica masculino usa "El señor". SOLO si el texto no ofrece ninguna señal de género, usa exactamente "La señora/El señor" (con la barra), que será revisado. Ajusta también "propietaria/o" al género determinado (propietaria / propietario).
3. JUNTA DIRECTIVA: Usa SOLO el cargo sin nombre propio, sin negrita.
4. PERSONAL DE PLATAFORMA / LOGÍSTICA (moderador virtual, soporte técnico, operadores de la plataforma de votación — p. ej. Zoom, Hipal/Hypal, TOC/HIF, Daniel Puentes): NUNCA se nombra ni se narra su intervención en el acta. No es compareciente ni interviniente relevante al objeto de la asamblea. Su apertura, bienvenida o instrucciones técnicas NO se redactan. Si el acta debe registrar la instalación, se atribuye por CARGO a la Junta Directiva (regla 3), nunca al personal de plataforma.

NO uses ningún otro formato markdown. NUNCA repitas el nombre si ya apareció en el mismo párrafo.`;

// NUMBER_RULE — acta GOAL escribe todo numero significativo en LETRAS seguido de
// los digitos entre parentesis. La conversion final determinista la hace el
// generador (numeroALetras.ts); aqui el modelo NO debe inventar ni alterar cifras.
const NUMBER_RULE = `NUMEROS (regla obligatoria):
- Conserva EXACTAMENTE las cifras que aparecen en la intervención. No redondees, no inventes, no completes.
- Si el hablante dice un numero (votos, porcentajes, montos, unidades), escribelo en LETRAS seguido del digito entre parentesis: "cuarenta y cinco (45)".
- Si no estas seguro de una cifra, escribela tal cual aparece, sin parentesis. NUNCA inventes un numero que no se dijo.
- Horas, montos en dolares y porcentajes siguen la misma regla de letras + (digitos).`;

const SYS0 = `Eres redactor legal Actas PH Panama Ley 284. Tercera persona formal.
INCLUYE: preguntas, respuestas, acuerdos, desacuerdos, postulaciones, todo contenido sobre gestion PH. EN DUDA INCLUYE.
NULL solo para contenido 100% tecnico: audio/video/conexion sin ningun contenido de asamblea.
REGLAS:
- ${BOLD_RULE}
- ${NUMBER_RULE}
- NO resumir. Preservar el argumento completo, por extenso que sea. NO impongas límite de palabras: una intervención larga debe quedar completa.
Responde SOLO el parrafo formal o exactamente NULL.`;

const SYS1 = `Eres redactor legal Actas PH Panama. MODO FORZADO - NO PUEDES OMITIR.
Tu unica funcion es redactar en tercera persona formal.
INCLUYE TODO excepto problemas tecnicos de audio/video puros sin ningun contenido.
Si sientes tentacion de escribir NULL, en cambio redacta un parrafo breve.
REGLAS:
- ${BOLD_RULE}
- ${NUMBER_RULE}
- NO resumir. Preserva el contenido completo. NUNCA respondas NULL.
Responde SOLO el parrafo formal.`;

const SYS2 = `Eres redactor legal Actas PH Panama. MODO FORZADO MAXIMO.
Redacta SIEMPRE en tercera persona aunque sea una intervención muy breve.
REGLAS:
- ${BOLD_RULE}
- ${NUMBER_RULE}
- NUNCA respondas NULL.
Responde SOLO el parrafo formal.`;

const SYSTEMS = [SYS0, SYS1, SYS2];

// Build the third-person speaker prefix (shared by template + fallback).
function speakerPrefix(b: Record<string, string>): string {
  const isAdmin = ['administracion', 'abogado'].includes(b.speaker_role);
  const unit = b.speaker_unit ? `, propietario/a de la unidad inmobiliaria ${b.speaker_unit}` : '';
  return b.speaker_name
    ? isAdmin
      ? `**${b.speaker_name}**, en representación de la administración,`
      : `La señora/El señor **${b.speaker_name}${unit}**,`
    : 'El/La participante';
}

// templateFormalize — deterministic third-person frame when the model is not
// used (attempt >= 3). Uses a neutral placeholder (never the raw text) so QA/ICR
// can target these for reproceso without leaking oral transcript into the acta.
function templateFormalize(b: Record<string, string>) {
  return `${speakerPrefix(b)} realizó una intervención sobre el tema en discusión. [PENDIENTE DE FORMALIZACION — revisar en reproceso]`;
}

// FIX #3 — fallbackFormalize: used ONLY when the API call FAILS (network/5xx).
// Previously the catch block injected the RAW first-person transcript verbatim
// (`text_formal: t`), which was the source of the "13 errores de primera
// persona": every failed request leaked oral first-person speech into the acta.
// Now we wrap it in a third-person frame and flag it so QA/ICR surface it for
// review instead of shipping it silently. We do NOT echo the raw quote inline
// (that would re-introduce first-person inside quotes); we record a neutral
// placeholder that the re-run sweep is expected to replace on a later attempt.
function fallbackFormalize(b: Record<string, string>): string {
  return `${speakerPrefix(b)} realizó una intervención sobre el tema en discusión. [PENDIENTE DE FORMALIZACION — revisar en reproceso]`;
}

// COST LAYER (§3.2 + §3.3) — record real usage in ops_generation_ledger through
// the ops_log_generation RPC. The ledger resolves the rate from ops_lab_rates
// (generic claude-sonnet-5, 2/10 hasta 31-ago), so the EF does NOT compute
// tariffs: rate params are left NULL on purpose. `billable` is not an RPC param
// and defaults to 'refacturable'. The old target (ops_token_sessions) was
// retired in T1 and no longer exists — that dead insert is what this replaces.
//
// §3.3 — fail LOUD: any failure is logged with status + response body (never the
// old `.catch(()=>{})` that swallowed everything and left the table empty for
// months). It still does not throw into the user path.
async function logLedger(
  inputUnits: number,
  outputUnits: number,
  durationMs: number,
  jobId: string | null,
): Promise<void> {
  if (inputUnits === 0 && outputUnits === 0) return;
  try {
    const res = await fetch(`${SB_URL}/rest/v1/rpc/ops_log_generation`, {
      method: 'POST',
      headers: {
        'apikey': SB_KEY,
        'Authorization': `Bearer ${SB_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        p_lab: 'document-factory',
        p_brand_id: 'ForumPHs',
        p_job_id: jobId,
        p_piece_id: null,
        p_output_type: 'acta',
        p_platform: null,
        p_provider: 'anthropic',
        p_model_id: 'claude-sonnet-5',
        p_unit_type: 'tokens_in', // combined token row; RPC resolves in + out
        p_input_units: inputUnits,
        p_output_units: outputUnits,
        // rates NULL → ops_log_generation resolves them from ops_lab_rates.
        p_status: 'success',
        p_duration_ms: durationMs,
        p_agent_name: 'fphs-formalize',
        p_source_app: 'fphs-document-factory',
        p_api_key_ref: 'forumphs_document_factory',
      }),
    });
    if (!res.ok) {
      const bodyText = await res.text().catch(() => '(unreadable body)');
      console.error(`[fphs-formalize] ledger insert failed: HTTP ${res.status} — ${bodyText}`);
    }
  } catch (err) {
    console.error('[fphs-formalize] ledger network error:', err);
  }
}

Deno.serve(async (req: Request) => {
  const startedAt = Date.now();
  const C = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'content-type, x-formalize-secret',
    'Access-Control-Allow-Methods': 'POST, OPTIONS'
  };
  if (req.method === 'OPTIONS') return new Response(null, { headers: C });

  // §3.1 — CLOSE THE PUBLIC ENDPOINT. Only callers presenting the shared secret
  // may run. If the secret is not configured, fail CLOSED (never fall open to
  // public access). The browser Console reaches us via the /api/formalize proxy,
  // which holds the secret; a stranger with only the URL is now rejected.
  if (!FORMALIZE_SECRET) {
    console.error('[fphs-formalize] FPHS_FORMALIZE_SECRET is not set in the function environment; rejecting all requests.');
    return new Response(
      JSON.stringify({ error: 'server misconfigured' }),
      { status: 503, headers: { ...C, 'Content-Type': 'application/json' } }
    );
  }
  if (req.headers.get('x-formalize-secret') !== FORMALIZE_SECRET) {
    return new Response(
      JSON.stringify({ error: 'unauthorized' }),
      { status: 401, headers: { ...C, 'Content-Type': 'application/json' } }
    );
  }

  try {
    const body = await req.json();
    const blocks = body.blocks;
    const attempt = typeof body.retry_attempt === 'number' ? body.retry_attempt : 0;
    // §3.2 — job_id if present in the request (threaded into the ledger row).
    const jobId = typeof body.job_id === 'string' ? body.job_id : null;

    if (!blocks || !Array.isArray(blocks)) return new Response(
      JSON.stringify({ error: 'blocks required' }),
      { status: 400, headers: { ...C, 'Content-Type': 'application/json' } }
    );

    const k = Deno.env.get('forumphs_document_factory') || Deno.env.get('ANTHROPIC_API_KEY') || '';
    if (!k) return new Response(
      JSON.stringify({ error: 'no api key' }),
      { status: 500, headers: { ...C, 'Content-Type': 'application/json' } }
    );

    const sys = SYSTEMS[Math.min(attempt, 2)];
    // TOLERANCE RECALIBRATION (Sam's decision): the OLD attempt-1 behavior is
    // now the initial run. More formalized content reaches QA/ICR on the first
    // pass — "your second run of today = your first run of tomorrow". This only
    // loosens FORMALIZATION (what gets through); the QA evaluation GATE in
    // qaScanner stays honest, so Ivette's score is not inflated.
    const minLen = 2;
    // attempt 0: respeta el NULL del modelo (descarta ruido genuino).
    // attempt >= 1: fuerza inclusión para recuperar lo que pudo haberse omitido.
    const forceInclude = attempt >= 1;
    const useTemplate = attempt >= 3;

    const r = new Array(blocks.length);
    let totalInputTokens = 0;
    let totalOutputTokens = 0;

    async function run(b: Record<string, string>, i: number) {
      if (b.speaker_role === 'logistica' || LOGISTICA_NAMES.test(b.speaker_name || '')) {
        r[i] = { ...b, skip: true, skip_reason: 'logistica' };
        return;
      }
      const t = (b.text_cleaned || b.text_raw || '').trim();
      if (t.length < minLen) {
        r[i] = { ...b, skip: true, skip_reason: 'empty' };
        return;
      }
      // R3 — trivial fragments are NOT interventions: skip even under forceInclude.
      // "tomó la palabra", "respondió afirmativamente", "sí, correcto" carry no
      // substantive assembly content (PASO 2.1 / PASO 7). Count meaningful words.
      const meaningfulWords = t
        .toLowerCase()
        .normalize('NFD').replace(/[̀-ͯ]/g, '')
        .replace(/[^a-z\s]/g, ' ')
        .split(/\s+/)
        .filter((w: string) => w.length > 3).length;
      if (meaningfulWords < TRIVIAL_MIN_WORDS) {
        r[i] = { ...b, skip: true, skip_reason: 'trivial' };
        return;
      }
      if (useTemplate) {
        r[i] = { ...b, text_formal: templateFormalize(b), skip: false, skip_reason: 'template' };
        return;
      }
      // FIX #2 — retry the API call before falling back. A single transient
      // failure should not leak a placeholder into the acta; we give it 2 tries
      // with a short backoff. max_tokens raised 400 -> 1500 so long
      // interventions are not truncated mid-sentence.
      let lastErr: unknown = null;
      for (let tryNo = 0; tryNo < 2; tryNo++) {
        try {
          const res = await fetch('https://api.anthropic.com/v1/messages', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'x-api-key': k, 'anthropic-version': '2023-06-01' },
            body: JSON.stringify({
              model: 'claude-sonnet-5',
              // PR-C §5 — Sonnet 5 drop-in. thinking disabled (deterministic
              // formalization; keeps thinking tokens out of max_tokens). max_tokens
              // 1500 -> 2000 for the new tokenizer (~30% more tokens/text).
              thinking: { type: 'disabled' },
              max_tokens: 2000,
              system: sys,
              messages: [{
                role: 'user',
                content: 'Hablante: ' + b.speaker_name + '\nRol: ' + b.speaker_role +
                  '\nUnidad: ' + (b.speaker_unit || 'N/A') + '\n\nIntervencion:\n"' + t + '"\n\n' +
                  (forceInclude ? 'Redacta el parrafo formal (obligatorio, nunca NULL).' : 'Parrafo formal o NULL.')
              }]
            })
          });
          if (!res.ok) throw new Error('api ' + res.status);
          const d = await res.json();
          if (d.usage) {
            totalInputTokens += d.usage.input_tokens || 0;
            totalOutputTokens += d.usage.output_tokens || 0;
          }
          const txt = (d.content || []).filter((c: { type: string }) => c.type === 'text').map((c: { text: string }) => c.text).join('').trim();
          const f = (forceInclude && txt === 'NULL') ? templateFormalize(b) : (txt === 'NULL' ? null : txt);
          r[i] = { ...b, text_formal: f || undefined, skip: f === null, skip_reason: f === null ? 'claude_null' : undefined };
          return;
        } catch (e) {
          lastErr = e;
          if (tryNo === 0) await new Promise((res) => setTimeout(res, 400));
        }
      }
      // FIX #3 — both tries failed: third-person frame + explicit flag, never
      // the raw first-person transcript. skip_reason 'fallback' lets the
      // re-run sweep and the Expert Agent target these for reprocessing.
      void lastErr;
      r[i] = { ...b, text_formal: fallbackFormalize(b), skip: false, skip_reason: 'fallback' };
    }

    for (let i = 0; i < blocks.length; i += P) {
      await Promise.allSettled(blocks.slice(i, i + P).map((b: Record<string, string>, j: number) => run(b, i + j)));
    }

    // §3.4 reliability — await the ledger write so the row is committed before
    // the isolate can be reclaimed after the response returns. Single insert;
    // negligible latency, and failures are logged (never swallowed).
    await logLedger(totalInputTokens, totalOutputTokens, Date.now() - startedAt, jobId);

    return new Response(JSON.stringify({
      success: true, blocks: r, retry_attempt: attempt,
      config: { min_length: minLen, force_include: forceInclude, use_template: useTemplate },
      total_formalized: r.filter((b: Record<string, unknown>) => b && b.text_formal && !b.skip).length,
      total_skipped: r.filter((b: Record<string, unknown>) => b && b.skip).length,
      total_fallback: r.filter((b: Record<string, unknown>) => b && b.skip_reason === 'fallback').length,
    }), { headers: { ...C, 'Content-Type': 'application/json' } });

  } catch (e) {
    return new Response(JSON.stringify({ error: String(e) }), { status: 500, headers: { ...C, 'Content-Type': 'application/json' } });
  }
});
