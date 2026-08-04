// app/api/fie/generate/route.ts
// FIE JSON schema → Claude narrativa → HTML 7 paneles + simulador

import { NextRequest, NextResponse } from 'next/server'
import { generateFIEHtml } from '@/lib/fie/template'
import type { FIESchema } from '@/lib/fie/schema'
import { logLedger } from '@/lib/server/ledger'

const ANTHROPIC_API_URL = 'https://api.anthropic.com/v1/messages'

// ── Prompt narrativa ─────────────────────────────────────────────
function narrativePrompt(schema: FIESchema): string {
  const avg = schema.eeff_months.length
    ? schema.eeff_months.reduce((s, m) => s + m.margen, 0) / schema.eeff_months.length
    : 0

  return `Eres el analista financiero de ForumPHs. Vas a generar la narrativa de 6 paneles del informe FIE para ${schema.building_name} (${schema.period_label}).

Contexto financiero:
- Margen promedio: ${avg.toFixed(1)}%
- Ingresos base: $${schema.base_income.toLocaleString('en-US')}
- Pasivo laboral histórico: $${schema.historic_liability.toLocaleString('en-US')}
- Brecha hacia umbral de sostenibilidad ($20,500/mes): $${Math.max(0, 20500 - schema.base_income).toLocaleString('en-US')}

Genera una narrativa ejecutiva CORTA (2-3 oraciones máximo) para cada panel. Tono: profesional-patrimonial, no genérico. Sin bullet points. Sin markdown.

Responde SOLO con este JSON (sin markdown, sin texto adicional):
{
  "panel_01": "...",
  "panel_02": "...",
  "panel_03": "...",
  "panel_04": "...",
  "panel_05": "...",
  "panel_06": "..."
}

Lineamientos por panel:
- panel_01: comparativa de tendencias entre períodos — ¿mejora o deterioro?
- panel_02: lectura del último mes — ¿qué revela el margen?
- panel_03: estructura de costos — ¿dónde está la mayor presión?
- panel_04: estado de los 4 fondos — ¿cuáles están activos, cuáles pendientes?
- panel_05: escenarios — ¿cuál es el camino más realista?
- panel_06: hoja de ruta — ¿qué hito es más urgente?`
}

// ── POST handler ─────────────────────────────────────────────────
export async function POST(req: NextRequest) {
  try {
    const body: { schema: FIESchema; job_id?: string } = await req.json()
    const { schema, job_id } = body

    if (!schema?.building_name) {
      return NextResponse.json({ error: 'Schema FIE inválido o incompleto' }, { status: 400 })
    }

    const apiKey = process.env.ANTHROPIC_API_KEY
    if (!apiKey) {
      // Sin API key: generar HTML sin narrativa (útil para preview)
      const html = generateFIEHtml(schema)
      return new NextResponse(html, {
        headers: {
          'Content-Type':        'text/html; charset=utf-8',
          'Content-Disposition': `attachment; filename="FIE_${schema.building_name.replace(/ /g, '_')}_${schema.period_label.replace(/ /g, '_')}.html"`,
        },
      })
    }

    // ── Generar narrativa con Claude ──────────────────────────
    let narrative: FIESchema['narrative'] = {}

    const startedAt = Date.now()
    try {
      const res = await fetch(ANTHROPIC_API_URL, {
        method: 'POST',
        headers: {
          'Content-Type':      'application/json',
          'x-api-key':         apiKey,
          'anthropic-version': '2023-06-01',
        },
        body: JSON.stringify({
          // PR-C §5 — Sonnet 5 (claude-sonnet-4-20250514 retirado). thinking disabled
          // (redacción determinista; mantiene los thinking tokens fuera de max_tokens);
          // sin temperature/top_p/top_k (el endpoint de Sonnet 5 los rechaza, incluso
          // temperature: 0 da 400); max_tokens 1000 -> 1300 (+30% para el tokenizer nuevo).
          model:      'claude-sonnet-5',
          thinking:   { type: 'disabled' },
          max_tokens: 1300,
          messages: [{ role: 'user', content: narrativePrompt(schema) }],
        }),
      })

      if (res.ok) {
        const data = await res.json()
        const text = data.content?.[0]?.text ?? '{}'
        narrative  = JSON.parse(text.replace(/```json|```/g, '').trim())
        // Instrumentación (patrón T5/T6): registra el consumo real. FIE usa
        // ANTHROPIC_API_KEY (no forumphs_document_factory) => superficie de costo
        // separada. lab='fie', source_app='fphs-fie-generate'. await + fail-loud
        // (status+body) los aporta logLedger; no lanza al path del usuario.
        await logLedger({
          lab:         'fie',
          sourceApp:   'fphs-fie-generate',
          modelId:     'claude-sonnet-5',
          inputUnits:  data.usage?.input_tokens  ?? 0,
          outputUnits: data.usage?.output_tokens ?? 0,
          jobId:       job_id ?? null,
          outputType:  'informe_fie',
          durationMs:  Date.now() - startedAt,
          status:      'success',
          apiKeyRef:   'ANTHROPIC_API_KEY',
        })
      } else {
        const errBody = await res.text().catch(() => '(unreadable)')
        console.error(`[FIE generate] Claude HTTP ${res.status}: ${errBody}`)
      }
    } catch (narrativeErr) {
      // Narrativa falla: continuar sin ella (HTML igual válido)
      console.warn('[FIE generate] Narrativa falló, continuando sin ella:', narrativeErr)
    }

    // ── Generar HTML ─────────────────────────────────────────
    const schemaWithNarrative: FIESchema = { ...schema, narrative }
    const html = generateFIEHtml(schemaWithNarrative)

    const safeName   = schema.building_name.replace(/[^a-zA-Z0-9]/g, '_')
    const safePeriod = schema.period_label.replace(/[^a-zA-Z0-9]/g, '_')

    return new NextResponse(html, {
      headers: {
        'Content-Type':        'text/html; charset=utf-8',
        'Content-Disposition': `attachment; filename="FIE_${safeName}_${safePeriod}.html"`,
      },
    })

  } catch (err: unknown) {
    console.error('[FIE generate]', err)
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Error generando informe' },
      { status: 500 }
    )
  }
}
