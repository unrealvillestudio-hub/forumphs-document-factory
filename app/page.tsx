'use client'

import { useState } from 'react'
import UploadZone from '@/components/UploadZone'
import PreflightForm from '@/components/PreflightForm'
import ProcessingPipeline from '@/components/ProcessingPipeline'
import QAReportView from '@/components/QAReport'
import { createJob, updateJob, loadJob, saveJobId, loadJobId, clearJobId } from '@/lib/supabaseSession'
import type {
  ParsedHypalZip,
  PreflightGap,
  PreflightData,
  DebateBlock,
  QAReport,
} from '@/lib/types'

type Step = 'upload' | 'preflight' | 'formalizing' | 'generating' | 'done' | 'error'

interface DocOutput {
  docx_base64: string
  filename: string
  word_count: number
  qa_report: QAReport
}

const STEPS = [
  { id: 'upload', label: 'ZIP' },
  { id: 'preflight', label: 'Pre-flight' },
  { id: 'formalizing', label: 'Paso 0.5' },
  { id: 'generating', label: 'Generar' },
  { id: 'done', label: 'QA + Descarga' },
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
        }),
      })

      const data = await res.json()

      if (!data.success) throw new Error(data.error || 'Error al generar el acta')

      if (jobId) updateJob(jobId, { stage: 'done' as any, qa_report: data.qa_report, output_filename: data.filename })
      setOutput({
        docx_base64: data.docx_base64,
        filename: data.filename,
        word_count: data.word_count,
        qa_report: data.qa_report,
      })
      setStep('done')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error al generar')
      setStep('error')
    } finally {
      setGenerating(false)
    }
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
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span className="fphs-wm sm"><span className="f">Forum</span><span className="ph">PH</span><span className="s">s</span></span>
          <span style={{ color: 'rgba(200,196,190,0.2)', margin: '0 4px' }}>·</span>
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
              Generando el Acta
            </h2>
            <p style={{ color: 'var(--parch-dim)', fontSize: 14 }}>
              Ensamblando secciones · aplicando formato · construyendo .docx
            </p>
          </div>
        )}

        {/* Done */}
        {step === 'done' && output && (
          <QAReportView
            report={output.qa_report}
            wordCount={output.word_count}
            filename={output.filename}
            onDownload={handleDownload}
            onRegenerate={handleReset}
          />
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
        {/* Col 1 — ForumPHs wordmark BP_BRAND */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span className="fphs-wm xs">
            <span className="f">Forum</span><span className="ph">PH</span><span className="s">s</span>
          </span>
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
