import "jsr:@supabase/functions-js/edge-runtime.d.ts";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS"
};

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
        model: "claude-sonnet-4-6",
        max_tokens: 4000,
        messages: [{ role: "user", content: prompt }]
      })
    });

    if (!res.ok) throw new Error("Claude API " + res.status);
    const apiData = await res.json();
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
