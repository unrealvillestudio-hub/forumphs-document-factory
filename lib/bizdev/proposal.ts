/**
 * proposal.ts — Carta de propuesta para la Junta Directiva (texto y .docx).
 *
 * Reglas de BRIEF_DF_BizDev_2026-11-02.md §5 (Propuesta) y decisión de Sam del 2026-11-02:
 *   - El margen y los costos NO salen nunca en la carta.
 *   - El personal incluido en el precio base NO se menciona («vendemos servicio, no horas»).
 *   - Si hay personal agregado: «Personal adicional a solicitud de la Junta: N persona(s)» con su monto
 *     (se presenta como «tier + personal adicional a solicitud de la Junta»).
 */
import { Document, Packer, Paragraph, TextRun, AlignmentType } from 'docx'
import { TIER_NOMBRES, tierPorPrecio, cents, type FeeResult, type FeeParams } from './feeModel'

/**
 * Servicios incluidos en todos los tiers.
 * FUENTE: unrlvl-context/brands/ForumPHs/brand.json → services_model.servicios_incluidos_todos_los_tiers
 * (modelo de servicios v5, decidido por Sam el 2026-10-04 y el 2026-10-06). Copiado el 2026-11-02.
 * Si brand.json cambia, esta lista se actualiza en el mismo PR que lo refleje.
 */
export const SERVICIOS_INCLUIDOS: readonly string[] = [
  'Administración general y supervisión operativa',
  'Suite BI + informe mensual de gestión el día 5',
  'Proyección financiera anual y presupuesto para la Asamblea; en el cierre anual, proyección a 3–5 años',
  'Cumplimiento de la Ley vigente de Régimen de Propiedad Horizontal',
  'Asesoría legal a la Junta Directiva por abogada idónea, hasta 50 horas al año',
  'Asistencia a todas las asambleas, ordinarias y extraordinarias (obligatoria por ley), con actas con validez legal',
  'Gestión de la cartera morosa en Fases I, II y III, hasta donde corresponde al Administrador',
  'Preparación del escrito de inscripción en el Registro Público',
  'Elaboración o actualización del reglamento de copropiedad',
  'Diagnóstico inicial del PH, sin costo, tras la firma del contrato y la entrega de la información',
  'ForumPHs Speaks',
  'Portal de Propietarios',
]

export const FIRMA = { nombre: 'Ivette Flores', cargo: 'Representante Legal · ForumPHs' }

const usd = (n: number, d = 2) => n.toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d })
const fmtPersonas = (p: number) => `${usd(p, p % 1 === 0 ? 0 : 1)} ${p === 1 ? 'persona' : 'personas'}`

export interface LetterInput {
  ph: string
  u: number
  m2: number
  casas: boolean
  result: FeeResult
  /** Índice del margen elegido en result.margenes. */
  sel: number
  itbms: number
}

export interface LetterAmounts {
  tier: string
  base: number
  adicional: number
  honorario: number
  itbms: number
  total: number
}

/** Tier con que se presenta: el del precio base al margen elegido, nunca «bajo el piso». */
export function letterAmounts(params: Pick<FeeParams, 'tiers'>, i: LetterInput): LetterAmounts {
  // Todo en centavos: cada línea de la carta es un monto redondeado y el total es su suma exacta.
  const base = cents(i.result.honorariosBase[i.sel])
  const honorario = cents(i.result.honorarios[i.sel])
  const t = Math.max(1, tierPorPrecio(params as FeeParams, i.result.honorariosBase[i.sel])) as 1 | 2 | 3
  const it = cents(honorario * i.itbms)
  return { tier: TIER_NOMBRES[t], base, adicional: cents(honorario - base), honorario, itbms: it, total: cents(honorario + it) }
}

/** Párrafos de la carta, en orden. Una línea vacía separa bloques. */
export function letterParagraphs(i: LetterInput, a: LetterAmounts): string[] {
  const ph = (i.ph || 'el PH').trim()
  const tam = `${i.u} unidades` + (i.casas || !i.m2 ? '' : ` y ${usd(i.m2)} m² privados según el Registro Público`)
  const lines: string[] = [
    `Estimados miembros de la Junta Directiva de ${ph}:`,
    '',
    'Gracias por la oportunidad de presentarles nuestra propuesta de administración.',
    '',
    `Con ${tam}, ${ph} corresponde a nuestro tier ${a.tier.toUpperCase()}. Los tres tiers de ForumPHs entregan exactamente los mismos servicios: el tier solo fija el honorario según la escala del PH.`,
    '',
    `Honorario mensual de administración: $${usd(a.base)}`,
  ]
  if (i.result.extraPersonas > 0 && a.adicional > 0) {
    lines.push(`Personal adicional a solicitud de la Junta: ${fmtPersonas(i.result.extraPersonas)} — $${usd(a.adicional)}`)
    lines.push(`Total honorario mensual: $${usd(a.honorario)}`)
  }
  lines.push(
    `ITBMS (${Math.round(i.itbms * 100)} %): $${usd(a.itbms)}`,
    `Total mensual: $${usd(a.total)}`,
    '',
    'El honorario incluye:',
    ...SERVICIOS_INCLUIDOS.map(s => `• ${s}`),
    '',
    'Contratan un servicio, no las horas de una persona. Los cobros van por ACH directo a la cuenta del PH, y la gestión de la cartera morosa no tiene cargo adicional ni comisión sobre lo recuperado.',
    '',
    'Quedamos atentos para resolver sus preguntas.',
    '',
    'Atentamente,',
    FIRMA.nombre,
    FIRMA.cargo,
  )
  return lines
}

/** Texto plano de la carta (para «Copiar texto»). */
export function buildLetter(i: LetterInput, params: Pick<FeeParams, 'tiers'>): string {
  return letterParagraphs(i, letterAmounts(params, i)).join('\n')
}

/** .docx de la carta (para «Descargar .docx»). Corre en el navegador. */
export async function buildProposalDocx(i: LetterInput, params: Pick<FeeParams, 'tiers'>): Promise<Blob> {
  const a = letterAmounts(params, i)
  const lines = letterParagraphs(i, a)
  const fecha = new Date().toLocaleDateString('es-PA', { day: 'numeric', month: 'long', year: 'numeric' })
  const body = lines.map(l => new Paragraph({
    spacing: { after: l === '' ? 0 : 80 },
    children: [new TextRun({
      text: l,
      font: 'EB Garamond',
      size: 24,
      bold: /^(Honorario mensual|Total mensual|Total honorario)/.test(l),
    })],
  }))
  const doc = new Document({
    creator: 'ForumPHs',
    title: `Propuesta de administración — ${i.ph}`,
    sections: [{
      children: [
        new Paragraph({
          alignment: AlignmentType.LEFT,
          children: [
            new TextRun({ text: 'Forum', font: 'EB Garamond', size: 32, color: '1C2233' }),
            new TextRun({ text: 'PHs', font: 'DM Sans', size: 28, bold: true, color: 'C4622D' }),
          ],
        }),
        new Paragraph({
          spacing: { after: 240 },
          children: [new TextRun({ text: 'PROPUESTA DE ADMINISTRACIÓN', font: 'Cinzel', size: 18, color: 'C4622D' })],
        }),
        new Paragraph({
          spacing: { after: 240 },
          children: [new TextRun({ text: `Panamá, ${fecha}`, font: 'EB Garamond', size: 22, color: '5C3472' })],
        }),
        ...body,
      ],
    }],
  })
  return Packer.toBlob(doc)
}
