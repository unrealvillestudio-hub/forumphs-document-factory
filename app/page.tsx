'use client'

import { useState } from 'react'
import UploadZone from '@/components/UploadZone'
import PreflightForm from '@/components/PreflightForm'
import ProcessingPipeline from '@/components/ProcessingPipeline'
import QAReportView from '@/components/QAReport'
import ICRReportView from '@/components/ICRReport'
import type { ExtractedData } from '@/lib/zipExtractor'
import type {
  ParsedHypalZip,
  PreflightData,
  PreflightGap,
  DebateBlock,
  ParseResponse,
  GenerateResponse,
  ICRReport,
  ICRFinding,
} from '@/lib/types'

type Step =
  | 'upload'
  | 'parsing'
  | 'preflight'
  | 'formalize'
  | 'generating'
  | 'qa'
  | 'icr_review'
  | 'error'

const PHASES: { keys: Step[]; label: string }[] = [
  { keys: ['upload', 'parsing'], label: 'Cargar' },
  { keys: ['preflight'], label: 'Pre-flight' },
  { keys: ['formalize'], label: 'Formalizar' },
  { keys: ['generating'], label: 'Generar' },
  { keys: ['qa', 'icr_review'], label: 'QA · ICR' },
]

// Progressive QA re-run sweeps: sweep 1 = attempt 0 … up to MAX_SWEEPS.
// Each sweep raises the Edge Function formalization tolerance (retryAttempt)
// and relaxes the QA scanner thresholds, so the completeness score can climb.
const MAX_SWEEPS = 4

// ── Answer coercion helpers (Pre-flight values arrive as string|number|boolean) ──
const asText = (v: string | number | boolean | undefined): string | undefined =>
  v === undefined || v === '' ? undefined : String(v)

const asNum = (v: string | number | boolean | undefined): number | undefined => {
  if (v === undefined || v === '') return undefined
  const n = Number(v)
  return Number.isNaN(n) ? undefined : n
}

export default function DocumentFactoryPage() {
  const [step, setStep]               = useState<Step>('upload')
  const [parsed, setParsed]           = useState<ParsedHypalZip | null>(null)
  const [gaps, setGaps]               = useState<PreflightGap[]>([])
  const [preflight, setPreflight]     = useState<PreflightData | null>(null)
  const [icrReport, setIcrReport]     = useState<ICRReport | null>(null)
  const [icrLoading, setIcrLoading]   = useState(false)
  const [gen, setGen]                 = useState<GenerateResponse | null>(null)
  const [error, setError]             = useState('')
  const [retry, setRetry]             = useState(0)

  const activeIdx = PHASES.findIndex(p => p.keys.includes(step))

  // ── 1 · Upload → /api/parse ──────────────────────────────────────────────
  const handleDataReady = async (data: ExtractedData) => {
    setStep('parsing'); setError('')
    try {
      const payload = JSON.stringify({
        resumen:         data.resumen,
        transcripcion:   data.transcripcion,
        asistencia_rows: data.asistencia_rows,
        votaciones_rows: data.votaciones_rows,
        chats:           data.chats,
        images:          data.images,
      })

      // Capa 2 — payload guard. Serverless body cap is ~4.5 MB; base64 images
      // dominate the size. The client extractor already downscales images, but
      // if an unusually image-heavy package is still over the safe ceiling we
      // fail with a CLEAR, actionable message instead of letting the function
      // return a plain-text 413 that the old code blindly JSON.parse'd
      // ("Unexpected token 'R'").
      const SAFE_BODY_BYTES = 4 * 1024 * 1024  // 4 MB headroom under the 4.5 cap
      const payloadBytes = new Blob([payload]).size
      if (payloadBytes > SAFE_BODY_BYTES) {
        const mb = (payloadBytes / (1024 * 1024)).toFixed(1)
        throw new Error(
          `El paquete es demasiado grande (${mb} MB) incluso tras optimizar las ` +
          `imágenes. Probá quitando del ZIP las imágenes no esenciales (capturas ` +
          `de logística/Hypal) y volvé a subirlo.`
        )
      }

      const res = await fetch('/api/parse', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: payload,
      })

      // Robust response handling: a 413 (or any infra error) comes back as plain
      // text, not JSON. Never call res.json() blind — read text, then parse.
      const raw = await res.text()
      let json: ParseResponse | null = null
      try { json = raw ? (JSON.parse(raw) as ParseResponse) : null } catch { json = null }
      if (!res.ok || !json || !json.success || !json.parsed) {
        if (res.status === 413) {
          throw new Error(
            'El servidor rechazó el paquete por tamaño (413). Quitá del ZIP las ' +
            'imágenes no esenciales y volvé a intentarlo.'
          )
        }
        throw new Error(json?.error || `El análisis falló (HTTP ${res.status})`)
      }
      setParsed(json.parsed)
      setGaps(json.preflight_gaps || [])
      setStep('preflight')
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Error al analizar los documentos')
      setStep('error')
    }
  }

  // ── 2 · Pre-flight → collect operator answers ────────────────────────────
  const buildPreflight = (
    answers: Record<string, string | number | boolean>,
    informe?: string,
  ): PreflightData => ({
    finca:                   asText(answers.finca),
    codigo:                  asText(answers.codigo),
    convocatoria_text:       asText(answers.convocatoria_text),
    has_informe_gestion:     answers.has_informe_gestion === true,
    informe_gestion_text:    informe ?? asText(answers.informe_gestion_text),
    confirmed_present_units: asNum(answers.confirmed_present_units),
    confirmed_time_end:      asText(answers.confirmed_time_end),
    confirmed_agenda_items:  asText(answers.confirmed_agenda_items),
    confirmed_total_units:   asNum(answers.confirmed_total_units),
    confirmed_date_str:      asText(answers.confirmed_date_str),
    confirmed_time_start:    asText(answers.confirmed_time_start),
  })

  const handlePreflight = (
    answers: Record<string, string | number | boolean>,
    informe?: string,
  ) => {
    setPreflight(buildPreflight(answers, informe))
    setStep('formalize')
  }

  // ── 3 · Formalize (Edge Function fan-out) → onComplete ───────────────────
  const handleFormalized = (blocks: DebateBlock[]) => {
    runGenerate(blocks, [])
  }

  // ── 4 · /api/generate → DOCX + QA report ─────────────────────────────────
  const runGenerate = async (blocks: DebateBlock[], findings: ICRFinding[]) => {
    if (!parsed || !preflight) {
      setError('Faltan datos para generar el acta'); setStep('error'); return
    }
    setStep('generating'); setError('')
    try {
      const res = await fetch('/api/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          parsed,
          preflight,
          formalizedBlocks: blocks,
          icr_findings: findings,
          attempt: retry,
        }),
      })
      const json = (await res.json()) as GenerateResponse
      if (!res.ok || !json.success) {
        throw new Error(json.error || `La generación falló (HTTP ${res.status})`)
      }
      setGen(json)
      setStep('qa')
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Error al generar el documento')
      setStep('error')
    }
  }

  // ── 5 · /api/icr → audit report (display only this session) ──────────────
  const runICR = async () => {
    if (!gen?.acta_text || !parsed) return
    setStep('icr_review'); setIcrLoading(true); setError('')
    try {
      const res = await fetch('/api/icr', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ acta_text: gen.acta_text, parsed }),
      })
      const json = (await res.json()) as { success: boolean; report?: ICRReport; error?: string }
      if (json.report) {
        setIcrReport(json.report)
      } else {
        setError(json.error || 'La revisión ICR no devolvió un reporte')
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Error en la revisión ICR')
    } finally {
      setIcrLoading(false)
    }
  }

  // ── DOCX download (base64 → Blob, no external dep) ───────────────────────
  const downloadDocx = () => {
    if (!gen?.docx_base64 || !gen.filename) return
    const chars = atob(gen.docx_base64)
    const bytes = new Uint8Array(chars.length)
    for (let i = 0; i < chars.length; i++) bytes[i] = chars.charCodeAt(i)
    const blob = new Blob([bytes], {
      type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = gen.filename
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
    URL.revokeObjectURL(url)
  }

  // ── ICR report download (.docx) — serialize the structured findings ──────
  const [icrDocxLoading, setIcrDocxLoading] = useState(false)
  const downloadICRReport = async () => {
    if (!icrReport || !parsed) return
    setIcrDocxLoading(true)
    try {
      const res = await fetch('/api/icr-docx', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          report: icrReport,
          ph_name: parsed.skeleton.ph_name,
          acta_number: parsed.skeleton.acta_number,
          assembly_type: parsed.skeleton.assembly_type,
          date_str: parsed.skeleton.date_str,
        }),
      })
      const json = (await res.json()) as { success: boolean; docx_base64?: string; filename?: string; error?: string }
      if (!json.success || !json.docx_base64 || !json.filename) {
        setError(json.error || 'No se pudo generar el reporte ICR'); return
      }
      const chars = atob(json.docx_base64)
      const bytes = new Uint8Array(chars.length)
      for (let i = 0; i < chars.length; i++) bytes[i] = chars.charCodeAt(i)
      const blob = new Blob([bytes], {
        type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url; a.download = json.filename
      document.body.appendChild(a); a.click(); document.body.removeChild(a)
      URL.revokeObjectURL(url)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Error al generar el reporte ICR')
    } finally {
      setIcrDocxLoading(false)
    }
  }

  const reset = () => {
    setStep('upload'); setParsed(null); setGaps([]); setPreflight(null)
    setIcrReport(null); setIcrLoading(false)
    setGen(null); setError(''); setRetry(0)
  }

  const regenerate = () => { setRetry(r => Math.min(r + 1, MAX_SWEEPS - 1)); setStep('formalize') }

  // ── Render ───────────────────────────────────────────────────────────────
  return (
    <div style={{ minHeight: '100vh', background: 'var(--carbon-d)', color: 'var(--parch)', fontFamily: 'DM Sans, sans-serif', paddingBottom: 64 }}>
      <div style={{ maxWidth: 760, margin: '0 auto', padding: '36px 28px' }}>

        {/* Step indicator */}
        {step !== 'error' && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', marginBottom: 36 }}>
            {PHASES.map((p, i) => {
              const active = p.keys.includes(step)
              const done = i < activeIdx
              return (
                <div key={p.label} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <span style={{
                    fontSize: 11,
                    letterSpacing: '0.1em',
                    textTransform: 'uppercase' as const,
                    fontWeight: active ? 700 : 500,
                    color: active ? 'var(--am-l)' : done ? 'var(--success)' : 'var(--text-subtle)',
                    transition: 'color 0.2s',
                  }}>
                    {done ? '✓ ' : ''}{p.label}
                  </span>
                  {i < PHASES.length - 1 && <span style={{ color: 'rgba(184,176,168,0.25)' }}>·</span>}
                </div>
              )
            })}
          </div>
        )}

        {/* Step content */}
        {(step === 'upload' || step === 'parsing') && (
          <UploadZone onDataReady={(data) => handleDataReady(data as ExtractedData)} loading={step === 'parsing'} />
        )}

        {step === 'preflight' && parsed && (
          <PreflightForm gaps={gaps} parsed={parsed} onSubmit={handlePreflight} />
        )}

        {step === 'formalize' && parsed && (
          <ProcessingPipeline
            key={`formalize-${retry}`}
            blocks={parsed.debates}
            skeleton={parsed.skeleton}
            onComplete={handleFormalized}
            retryAttempt={retry}
          />
        )}

        {step === 'generating' && (
          <div className="fade-in" style={{ background: 'var(--carbon)', border: '1px solid rgba(92,52,114,0.2)', borderRadius: 12, padding: '48px 32px', textAlign: 'center' }}>
            <div style={{ width: 40, height: 40, border: '3px solid rgba(92,52,114,0.2)', borderTop: '3px solid var(--amatista)', borderRadius: '50%', animation: 'spin-slow 0.9s linear infinite', margin: '0 auto 22px' }} />
            <h2 style={{ fontFamily: 'EB Garamond, serif', fontSize: 28, fontWeight: 400, color: 'var(--parch)', margin: '0 0 8px' }}>
              Construyendo el documento
            </h2>
            <p style={{ color: 'var(--parch-dim)', fontSize: 14, margin: 0 }}>
              Redacción legal · tabla de asistencia · votaciones · QA — generando el DOCX
            </p>
          </div>
        )}

        {step === 'qa' && gen?.qa_report && (
          <div>
            <QAReportView
              report={gen.qa_report}
              wordCount={gen.word_count ?? 0}
              filename={gen.filename ?? 'acta.docx'}
              onRegenerate={regenerate}
              onContinue={runICR}
              continueLabel="Revisión ICR →"
              attempt={retry}
              maxAttempts={MAX_SWEEPS}
            />
            <div style={{ display: 'flex', gap: 12, marginTop: 16, flexWrap: 'wrap' }}>
              <button className="df-btn-primary" onClick={downloadDocx} style={{ padding: '12px 28px', fontSize: 15 }}>
                ⬇ Descargar DOCX
              </button>
              <button className="df-btn-ghost" onClick={reset}>Nueva acta</button>
            </div>
          </div>
        )}

        {step === 'icr_review' && (
          <div>
            <ICRReportView report={icrReport as ICRReport} loading={icrLoading} />
            <div style={{ display: 'flex', gap: 12, marginTop: 20, flexWrap: 'wrap' }}>
              <button className="df-btn-primary" onClick={downloadDocx} style={{ padding: '12px 28px', fontSize: 15 }}>
                ⬇ Descargar DOCX
              </button>
              {icrReport && !icrLoading && (
                <button className="df-btn-ghost" onClick={downloadICRReport} disabled={icrDocxLoading} style={{ padding: '12px 24px', fontSize: 15 }}>
                  {icrDocxLoading ? '⏳ Generando…' : '⬇ Descargar reporte ICR (.docx)'}
                </button>
              )}
              <button className="df-btn-ghost" onClick={() => setStep('qa')}>← Volver al QA</button>
              <button className="df-btn-ghost" onClick={reset}>Nueva acta</button>
            </div>
          </div>
        )}

        {step === 'error' && (
          <div className="fade-in" style={{ background: 'rgba(196,98,45,0.07)', border: '1px solid rgba(196,98,45,0.3)', borderLeft: '3px solid var(--terra)', borderRadius: 10, padding: '24px 28px' }}>
            <h2 style={{ fontFamily: 'EB Garamond, serif', fontSize: 24, fontWeight: 400, color: 'var(--terra)', margin: '0 0 8px' }}>
              Algo se detuvo
            </h2>
            <p style={{ color: 'var(--parch-dim)', fontSize: 14, margin: '0 0 20px' }}>{error || 'Error inesperado.'}</p>
            <button className="df-btn-primary" onClick={reset} style={{ padding: '12px 28px', fontSize: 15 }}>
              ↺ Reiniciar
            </button>
          </div>
        )}
      </div>

      {/* Footer */}
      <footer style={{ borderTop: '2px solid var(--am)', background: 'rgba(14,16,24,0.6)', padding: '12px 28px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
        <div style={{ display: 'inline-flex', alignItems: 'baseline', lineHeight: 1 }}>
          <span style={{ fontFamily: 'EB Garamond, serif', fontWeight: 400, color: 'var(--parch-dim)', fontSize: 14 }}>Forum</span>
          <span style={{ fontWeight: 700, color: 'var(--terra)', letterSpacing: '0.05em', fontSize: 13 }}>PHs</span>
          <span style={{ fontSize: 9, color: 'rgba(240,237,232,0.2)', letterSpacing: '0.06em', marginLeft: 8 }}>Actas · Ley 284 de 2022</span>
        </div>
        <div style={{ fontSize: 9, color: 'rgba(200,196,190,0.2)', letterSpacing: '0.04em' }}>Document Factory v2.0</div>
      </footer>
    </div>
  )
}
