'use client'

import { useState, useRef } from 'react'
import UploadZone from '@/components/UploadZone'
import PreflightForm from '@/components/PreflightForm'
import ProcessingPipeline from '@/components/ProcessingPipeline'
import QAReportView from '@/components/QAReport'
import ICRReportView from '@/components/ICRReport'
import type { ICRReport } from '@/lib/types'
import { createJob, updateJob, loadJob, saveJobId, loadJobId, clearJobId } from '@/lib/supabaseSession'
import type {
  ParsedHypalZip,
  PreflightGap,
  PreflightData,
  DebateBlock,
  QAReport,
} from '@/lib/types'

type Step = 'upload' | 'preflight' | 'formalizing' | 'generating' | 'qa' | 'icr' | 'done' | 'error'

interface DocOutput {
  docx_base64: string
  filename: string
  word_count: number
  qa_report: QAReport
  acta_text?: string
}

const STEPS = [
  { id: 'upload', label: 'ZIP' },
  { id: 'preflight', label: 'Pre-flight' },
  { id: 'formalizing', label: 'Paso 0.5' },
  { id: 'generating', label: 'Generar' },
  { id: 'qa', label: 'QA' },
  { id: 'icr', label: 'ICR' },
  { id: 'done', label: 'Descarga' },
]

export default function Home() {
  const [step, setStep] = useState<Step>('upload')
  const [uploading, setUploading] = useState(false)
  const [parsed, setParsed] = useState<ParsedHypalZip | null>(null)
  const [gaps, setGaps] = useState<PreflightGap[]>([])
  const [preflight, setPreflight] = useState<PreflightData | null>(null)
  const [blocksToFormalize, setBlocksToFormalize] = useState<DebateBlock[]>([])
  const [formalizedBlocks, setFormalizedBlocks] = useState<DebateBlock[]>([])
  const [output, setOutput] = useState<DocOutput | null>(null)
  const [icrReport, setIcrReport] = useState<ICRReport | null>(null)
  const [icrLoading, setIcrLoading] = useState(false)
  const autoRetryRef = useRef(0)
  const MAX_AUTO_RETRIES = 2
  const [error, setError] = useState<string | null>(null)
  const [generating, setGenerating] = useState(false)
  const [jobId, setJobId] = useState<string | null>(null)

  // ---- Step 1: Upload & Parse ZIP ----
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const handleFileSelected = async (extracted: any) => {
    setUploading(true)
    setError(null)

    try {
      const res = await fetch('/api/parse', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(extracted),
      })

      const data = await res.json()

      if (!data.success || !data.parsed) {
        throw new Error(data.error || 'Error al procesar el ZIP')
      }

      setParsed(data.parsed)
      setGaps(data.preflight_gaps || [])
      // Persist job
      const jid = await createJob({ stage: 'preflight', parsed: data.parsed })
      if (jid) { setJobId(jid); saveJobId(jid) }
      setStep('preflight')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error desconocido')
      setStep('error')
    } finally {
      setUploading(false)
    }
  }

  // ---- Step 2: Pre-flight ----
  const handlePreflightSubmit = (answers: Record<string, string | number | boolean>, informe?: string) => {
    if (!parsed) return

    const pf: PreflightData = {
      finca: answers.finca as string,
      codigo: answers.codigo as string,
      convocatoria_text: answers.convocatoria_text as string,
      has_informe_gestion: Boolean(answers.has_informe_gestion),
      informe_gestion_text: informe,
      confirmed_present_units: answers.confirmed_present_units as number,
      confirmed_time_end: answers.confirmed_time_end as string,
    }

    setPreflight(pf)

    // Apply answers to skeleton
    const updatedParsed: ParsedHypalZip = {
      ...parsed,
      skeleton: {
        ...parsed.skeleton,
        ph_finca: pf.finca || parsed.skeleton.ph_finca,
        ph_codigo: pf.codigo || parsed.skeleton.ph_codigo,
        present_units: pf.confirmed_present_units || parsed.skeleton.present_units,
        time_end: pf.confirmed_time_end || parsed.skeleton.time_end,
      },
    }
    setParsed(updatedParsed)

    // Prepare blocks for formalization (non-skip blocks only)
    const toFormalize = parsed.debates.filter(b => !b.skip)
    setBlocksToFormalize(toFormalize)
    if (jobId) updateJob(jobId, { stage: 'formalizing', preflight: pf })
    setStep('formalizing')
  }

  // ---- Step 3: Formalization complete ----
  const handleFormalizationComplete = async (blocks: DebateBlock[]) => {
    setFormalizedBlocks(blocks)
    if (jobId) updateJob(jobId, { stage: 'generating' as any, formalized_blocks: blocks })
    setStep('generating')
    await generateDocx(blocks)
  }

  // ---- Step 4: Generate DOCX ----
  const generateDocx = async (blocks?: DebateBlock[]) => {
    if (!parsed || !preflight) return
    setGenerating(true)
    setError(null)

    try {
      const res = await fetch('/api/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          parsed,
          preflight,
          formalizedBlocks: blocks || formalizedBlocks,
          retry_attempt: autoRetryRef.current,
        }),
      })

      const data = await res.json()

      if (!data.success) throw new Error(data.error || 'Error al generar el acta')

      if (jobId) updateJob(jobId, { stage: 'done' as any, qa_report: data.qa_report, output_filename: data.filename })
      const qaReport = data.qa_report
      const formalizedPct = qaReport?.formalized_pct ?? 0
      const estimatedPages = Math.round((data.word_count || 0) / 500)
      const needsRetry = (formalizedPct < 70 || estimatedPages < 25) && autoRetryRef.current < MAX_AUTO_RETRIES

      setOutput({
        docx_base64: data.docx_base64,
        filename: data.filename,
        word_count: data.word_count,
        qa_report: data.qa_report,
        acta_text: data.acta_text,
      })

      if (needsRetry) {
        autoRetryRef.current += 1
        setStep('formalizing')
        setTimeout(() => setStep('generating'), 800)
        setTimeout(() => generateDocx(), 800)
        return
      }
      // Max retries reached or threshold met — proceed to QA
      setStep('qa')
      // ICR is triggered manually by user clicking "Continuar → ICR"
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error al generar')
      setStep('error')
    } finally {
      setGenerating(false)
    }
  }

  // ---- ICR (user-triggered) ----
  const runICR = async () => {
    if (!output || !parsed) { setStep('icr'); return }
    const actaText = output.acta_text || ''
    setIcrLoading(true)
    setStep('icr')
    try {
      const icrRes = await fetch('/api/icr', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ acta_text: actaText, parsed }),
      })
      const icrData = await icrRes.json()
      if (icrData.success) setIcrReport(icrData.report)
    } catch { /* non-blocking */ }
    finally { setIcrLoading(false) }
  }

  // ---- Download ----
  const handleDownload = () => {
    if (!output) return
    const bytes = atob(output.docx_base64)
    const arr = new Uint8Array(bytes.length)
    for (let i = 0; i < bytes.length; i++) arr[i] = bytes.charCodeAt(i)
    const blob = new Blob([arr], { type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = output.filename
    a.click()
    URL.revokeObjectURL(url)
  }

  // ---- Reset ----
  const handleReset = () => {
    setStep('upload')
    clearJobId()
    setJobId(null)
    setParsed(null)
    setIcrReport(null)
    setIcrLoading(false)
    autoRetryRef.current = 0
    setGaps([])
    setPreflight(null)
    setBlocksToFormalize([])
    setFormalizedBlocks([])
    setOutput(null)
    setError(null)
  }

  const activeStepIndex = STEPS.findIndex(s => s.id === step)

  return (
    <div style={{ minHeight: '100vh', background: 'var(--carbon)' }}>
      {/* Top bar */}
      <div style={{
        position: 'sticky',
        top: 0,
        zIndex: 100,
        background: 'rgba(28,34,51,0.95)',
        backdropFilter: 'blur(12px)',
        borderBottom: '1px solid rgba(92,52,114,0.2)',
        padding: '0 32px',
        height: 56,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
          <span style={{ fontFamily: 'EB Garamond, serif', fontWeight: 400, fontSize: 15, color: '#F0EDE8' }}>Forum</span>
          <span style={{ fontFamily: 'DM Sans, sans-serif', fontWeight: 700, fontSize: 13, color: '#C4622D', letterSpacing: '0.06em' }}>PH</span>
          <span style={{ fontFamily: 'DM Sans, sans-serif', fontWeight: 700, fontSize: 12, color: '#C4622D', letterSpacing: '0.04em' }}>s</span>
          <span style={{ color: 'rgba(200,196,190,0.2)', margin: '0 6px' }}>·</span>
          <span style={{ fontFamily: 'DM Sans, sans-serif', fontSize: 11, fontWeight: 500, letterSpacing: '0.1em', textTransform: 'uppercase' as const, color: 'rgba(200,196,190,0.4)' }}>Document Factory</span>
        </div>

        {/* Step indicator */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
          {STEPS.map((s, i) => {
            const isDone = i < activeStepIndex
            const isActive = i === activeStepIndex
            return (
              <div key={s.id} style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                <div style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 6,
                  padding: '4px 10px',
                  borderRadius: 6,
                  background: isActive ? 'rgba(92,52,114,0.2)' : 'transparent',
                  border: isActive ? '1px solid rgba(92,52,114,0.4)' : '1px solid transparent',
                }}>
                  <div style={{
                    width: 6, height: 6,
                    borderRadius: '50%',
                    background: isDone ? '#4ADE80' : isActive ? 'var(--amatista-light)' : 'rgba(200,196,190,0.2)',
                  }} />
                  <span style={{
                    fontSize: 11,
                    color: isDone ? '#4ADE80' : isActive ? 'var(--parch)' : 'rgba(200,196,190,0.3)',
                    fontWeight: isActive ? 600 : 400,
                    letterSpacing: '0.04em',
                  }}>
                    {s.label}
                  </span>
                </div>
                {i < STEPS.length - 1 && (
                  <span style={{ color: 'rgba(200,196,190,0.15)', fontSize: 10 }}>›</span>
                )}
              </div>
            )
          })}
        </div>
      </div>

      {/* Main content */}
      <div style={{
        maxWidth: 800,
        margin: '0 auto',
        padding: '48px 32px',
      }}>
        {/* Upload */}
        {step === 'upload' && (
          <UploadZone onDataReady={handleFileSelected} loading={uploading} />
        )}

        {/* Pre-flight */}
        {step === 'preflight' && parsed && (
          <PreflightForm
            gaps={gaps}
            parsed={parsed}
            onSubmit={handlePreflightSubmit}
          />
        )}

        {/* Formalizing */}
        {step === 'formalizing' && blocksToFormalize.length > 0 && (
          <ProcessingPipeline
            blocks={blocksToFormalize}
            skeleton={parsed?.skeleton}
            onComplete={handleFormalizationComplete}
            retryAttempt={autoRetryRef.current}
          />
        )}

        {/* Generating */}
        {step === 'generating' && (
          <div className="fade-in" style={{ textAlign: 'center', padding: '64px 0' }}>
            <div style={{
              width: 64, height: 64,
              border: '3px solid rgba(92,52,114,0.3)',
              borderTop: '3px solid var(--amatista)',
              borderRadius: '50%',
              margin: '0 auto 24px',
              animation: 'spin-slow 1s linear infinite',
            }} />
            <h2 style={{
              fontFamily: 'EB Garamond, serif',
              fontSize: 28,
              color: 'var(--parch)',
              fontWeight: 400,
              margin: '0 0 8px',
            }}>
              {autoRetryRef.current > 0 ? `Mejorando cobertura (intento ${autoRetryRef.current + 1}/${MAX_AUTO_RETRIES + 1})` : 'Generando el Acta'}
            </h2>
            <p style={{ color: 'var(--parch-dim)', fontSize: 14 }}>
              {autoRetryRef.current > 0 ? 'QA detectó cobertura insuficiente — regenerando automáticamente' : 'Ensamblando secciones · aplicando formato · construyendo .docx'}
            </p>
          </div>
        )}

        {/* QA step */}
        {(step === 'qa' || step === 'icr' || step === 'done') && output && (
          <>
            {/* Retry exhausted warning */}
            {step === 'qa' && autoRetryRef.current >= MAX_AUTO_RETRIES && (output.qa_report?.formalized_pct ?? 0) < 70 && (
              <div style={{
                background: 'rgba(196,98,45,0.08)', border: '1px solid rgba(196,98,45,0.25)',
                borderRadius: 10, padding: '14px 20px', marginBottom: 16,
                display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 16,
              }}>
                <div>
                  <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--terra)', marginBottom: 3 }}>
                    ⚠ Cobertura insuficiente tras {MAX_AUTO_RETRIES} reintentos
                  </div>
                  <div style={{ fontSize: 12, color: 'var(--parch-dim)' }}>
                    {output.qa_report?.formalized_pct ?? 0}% bloques formalizados · ~{Math.round((output.word_count || 0) / 500)} páginas estimadas
                  </div>
                </div>
                <div style={{ display: 'flex', gap: 10, flexShrink: 0 }}>
                  <button
                    style={{ padding: '8px 16px', borderRadius: 8, border: '1px solid rgba(196,98,45,0.4)', background: 'transparent', color: 'var(--terra)', fontSize: 12, cursor: 'pointer', fontFamily: 'DM Sans, sans-serif' }}
                    onClick={() => { autoRetryRef.current = 0; generateDocx() }}
                  >
                    ↺ Reintentar manualmente
                  </button>
                  <button
                    style={{ padding: '8px 16px', borderRadius: 8, border: '1px solid rgba(200,196,190,0.15)', background: 'transparent', color: 'var(--parch-dim)', fontSize: 12, cursor: 'pointer', fontFamily: 'DM Sans, sans-serif' }}
                    onClick={handleReset}
                  >
                    ⟲ Empezar de nuevo
                  </button>
                </div>
              </div>
            )}
            <QAReportView
              report={output.qa_report}
              wordCount={output.word_count}
              filename={output.filename}
              onDownload={step === 'done' ? handleDownload : undefined}
              onRegenerate={handleReset}
              showDownload={step === 'done'}
              onContinue={step === 'qa' ? runICR : undefined}
              continueLabel="Continuar → ICR"
            />
          </>
        )}

        {/* ICR step */}
        {(step === 'icr' || step === 'done') && (
          <div style={{ marginTop: 20 }}>
            {icrLoading && (
              <ICRReportView report={null as any} loading={true} />
            )}
            {icrReport && (
              <>
                <ICRReportView report={icrReport} loading={false} />
                {step === 'icr' && (
                  <div style={{ marginTop: 20, display: 'flex', gap: 12 }}>
                    <button className="df-btn-primary" onClick={() => setStep('done')} style={{ padding: '12px 32px', fontSize: 15 }}>
                      Continuar → Descargar
                    </button>
                    <button className="df-btn-ghost" onClick={handleReset}>↺ Regenerar</button>
                  </div>
                )}
              </>
            )}
          </div>
        )}

        {/* Download step */}
        {step === 'done' && output && (
          <div style={{ marginTop: 24, display: 'flex', gap: 12 }}>
            <button className="df-btn-primary" onClick={handleDownload} style={{ padding: '12px 32px', fontSize: 15 }}>
              ⬇ Descargar .docx
            </button>
            <button className="df-btn-ghost" onClick={handleReset}>↺ Nueva acta</button>
          </div>
        )}

        {/* Error */}
        {step === 'error' && (
          <div className="fade-in" style={{ textAlign: 'center', padding: '64px 0' }}>
            <div style={{ fontSize: 48, marginBottom: 20 }}>⚠️</div>
            <h2 style={{
              fontFamily: 'EB Garamond, serif',
              fontSize: 28,
              color: 'var(--terra)',
              fontWeight: 400,
              margin: '0 0 12px',
            }}>
              Error en el proceso
            </h2>
            <p style={{ color: 'var(--parch-dim)', marginBottom: 32, fontSize: 14, maxWidth: 400, margin: '0 auto 32px' }}>
              {error}
            </p>
            <button className="df-btn-primary" onClick={handleReset}>
              ↺ Intentar de nuevo
            </button>
          </div>
        )}
      </div>

      {/* Footer — BP_BRAND_UNRLVL_v1.2 · 3-col · border-top 2px #00FFD1 */}
      <div style={{
        position: 'fixed',
        bottom: 0,
        left: 0,
        right: 0,
        borderTop: '2px solid #00FFD1',
        background: 'rgba(28,34,51,0.98)',
        padding: '10px 32px',
        display: 'grid',
        gridTemplateColumns: '1fr 1fr 1fr',
        alignItems: 'center',
        fontSize: 11,
        color: 'var(--parch-dim)',
        backdropFilter: 'blur(12px)',
      }}>
        {/* Col 1 — ForumPHs wordmark BP_BRAND inline */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <span style={{ fontFamily: 'EB Garamond, serif', fontWeight: 400, fontSize: 13, color: '#F0EDE8', letterSpacing: '0.01em' }}>Forum</span>
          <span style={{ fontFamily: 'DM Sans, sans-serif', fontWeight: 700, fontSize: 12, color: '#C4622D', letterSpacing: '0.06em' }}>PH</span>
          <span style={{ fontFamily: 'DM Sans, sans-serif', fontWeight: 700, fontSize: 11, color: '#C4622D', letterSpacing: '0.04em' }}>s</span>
          <span style={{ color: 'rgba(200,196,190,0.2)', margin: '0 4px' }}>·</span>
          <span style={{ color: 'var(--parch-dim)', letterSpacing: '0.04em' }}>Document Factory v1.4</span>
        </div>
        {/* Col 2 — © rights (centered) */}
        <div style={{ textAlign: 'center', color: 'rgba(200,196,190,0.35)', letterSpacing: '0.05em' }}>
          © {new Date().getFullYear()} ForumPHs · Actas PH Panamá · Ley 284 de 2022
        </div>
        {/* Col 3 — UNRLVL signature (right-aligned) */}
        <div style={{ textAlign: 'right' }}>
          Designed &amp; Developed by{' '}
          <span style={{
            fontFamily: 'DM Sans, sans-serif',
            fontWeight: 600,
            color: 'var(--parch)',
            letterSpacing: '0.02em',
          }}>
            Unreal&gt;ille Studio
          </span>
        </div>
      </div>
    </div>
  )
}
