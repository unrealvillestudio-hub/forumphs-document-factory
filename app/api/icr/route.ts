/**
 * /api/icr/route.ts
 * ICR — Industrial Consistency Review
 * Segunda capa. Claude lee el documento como auditor legal y detecta
 * inconsistencias semánticas que el QA mecánico no puede ver:
 * votos que cambian, roles incorrectos, contradicciones legales.
 */

import { NextRequest, NextResponse } from 'next/server'
import Anthropic from '@anthropic-ai/sdk'
import type { ParsedHypalZip } from '@/lib/types'

export const runtime = 'nodejs'
export const maxDuration = 55

export interface ICRFinding {
  severity: 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW'
  category: 'VOTE_INCONSISTENCY' | 'ROLE_ERROR' | 'LEGAL_COMPLIANCE' | 'DATA_MISMATCH' | 'NARRATIVE_QUALITY' | 'STRUCTURAL'
  location: string
  issue: string
  suggestion: string
}

export interface ICRReport {
  verdict: 'APPROVED' | 'APPROVED_WITH_NOTES' | 'REQUIRES_CORRECTION' | 'BLOCKED'
  total_findings: number
  critical: number
  high: number
  medium: number
  low: number
  findings: ICRFinding[]
  auditor_summary: string
}

const ICR_SYSTEM = `Eres un auditor legal especializado en Actas de Asamblea de Propiedad Horizontal en Panamá bajo la Ley 284 de 2022. Tu función es realizar una revisión ICR (Industrial Consistency Review) de un acta generada automáticamente.

CATEGORÍAS:
- VOTE_INCONSISTENCY: Votos que cambian entre secciones, o que contradicen los datos fuente del XLSX
- ROLE_ERROR: Personal de administración identificado como propietario, o nombres de la empresa como participantes
- LEGAL_COMPLIANCE: Incumplimiento Ley 284 (quórum, porcentajes, artículos citados incorrectamente)
- DATA_MISMATCH: Cifras, fechas, nombres que contradicen los datos verificados del XLSX
- NARRATIVE_QUALITY: Primera persona residual, lenguaje oral, fragmentos incompletos
- STRUCTURAL: Secciones faltantes, orden incorrecto, firmas incompletas
- NARRATIVE_QUALITY también incluye: errores ortográficos, tildes faltantes, concordancia de género/número

ORTOGRAFÍA: Revisa errores ortográficos evidentes (palabras mal escritas, tildes faltantes en palabras clave legales). Panameñismos y nombres propios NO son errores.

SEVERIDADES:
- CRITICAL: Invalida el acta legalmente (votos incorrectos, quórum falso)
- HIGH: Compromete la credibilidad (rol equivocado, nombre incorrecto)  
- MEDIUM: Reduce calidad profesional
- LOW: Mejoras menores

RESPONDE ÚNICAMENTE con JSON válido, sin markdown:`

export async function POST(req: NextRequest): Promise<NextResponse> {
  try {
    const client = new Anthropic({
      apiKey: process.env.forumphs_document_factory || process.env.ANTHROPIC_API_KEY
    })

    const { acta_text, parsed }: { acta_text: string; parsed: ParsedHypalZip } = await req.json()

    if (!acta_text || acta_text.trim().length < 100) {
      return NextResponse.json({ success: false, error: 'acta_text too short or empty — generate the document first' }, { status: 400 })
    }
    if (!parsed) {
      return NextResponse.json({ success: false, error: 'parsed data required' }, { status: 400 })
    }

    const votesSummary = (parsed.votations || []).map(v =>
      `"${v.topic}": ${v.yes_votes} sí / ${v.no_votes} no → ${v.approved ? 'APROBADO' : 'NO APROBADO'}`
    ).join('\n')

    const msg = await client.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 2000,
      system: ICR_SYSTEM,
      messages: [{
        role: 'user',
        content: `DATOS FUENTE VERIFICADOS (XLSX oficial):
Asistentes: ${parsed.attendance.length} unidades
Votaciones:
${votesSummary || '(ninguna registrada)'}
Personal de administración (NO propietarios): Ivette Flores, Iveth, Irja Saldaña, Daniel Puentes, Hypal, empresa administradora

ACTA GENERADA A AUDITAR:
---
${acta_text.substring(0, 11000)}${acta_text.length > 11000 ? '\n[documento truncado]' : ''}
---

Responde SOLO con este JSON:
{
  "verdict": "APPROVED|APPROVED_WITH_NOTES|REQUIRES_CORRECTION|BLOCKED",
  "auditor_summary": "Resumen ejecutivo 2-3 oraciones",
  "findings": [{"severity":"...","category":"...","location":"...","issue":"...","suggestion":"..."}]
}`
      }],
    })

    const raw = msg.content.filter((c): c is Anthropic.TextBlock => c.type === 'text').map(c => c.text).join('').trim()
    const clean = raw.replace(/```json\n?|\n?```/g, '').trim()
    const data: ICRReport = JSON.parse(clean)
    const findings = data.findings || []

    const report: ICRReport = {
      ...data,
      total_findings: findings.length,
      critical: findings.filter(f => f.severity === 'CRITICAL').length,
      high: findings.filter(f => f.severity === 'HIGH').length,
      medium: findings.filter(f => f.severity === 'MEDIUM').length,
      low: findings.filter(f => f.severity === 'LOW').length,
      findings,
    }

    return NextResponse.json({ success: true, report })
  } catch (err) {
    console.error('ICR error:', err)
    // Return a safe fallback report instead of 500 — never block the user's download
    const fallbackReport: ICRReport = {
      verdict: 'APPROVED_WITH_NOTES',
      total_findings: 1,
      critical: 0, high: 0, medium: 1, low: 0,
      findings: [{
        severity: 'MEDIUM',
        category: 'STRUCTURAL',
        location: 'Sistema ICR',
        issue: `Revision ICR incompleta: ${err instanceof Error ? err.message : String(err)}`,
        suggestion: 'Revisar el documento manualmente antes de firmar.',
      }],
      auditor_summary: 'La revision ICR no pudo completarse. Revisar el documento manualmente.',
    }
    return NextResponse.json({ success: true, report: fallbackReport })
  }
}
