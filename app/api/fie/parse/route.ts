// app/api/fie/parse/route.ts
// Normalizer: .xlsx / .pdf → FIE JSON Schema
// Estrategia: extrae raw data → Claude mapea al schema fijo

import { NextRequest, NextResponse } from 'next/server'
import * as XLSX from 'xlsx'
import { logLedger } from '@/lib/server/ledger'

const ANTHROPIC_API_URL = 'https://api.anthropic.com/v1/messages'

// ── FIE JSON Schema prompt ────────────────────────────────────────
const SCHEMA_PROMPT = `Eres el Normalizer del Financial Intelligence Engine de ForumPHs.

Tu tarea: extraer datos financieros del texto/tabla proporcionado y mapearlos al siguiente JSON schema exacto.

SCHEMA (devuelve SOLO este JSON, sin markdown, sin texto adicional):
{
  "building_name": string,       // nombre del PH o empresa
  "period_label": string,        // ej: "Enero–Febrero 2026"
  "eeff_months": [               // array, un objeto por mes encontrado
    {
      "month": string,           // "Ene 2026"
      "ingresos": number,
      "gastos": number,
      "utilidad": number,        // ingresos - gastos
      "margen": number           // (utilidad/ingresos)*100, con 1 decimal
    }
  ],
  "cost_breakdown": {            // desglose de costos (promedios si hay varios meses)
    "salarios": number,          // planilla, sueldos
    "css": number,               // CSS, seguro social, cuota obrero-patronal
    "honorarios": number,        // honorarios profesionales, consultores
    "viaticos": number,          // viáticos, transporte, movilización
    "servicios": number,         // servicios externos, proveedores, facturas
    "stack": number,             // tecnología, software, plataformas
    "otros": number              // cualquier otro gasto no clasificado arriba
  },
  "base_income": number,         // ingresos mensuales recurrentes normales
  "base_ops": number,            // gastos operativos base mensuales
  "labor_res_monthly": number,   // reservas laborales mensuales (si se menciona)
  "contingency_monthly": number, // contingencia mensual (si se menciona)
  "historic_liability": number   // pasivo laboral histórico total (si se menciona)
}

REGLAS:
- Si un valor no se encuentra, usa 0 (nunca null ni undefined)
- Los montos siempre en números float sin símbolo de moneda
- Si hay múltiples períodos, incluye todos en eeff_months
- Infiere building_name del encabezado o nombre del archivo
- Si no hay desglose de costos, distribuye el total de gastos proporcionalmente entre las categorías estándar
- Devuelve ÚNICAMENTE el JSON, nada más`

// ── Extraer texto de XLSX ────────────────────────────────────────
function xlsxToText(buffer: Buffer): string {
  const workbook = XLSX.read(buffer, { type: 'buffer' })
  const lines: string[] = []

  for (const sheetName of workbook.SheetNames) {
    lines.push(`=== Hoja: ${sheetName} ===`)
    const sheet    = workbook.Sheets[sheetName]
    const csvText  = XLSX.utils.sheet_to_csv(sheet, { blankrows: false })
    // Limpiar líneas vacías
    const cleaned  = csvText
      .split('\n')
      .filter(l => l.replace(/,/g, '').trim().length > 0)
      .slice(0, 200)  // max 200 filas
      .join('\n')
    lines.push(cleaned)
  }

  return lines.join('\n\n')
}

// ── POST handler ─────────────────────────────────────────────────
export async function POST(req: NextRequest) {
  try {
    const formData = await req.formData()
    const file     = formData.get('file') as File | null
    const jobId    = (formData.get('job_id') as string | null) ?? null

    if (!file) {
      return NextResponse.json({ error: 'No se recibió archivo' }, { status: 400 })
    }

    const bytes  = await file.arrayBuffer()
    const buffer = Buffer.from(bytes)
    const name   = file.name.toLowerCase()

    // ── Extraer texto ─────────────────────────────────────────
    let rawText = ''

    if (name.endsWith('.xlsx') || name.endsWith('.xls')) {
      rawText = xlsxToText(buffer)
    } else if (name.endsWith('.csv')) {
      rawText = buffer.toString('utf-8').split('\n').slice(0, 200).join('\n')
    } else if (name.endsWith('.pdf')) {
      // PDF: enviar como base64 a Claude con vision
      const base64 = buffer.toString('base64')
      return await parsePDF(base64, name, jobId)
    } else {
      return NextResponse.json({ error: 'Formato no soportado (.xlsx, .xls, .csv, .pdf)' }, { status: 400 })
    }

    // ── Llamar a Claude para normalizar ──────────────────────
    const schema = await normalizeWithClaude(rawText, name, jobId)
    return NextResponse.json({ schema, raw_preview: rawText.slice(0, 800) })

  } catch (err: unknown) {
    console.error('[FIE parse]', err)
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Error procesando archivo' },
      { status: 500 }
    )
  }
}

// ── PDF via Claude vision ────────────────────────────────────────
async function parsePDF(base64: string, filename: string, jobId: string | null) {
  const apiKey = process.env.ANTHROPIC_API_KEY
  if (!apiKey) throw new Error('ANTHROPIC_API_KEY no configurada')

  const startedAt = Date.now()
  const res = await fetch(ANTHROPIC_API_URL, {
    method: 'POST',
    headers: {
      'Content-Type':      'application/json',
      'x-api-key':         apiKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      // PR-C §5 — Sonnet 5 (claude-sonnet-4-20250514 retirado). thinking disabled;
      // sin temperature/top_p/top_k (Sonnet 5 los rechaza); max_tokens 2000 -> 2600 (+30%).
      model:      'claude-sonnet-5',
      thinking:   { type: 'disabled' },
      max_tokens: 2600,
      messages: [
        {
          role: 'user',
          content: [
            {
              type:   'document',
              source: { type: 'base64', media_type: 'application/pdf', data: base64 },
            },
            {
              type: 'text',
              text: `Archivo: ${filename}\n\n${SCHEMA_PROMPT}`,
            },
          ],
        },
      ],
    }),
  })

  if (!res.ok) {
    const errBody = await res.text().catch(() => '(unreadable)')
    console.error(`[FIE parse:pdf] Claude HTTP ${res.status}: ${errBody}`)
    throw new Error(`Anthropic API error ${res.status}`)
  }
  const data = await res.json()
  const text = data.content?.[0]?.text ?? '{}'
  const schema = JSON.parse(text.replace(/```json|```/g, '').trim())
  await logLedger({
    lab:         'fie',
    sourceApp:   'fphs-fie-parse',
    modelId:     'claude-sonnet-5',
    inputUnits:  data.usage?.input_tokens  ?? 0,
    outputUnits: data.usage?.output_tokens ?? 0,
    jobId,
    outputType:  'fie_parse_pdf',
    durationMs:  Date.now() - startedAt,
    status:      'success',
    apiKeyRef:   'ANTHROPIC_API_KEY',
  })
  return NextResponse.json({ schema, raw_preview: 'PDF procesado con Claude Vision' })
}

// ── Normalizar texto con Claude ──────────────────────────────────
async function normalizeWithClaude(rawText: string, filename: string, jobId: string | null) {
  const apiKey = process.env.ANTHROPIC_API_KEY
  if (!apiKey) throw new Error('ANTHROPIC_API_KEY no configurada')

  const startedAt = Date.now()
  const res = await fetch(ANTHROPIC_API_URL, {
    method: 'POST',
    headers: {
      'Content-Type':      'application/json',
      'x-api-key':         apiKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      // PR-C §5 — Sonnet 5 (claude-sonnet-4-20250514 retirado). thinking disabled;
      // sin temperature/top_p/top_k (Sonnet 5 los rechaza); max_tokens 2000 -> 2600 (+30%).
      model:      'claude-sonnet-5',
      thinking:   { type: 'disabled' },
      max_tokens: 2600,
      messages: [
        {
          role: 'user',
          content: `Archivo: ${filename}\n\nDatos extraídos:\n\n${rawText}\n\n${SCHEMA_PROMPT}`,
        },
      ],
    }),
  })

  if (!res.ok) {
    const errBody = await res.text().catch(() => '(unreadable)')
    console.error(`[FIE parse:xlsx] Claude HTTP ${res.status}: ${errBody}`)
    throw new Error(`Anthropic API error ${res.status}`)
  }
  const data   = await res.json()
  const text   = data.content?.[0]?.text ?? '{}'
  const schema = JSON.parse(text.replace(/```json|```/g, '').trim())
  await logLedger({
    lab:         'fie',
    sourceApp:   'fphs-fie-parse',
    modelId:     'claude-sonnet-5',
    inputUnits:  data.usage?.input_tokens  ?? 0,
    outputUnits: data.usage?.output_tokens ?? 0,
    jobId,
    outputType:  'fie_parse_xlsx',
    durationMs:  Date.now() - startedAt,
    status:      'success',
    apiKeyRef:   'ANTHROPIC_API_KEY',
  })
  return schema
}
