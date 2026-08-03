import "jsr:@supabase/functions-js/edge-runtime.d.ts";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS"
};

const SB_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SB_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";

// COST LAYER (T5 §5.2 + §5.3) — registra el consumo real en ops_generation_ledger
// vía la RPC ops_log_generation. Antes esta EF no registraba nada: consumía
// tokens (max_tokens 5200) sin dejar asiento. Comparte lab='document-factory'
// con fphs-formalize (mismo propósito: producción del acta); source_app la
// distingue en el Dashboard. El ledger resuelve la tarifa por model_id, así que
// los rate params van NULL.
//
// §5.3 — fail LOUD: se await el insert y todo fallo se loguea con status + body.
// No lanza al path del usuario.
async function logLedger(
  inputUnits: number,
  outputUnits: number,
  durationMs: number,
): Promise<void> {
  if (!SB_URL || !SB_KEY) {
    console.error("[fphs-icr-apply] SUPABASE_URL/SERVICE_ROLE_KEY ausentes; no se puede escribir al ledger.");
    return;
  }
  if (inputUnits === 0 && outputUnits === 0) return;
  try {
    const res = await fetch(`${SB_URL}/rest/v1/rpc/ops_log_generation`, {
      method: "POST",
      headers: {
        "apikey": SB_KEY,
        "Authorization": `Bearer ${SB_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        p_lab: "document-factory",
        p_brand_id: "ForumPHs",
        p_job_id: null,
        p_piece_id: null,
        p_output_type: "icr_apply",
        p_platform: null,
        p_provider: "anthropic",
        p_model_id: "claude-sonnet-5",
        p_unit_type: "tokens_in", // fila combinada; la RPC resuelve in + out
        p_input_units: inputUnits,
        p_output_units: outputUnits,
        // rates NULL → ops_log_generation resuelve desde ops_lab_rates.
        p_status: "success",
        p_duration_ms: durationMs,
        p_agent_name: "fphs-icr-apply",
        p_source_app: "fphs-icr-apply",
        p_api_key_ref: "forumphs_document_factory",
      }),
    });
    if (!res.ok) {
      const bodyText = await res.text().catch(() => "(unreadable body)");
      console.error(`[fphs-icr-apply] ledger insert failed: HTTP ${res.status} — ${bodyText}`);
    }
  } catch (err) {
    console.error("[fphs-icr-apply] ledger network error:", err);
  }
}

interface ICRFinding {
  id: string;
  severity: string;
  category: string;
  section: string;
  issue: string;
  suggestion: string;
}

interface ICRDecision {
  finding_id: string;
  action: 'apply' | 'ignore' | 'edit';
  edited_instruction?: string;
}

interface Block {
  id?: string;
  speaker_name?: string;
  speaker_role?: string;
  speaker_unit?: string;
  text_formal?: string;
  skip?: boolean;
  [key: string]: unknown;
}

Deno.serve(async (req) => {
  const startedAt = Date.now();
  if (req.method === "OPTIONS") return new Response(null, { headers: CORS });

  try {
    const { blocks, findings, decisions } = await req.json() as {
      blocks: Block[];
      findings: ICRFinding[];
      decisions: ICRDecision[];
    };

    const k = Deno.env.get("forumphs_document_factory") || Deno.env.get("ANTHROPIC_API_KEY") || "";
    if (!k) return new Response(JSON.stringify({ error: "no api key" }), {
      status: 500, headers: { ...CORS, "Content-Type": "application/json" }
    });

    // Filter to apply/edit only
    const toApply = decisions.filter(d => d.action !== 'ignore');
    if (toApply.length === 0) {
      return new Response(JSON.stringify({
        success: true,
        corrected_blocks: blocks,
        applied_count: 0
      }), { headers: { ...CORS, "Content-Type": "application/json" } });
    }

    // Build corrections list
    const corrections = toApply
      .map(d => {
        const f = findings.find(x => x.id === d.finding_id);
        if (!f) return null;
        return {
          finding_id: d.finding_id,
          severity: f.severity,
          section: f.section,
          issue: f.issue,
          instruction: (d.action === 'edit' && d.edited_instruction)
            ? d.edited_instruction
            : f.suggestion
        };
      })
      .filter(Boolean);

    // Compact block summary for Claude (token-efficient)
    const blockLines = blocks.map((b, i) => {
      const txt = (b.text_formal || '').trim().substring(0, 250);
      const who = [b.speaker_name, b.speaker_role, b.speaker_unit].filter(Boolean).join(' | ');
      return `[${i}] (${who || 'N/A'}): "${txt}"${txt.length >= 250 ? '...' : ''}`;
    }).join('\n');

    const prompt = `Eres editor legal de Actas de Propiedad Horizontal en Panamá.

A continuación están los bloques formalizados del acta (índice + hablante + texto):

${blockLines}

---

CORRECCIONES A APLICAR:
${JSON.stringify(corrections, null, 2)}

---

INSTRUCCIONES:
- Para cada corrección, encuentra el/los bloques cuyo texto corresponde a la sección indicada.
- Reescribe SOLO el texto de esos bloques incorporando la corrección.
- Si la corrección requiere datos que no están en el texto (ej: número total de unidades), usa el placeholder [DATO_REQUERIDO: descripción].
- NO toques bloques que no correspondan a la corrección.
- Si una corrección afecta un encabezado o dato estructural (ej: número de acta), y no hay un bloque claro, usa block_index -1 y corrected_text con el valor corregido como nota editorial.

Responde ÚNICAMENTE JSON válido sin texto adicional:
{
  "corrections_applied": [
    {
      "block_index": <number>,
      "finding_id": "<string>",
      "corrected_text": "<texto_formal corregido completo en tercera persona>"
    }
  ]
}`;

    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": k,
        "anthropic-version": "2023-06-01"
      },
      body: JSON.stringify({
        model: "claude-sonnet-5",
        // PR-C §5 — Sonnet 5. thinking disabled; sin temperature/top_p/top_k
        // (Sonnet 5 los rechaza, incluso temperature: 0 da 400). max_tokens
        // 4000 -> 5200 (+30% para el nuevo tokenizer).
        thinking: { type: "disabled" },
        max_tokens: 5200,
        messages: [{ role: "user", content: prompt }]
      })
    });

    if (!res.ok) throw new Error("Claude API " + res.status);
    const apiData = await res.json();
    // §5.1 — capturar usage de la respuesta (antes se descartaba).
    const inputTokens = apiData.usage?.input_tokens ?? 0;
    const outputTokens = apiData.usage?.output_tokens ?? 0;
    const raw = (apiData.content || [])
      .filter((c: { type: string }) => c.type === "text")
      .map((c: { text: string }) => c.text)
      .join("")
      .trim();

    // Parse Claude response
    const clean = raw.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
    const parsed = JSON.parse(clean) as {
      corrections_applied: { block_index: number; finding_id: string; corrected_text: string }[];
    };

    // Apply to blocks array
    const corrected = blocks.map(b => ({ ...b }));
    let appliedCount = 0;
    const detail: { block_index: number; finding_id: string }[] = [];

    for (const c of parsed.corrections_applied) {
      const idx = c.block_index;
      if (idx >= 0 && idx < corrected.length && c.corrected_text) {
        corrected[idx] = {
          ...corrected[idx],
          text_formal: c.corrected_text,
          icr_corrected: true,
          icr_finding_id: c.finding_id
        };
        appliedCount++;
        detail.push({ block_index: idx, finding_id: c.finding_id });
      }
    }

    // §5.4 fiabilidad — await el ledger antes de responder, para que la fila
    // quede committeada antes de que el isolate pueda reclamarse.
    await logLedger(inputTokens, outputTokens, Date.now() - startedAt);

    return new Response(JSON.stringify({
      success: true,
      corrected_blocks: corrected,
      applied_count: appliedCount,
      corrections_detail: detail
    }), { headers: { ...CORS, "Content-Type": "application/json" } });

  } catch (e) {
    return new Response(JSON.stringify({ error: String(e) }), {
      status: 500, headers: { ...CORS, "Content-Type": "application/json" }
    });
  }
});
