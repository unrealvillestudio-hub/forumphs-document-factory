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
import { loadAdminPersonnel, adminPersonnelToPromptList } from '@/lib/processors/actaConfig'

export const runtime = 'nodejs'
export const maxDuration = 120

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

const LEY_284_RULES = `CONOCIMIENTO LEY 284 DE 2022 (reglas verificables — contrasta el acta contra ellas):
- CONVOCATORIA (Art. 62, 64): debe constar la convocatoria, su forma (correo, aviso físico) y antelación. Una asamblea sin convocatoria válida es impugnable.
- QUÓRUM PRIMER LLAMADO (Art. 67): se requiere más de la mitad de los propietarios (mitad más uno). Si el acta dice que con MENOS de la mitad se inició en primer llamado, es CRITICAL.
- SEGUNDO LLAMADO (Art. 67): si no hubo quórum en el primero, se puede sesionar en segundo llamado con los presentes, SIEMPRE que el acta lo documente. Verifica coherencia entre el quórum reportado y el llamado declarado.
- MAYORÍAS (Art. 83 y relacionados): las decisiones ordinarias se adoptan por mayoría de los presentes; ciertas decisiones (cuotas extraordinarias, modificación de reglamento, gastos mayores) pueden requerir mayorías calificadas. Si un porcentaje aprobatorio reportado no alcanza el umbral citado en el propio acta, es HIGH o CRITICAL.
- COHERENCIA NUMÉRICA: los votos a favor + en contra + abstenciones no deben superar el total de presentes/habilitados. Un porcentaje debe ser consistente con los votos sobre el total declarado.
- FINCA: cada unidad lleva su finca individual. Unidades marcadas [FINCA PENDIENTE] deben señalarse para completar (DATA_MISMATCH, no bloqueante).
NO inventes números: el generador ya calculó conteos y porcentajes de forma determinística. Tu rol es verificar COHERENCIA y CUMPLIMIENTO, no recalcular.`

const ICR_SYSTEM = `Eres el Agente Experto ForumPHs: auditor legal especializado en Actas de Asamblea de Propiedad Horizontal en Panamá bajo la Ley 284 de 2022. Realizas una revisión ICR (Industrial Consistency Review) del acta completa generada automáticamente.

${LEY_284_RULES}

CATEGORÍAS:
- VOTE_INCONSISTENCY: Votos que cambian entre secciones, o que contradicen los datos fuente del XLSX
- ROLE_ERROR: Personal de administración identificado como propietario, o nombres de la empresa como participantes
- LEGAL_COMPLIANCE: Incumplimiento Ley 284 (quórum, porcentajes, artículos citados incorrectamente)
- DATA_MISMATCH: Cifras, fechas, nombres que contradicen los datos verificados del XLSX, o fincas pendientes
- NARRATIVE_QUALITY: Primera persona residual, lenguaje oral, fragmentos incompletos, errores ortográficos, tildes faltantes, concordancia de género/número
- STRUCTURAL: Secciones faltantes, orden incorrecto, firmas incompletas

ORTOGRAFÍA: Revisa errores ortográficos evidentes (palabras mal escritas, tildes faltantes en palabras clave legales). Panameñismos y nombres propios NO son errores.

SEVERIDADES:
- CRITICAL: Invalida el acta legalmente (votos incorrectos, quórum falso, mayoría insuficiente declarada como aprobada)
- HIGH: Compromete la credibilidad (rol equivocado, nombre incorrecto, porcentaje incoherente)
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

    // Admin personnel from config (DATA, not hardcode). Falls back internally.
    const buildingId = parsed.skeleton?.building_id
    const adminPeople = await loadAdminPersonnel(buildingId)
    const adminList = adminPersonnelToPromptList(adminPeople)

    // Full-document audit. The acta fits comfortably in context; auditing only
    // 60% (the old cap) missed findings in the tail (closing, signatures, late
    // votes). Cap generously to stay within model limits but cover the whole doc.
    const MAX_INPUT_CHARS = 60000  // ~48k tokens — full acta in practice
    const actaForAudit = acta_text.length > MAX_INPUT_CHARS
      ? acta_text.substring(0, MAX_INPUT_CHARS) + `\n[... acta excede ${MAX_INPUT_CHARS} caracteres; auditados los primeros ${MAX_INPUT_CHARS} ...]`
      : acta_text
    const coveragePct = Math.round((Math.min(acta_text.length, MAX_INPUT_CHARS) / acta_text.length) * 100)

    // Scale output tokens with document size, capped for cost/latency.
    const dynamicMaxTokens = Math.min(8000, 4000 + Math.floor(actaForAudit.length / 5000) * 400)

    const msg = await client.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: dynamicMaxTokens,
      system: ICR_SYSTEM,
      messages: [{
        role: 'user',
        content: `DATOS FUENTE VERIFICADOS (XLSX oficial):
Asistentes: ${parsed.attendance.length} unidades
Votaciones:
${votesSummary || '(ninguna registrada)'}
Personal de administración (NO son propietarios; si aparecen como propietarios o votantes es ROLE_ERROR): ${adminList}

Cobertura de auditoría: ${coveragePct}% del documento.

ACTA GENERADA A AUDITAR:
---
${actaForAudit}
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
