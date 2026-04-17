'use client'
import { useState, useRef } from 'react'
import UploadZone from '@/components/UploadZone'
import PreflightForm from '@/components/PreflightForm'
import ProcessingPipeline from '@/components/ProcessingPipeline'
import QAReportView from '@/components/QAReport'
import ICRReportView from '@/components/ICRReport'
import type { ICRReport } from '@/lib/types'
import { createJob, updateJob, saveJobId, clearJobId } from '@/lib/supabaseSession'
import { parseAgendaText } from '@/lib/processors/preflightDetector'
import type { ParsedHypalZip, PreflightGap, PreflightData, DebateBlock, QAReport } from '@/lib/types'

// ICR Revisión eliminada — el anexo ICR en el DOCX cubre esa necesidad
type Step = 'upload' | 'preflight' | 'formalizing' | 'generating' | 'qa' | 'icr' | 'done' | 'error'

interface DocOutput {
  docx_base64: string; filename: string; word_count: number; qa_report: QAReport; acta_text?: string
}

const STEPS = [
  { id: 'upload',      label: 'ZIP'       },
  { id: 'preflight',   label: 'Pre-flight'},
  { id: 'formalizing', label: 'Paso 0.5'  },
  { id: 'generating',  label: 'Generar'   },
  { id: 'qa',          label: 'QA'        },
  { id: 'icr',         label: 'ICR'       },
  { id: 'done',        label: 'Descarga'  },
]

function UnrlvlSig({ size = 11 }: { size?: number }) {
  return (
    <span style={{ display: 'inline-flex', alignItems: 'baseline', gap: 0 }}>
      <span style={{ fontFamily: "'Bebas Neue', sans-serif", fontSize: size, letterSpacing: '0.08em', color: 'rgba(242,240,236,0.62)' }}>UNREAL</span>
      <span style={{ fontFamily: "'Bebas Neue', sans-serif", fontSize: size, color: '#00FFD1', display: 'inline-block', animation: 'chev-listen 0.9s ease-in-out infinite' }}>&gt;</span>
      <span style={{ fontFamily: "'Bebas Neue', sans-serif", fontSize: size, letterSpacing: '0.08em', color: 'rgba(242,240,236,0.62)' }}>ILLE</span>
      <span style={{ fontFamily: "'Bebas Neue', sans-serif", fontSize: Math.round(size * 0.72), letterSpacing: '0.24em', color: '#1A1A1A', marginLeft: 5, verticalAlign: 'baseline' }}>STUDIO</span>
    </span>
  )
}

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
  const [loadingAnnotated, setLoadingAnnotated] = useState(false)
  const autoRetryRef = useRef(0)
  const [offerRetryBanner, setOfferRetryBanner] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [jobId, setJobId] = useState<string | null>(null)

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const handleFileSelected = async (extracted: any) => {
    setUploading(true); setError(null)
    try {
      const res = await fetch('/api/parse', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(extracted) })
      const data = await res.json()
      if (!data.success || !data.parsed) throw new Error(data.error || 'Error al procesar el ZIP')
      setParsed(data.parsed); setGaps(data.preflight_gaps || [])
      const jid = await createJob({ stage: 'preflight', parsed: data.parsed })
      if (jid) { setJobId(jid); saveJobId(jid) }
      setStep('preflight')
    } catch (err) { setError(err instanceof Error ? err.message : 'Error desconocido'); setStep('error') }
    finally { setUploading(false) }
  }

  const handlePreflightSubmit = (answers: Record<string, string | number | boolean>, informe?: string) => {
    if (!parsed) return
    const pf: PreflightData = {
      finca: answers.finca as string, codigo: answers.codigo as string,
      convocatoria_text: answers.convocatoria_text as string,
      has_informe_gestion: Boolean(answers.has_informe_gestion),
      informe_gestion_text: informe,
      confirmed_present_units: answers.confirmed_present_units as number,
      confirmed_time_end: answers.confirmed_time_end as string,
      confirmed_agenda_items: (answers.confirmed_agenda_items as string) || '',
    }
    setPreflight(pf)
    const agendaItems = parseAgendaText(pf.confirmed_agenda_items || '')
    const updatedParsed: ParsedHypalZip = {
      ...parsed,
      skeleton: {
        ...parsed.skeleton,
        ph_finca:       pf.finca || parsed.skeleton.ph_finca,
        ph_codigo:      pf.codigo || parsed.skeleton.ph_codigo,
        present_units:  pf.confirmed_present_units || parsed.skeleton.present_units,
        total_units:    (answers.total_units as number) || parsed.skeleton.total_units,
        time_end:       pf.confirmed_time_end || parsed.skeleton.time_end,
        agenda_items:   agendaItems.length > 0 ? agendaItems : parsed.skeleton.agenda_items,
        president_name: (answers.president_name as string) || parsed.skeleton.president_name,
        secretary_name: (answers.secretary_name as string) || parsed.skeleton.secretary_name,
      },
    }
    setParsed(updatedParsed)
    const toFormalize = parsed.debates.filter(b => !b.skip)
    setBlocksToFormalize(toFormalize)
    if (jobId) updateJob(jobId, { stage: 'formalizing', preflight: pf })
    setStep('formalizing')
  }

  const handleFormalizationComplete = async (blocks: DebateBlock[]) => {
    setFormalizedBlocks(blocks)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    if (jobId) updateJob(jobId, { stage: 'generating' as any, formalized_blocks: blocks })
    setStep('generating')
    await generateDocx(blocks)
  }

  const generateDocx = async (blocks?: DebateBlock[], opts?: { withIcr?: boolean }) => {
    if (!parsed || !preflight) return
    setError(null)
    try {
      const res = await fetch('/api/generate', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          parsed, preflight,
          formalizedBlocks: blocks || formalizedBlocks,
          retry_attempt: autoRetryRef.current,
          icr_findings: opts?.withIcr && icrReport ? icrReport.findings : [],
        }),
      })
      const data = await res.json()
      if (!data.success) throw new Error(data.error || 'Error al generar el acta')
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      if (jobId) updateJob(jobId, { stage: 'done' as any, qa_report: data.qa_report, output_filename: data.filename })
      setOutput({ docx_base64: data.docx_base64, filename: data.filename, word_count: data.word_count, qa_report: data.qa_report, acta_text: data.acta_text })
      const formalizedPct = data.qa_report?.formalized_pct ?? 0
      if (formalizedPct < 70 && autoRetryRef.current < 2) setOfferRetryBanner(true)
      setStep('qa')
    } catch (err) { setError(err instanceof Error ? err.message : 'Error al generar'); setStep('error') }
  }

  // ICR — auto-scroll para que Ivette vea el spinner inmediatamente
  const runICR = async () => {
    if (!output || !parsed) { setStep('icr'); return }
    setIcrLoading(true); setStep('icr')
    // Scroll down so the ICR loading indicator is visible
    setTimeout(() => window.scrollTo({ top: document.body.scrollHeight, behavior: 'smooth' }), 80)
    const timeout = setTimeout(() => { setIcrLoading(false); setStep('done') }, 45000)
    try {
      const icrRes = await fetch('/api/icr', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ acta_text: output.acta_text || '', parsed }),
      })
      const icrData = await icrRes.json()
      if (icrData.success) setIcrReport(icrData.report)
    } catch { /* non-blocking */ }
    finally { clearTimeout(timeout); setIcrLoading(false); setStep('done') }
  }

  const handleDownload = () => { if (output) triggerDownload(output.docx_base64, output.filename) }

  const handleDownloadAnnotated = async () => {
    if (!parsed || !preflight || !icrReport) return
    setLoadingAnnotated(true)
    try {
      const res = await fetch('/api/generate', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ parsed, preflight, formalizedBlocks, retry_attempt: autoRetryRef.current, icr_findings: icrReport.findings }),
      })
      const data = await res.json()
      if (!data.success) throw new Error(data.error || 'Error')
      triggerDownload(data.docx_base64, data.filename)
    } catch (err) { setError(err instanceof Error ? err.message : 'Error') }
    finally { setLoadingAnnotated(false) }
  }

  const triggerDownload = (base64: string, filename: string) => {
    const bytes = atob(base64); const arr = new Uint8Array(bytes.length)
    for (let i = 0; i < bytes.length; i++) arr[i] = bytes.charCodeAt(i)
    const blob = new Blob([arr], { type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' })
    const url = URL.createObjectURL(blob); const a = document.createElement('a')
    a.href = url; a.download = filename; a.click(); URL.revokeObjectURL(url)
  }

  const handleReset = () => {
    setStep('upload'); clearJobId(); setJobId(null); setParsed(null)
    setIcrReport(null); setIcrLoading(false); autoRetryRef.current = 0
    setGaps([]); setPreflight(null); setBlocksToFormalize([])
    setFormalizedBlocks([]); setOutput(null); setError(null)
    setOfferRetryBanner(false); setLoadingAnnotated(false)
  }

  const activeStepIndex = STEPS.findIndex(s => s.id === step)

  return (
    <div style={{ minHeight: '100vh', background: 'var(--carbon)' }}>
      <style>{`
        @keyframes chev-listen { 0%,45%{opacity:1} 50%,92%{opacity:0} 97%,100%{opacity:1} }
      `}</style>

      {/* Top bar */}
      <div style={{ position: 'sticky', top: 0, zIndex: 100, background: 'rgba(28,34,51,0.95)', backdropFilter: 'blur(12px)', borderBottom: '1px solid rgba(92,52,114,0.2)', padding: '0 32px', height: 56, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/FPHS_logo-wt.png" alt="ForumPHs" style={{ height: 20, width: 'auto' }} />
          <span style={{ color: 'rgba(200,196,190,0.2)', fontSize: 12 }}>·</span>
          <span style={{ fontFamily: 'DM Sans, sans-serif', fontSize: 11, fontWeight: 500, letterSpacing: '0.1em', textTransform: 'uppercase' as const, color: 'rgba(200,196,190,0.4)' }}>Document Factory</span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
          {STEPS.map((s, i) => {
            const isDone = i < activeStepIndex; const isActive = i === activeStepIndex
            return (
              <div key={s.id} style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '4px 10px', borderRadius: 6, background: isActive ? 'rgba(92,52,114,0.2)' : 'transparent', border: isActive ? '1px solid rgba(92,52,114,0.4)' : '1px solid transparent' }}>
                  <div style={{ width: 6, height: 6, borderRadius: '50%', background: isDone ? '#4ADE80' : isActive ? 'var(--amatista-light)' : 'rgba(200,196,190,0.2)' }} />
                  <span style={{ fontSize: 11, color: isDone ? '#4ADE80' : isActive ? 'var(--parch)' : 'rgba(200,196,190,0.3)', fontWeight: isActive ? 600 : 400, letterSpacing: '0.04em' }}>{s.label}</span>
                </div>
                {i < STEPS.length - 1 && <span style={{ color: 'rgba(200,196,190,0.15)', fontSize: 10 }}>›</span>}
              </div>
            )
          })}
        </div>
      </div>

      {/* Main content */}
      <div style={{ maxWidth: 800, margin: '0 auto', padding: '48px 32px 120px' }}>

        {step === 'upload' && <UploadZone onDataReady={handleFileSelected} loading={uploading} />}

        {step === 'preflight' && parsed && <PreflightForm gaps={gaps} parsed={parsed} onSubmit={handlePreflightSubmit} />}

        {step === 'formalizing' && blocksToFormalize.length > 0 && (
          <ProcessingPipeline
            key={`pipeline-${autoRetryRef.current}`}
            blocks={blocksToFormalize} skeleton={parsed?.skeleton}
            onComplete={handleFormalizationComplete} retryAttempt={autoRetryRef.current}
          />
        )}

        {/* Blank screen guard — transcripción vacía */}
        {step === 'formalizing' && blocksToFormalize.length === 0 && (
          <div className="fade-in" style={{ textAlign: 'center', padding: '64px 0' }}>
            <div style={{ fontSize: 48, marginBottom: 20 }}>⚠️</div>
            <h2 style={{ fontFamily: 'EB Garamond, serif', fontSize: 28, color: 'var(--terra)', fontWeight: 400, margin: '0 0 12px' }}>Transcripción no detectada</h2>
            <p style={{ color: 'var(--parch-dim)', fontSize: 14, maxWidth: 420, margin: '0 auto 8px' }}>El ZIP no contiene un archivo de transcripción reconocible, o todos los bloques fueron descartados.</p>
            <p style={{ color: 'rgba(200,196,190,0.35)', fontSize: 12, maxWidth: 420, margin: '0 auto 32px' }}>Verifica que el ZIP incluya el archivo de transcripción de Hypal (Transcripci… o Recording…).</p>
            <div style={{ display: 'flex', gap: 12, justifyContent: 'center' }}>
              <button className="df-btn-primary" onClick={() => { setStep('generating'); generateDocx([]) }} style={{ padding: '12px 28px', fontSize: 14 }}>Generar acta sin transcripción</button>
              <button className="df-btn-ghost" onClick={handleReset}>↺ Subir otro ZIP</button>
            </div>
          </div>
        )}

        {step === 'generating' && (
          <div className="fade-in" style={{ textAlign: 'center', padding: '64px 0' }}>
            <div style={{ width: 64, height: 64, border: '3px solid rgba(92,52,114,0.3)', borderTop: '3px solid var(--amatista)', borderRadius: '50%', margin: '0 auto 24px', animation: 'spin-slow 1s linear infinite' }} />
            <h2 style={{ fontFamily: 'EB Garamond, serif', fontSize: 28, color: 'var(--parch)', fontWeight: 400, margin: '0 0 8px' }}>
              {autoRetryRef.current > 0 ? `${autoRetryRef.current === 1 ? '2º' : '3er'} barrido — tolerancia +${autoRetryRef.current * 10}%` : 'Generando el Acta'}
            </h2>
            <p style={{ color: 'var(--parch-dim)', fontSize: 14 }}>
              {autoRetryRef.current > 0 ? 'Agentes re-procesando — el generador espera' : 'Ensamblando secciones · aplicando formato · construyendo .docx'}
            </p>
          </div>
        )}

        {/* QA */}
        {(step === 'qa' || step === 'icr' || step === 'done') && output && (
          <>
            {step === 'qa' && offerRetryBanner && (
              <div style={{ background: 'rgba(92,52,114,0.08)', border: '1px solid rgba(92,52,114,0.25)', borderRadius: 10, padding: '14px 20px', marginBottom: 16, display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 16 }}>
                <div>
                  <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--amatista-light)', marginBottom: 3 }}>Cobertura al {output.qa_report?.formalized_pct ?? 0}% — ¿hacemos un barrido más?</div>
                  <div style={{ fontSize: 12, color: 'var(--parch-dim)' }}>{autoRetryRef.current === 0 ? '2º barrido — agentes re-procesan con +10% de tolerancia' : '3er barrido — +10% adicional de tolerancia'}</div>
                </div>
                <div style={{ display: 'flex', gap: 10, flexShrink: 0 }}>
                  <button style={{ padding: '8px 20px', borderRadius: 8, border: 'none', background: 'var(--amatista)', color: '#fff', fontSize: 12, cursor: 'pointer', fontFamily: 'DM Sans, sans-serif', fontWeight: 600 }}
                    onClick={() => { setOfferRetryBanner(false); autoRetryRef.current += 1; setFormalizedBlocks([]); setStep('formalizing') }}>
                    {autoRetryRef.current === 0 ? '2º barrido · +10% tolerancia' : '3er barrido · +10% tolerancia'}
                  </button>
                  <button style={{ padding: '8px 16px', borderRadius: 8, border: '1px solid rgba(200,196,190,0.15)', background: 'transparent', color: 'var(--parch-dim)', fontSize: 12, cursor: 'pointer', fontFamily: 'DM Sans, sans-serif' }}
                    onClick={() => setOfferRetryBanner(false)}>No, continuar</button>
                </div>
              </div>
            )}
            <QAReportView
              report={output.qa_report} wordCount={output.word_count} filename={output.filename}
              onDownload={step === 'done' ? handleDownload : undefined}
              onRegenerate={handleReset} showDownload={step === 'done'}
              onContinue={step === 'qa' ? runICR : undefined} continueLabel="Continuar → ICR"
            />
          </>
        )}

        {/* ICR — spinner + reporte (sin Revisión) */}
        {(step === 'icr' || step === 'done') && (
          <div style={{ marginTop: 20 }}>
            {/* Loading spinner — visible gracias al auto-scroll */}
            {icrLoading && (
              <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '20px 24px', borderRadius: 10, background: 'rgba(92,52,114,0.1)', border: '1px solid rgba(92,52,114,0.25)', marginBottom: 16 }}>
                <div style={{ width: 20, height: 20, border: '2px solid rgba(92,52,114,0.3)', borderTop: '2px solid var(--amatista)', borderRadius: '50%', animation: 'spin-slow 1s linear infinite', flexShrink: 0 }} />
                <div>
                  <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--amatista-light)', marginBottom: 2 }}>ICR auditando el acta…</div>
                  <div style={{ fontSize: 12, color: 'var(--parch-dim)' }}>Claude revisa consistencia legal — los hallazgos se incluyen como Anexo en el DOCX</div>
                </div>
              </div>
            )}
            {/* Reporte ICR (cuando termina) */}
            {/* eslint-disable-next-line @typescript-eslint/no-explicit-any */}
            {step === 'icr' && !icrLoading && <ICRReportView report={null as any} loading={false} />}
            {icrReport && <ICRReportView report={icrReport} loading={false} />}
          </div>
        )}

        {/* Download bar — done step */}
        {step === 'done' && output && (
          <div style={{ marginTop: 24, display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' as const }}>
            <button className="df-btn-primary" onClick={handleDownload} style={{ padding: '12px 32px', fontSize: 15 }}>⬇ Descargar .docx</button>
            {icrReport && icrReport.findings.length > 0 && (
              <button className="df-btn-ghost" onClick={handleDownloadAnnotated} disabled={loadingAnnotated}
                style={{ padding: '12px 24px', fontSize: 14, display: 'flex', alignItems: 'center', gap: 8, opacity: loadingAnnotated ? 0.6 : 1 }}>
                {loadingAnnotated
                  ? <><div style={{ width: 14, height: 14, border: '2px solid rgba(200,196,190,0.3)', borderTop: '2px solid var(--parch)', borderRadius: '50%', animation: 'spin-slow 1s linear infinite' }} />Generando...</>
                  : `⚑ Con banners ICR (${icrReport.findings.length})`}
              </button>
            )}
            <button className="df-btn-ghost" onClick={handleReset}>↺ Nueva acta</button>
          </div>
        )}

        {/* Error */}
        {step === 'error' && (
          <div className="fade-in" style={{ textAlign: 'center', padding: '64px 0' }}>
            <div style={{ fontSize: 48, marginBottom: 20 }}>⚠️</div>
            <h2 style={{ fontFamily: 'EB Garamond, serif', fontSize: 28, color: 'var(--terra)', fontWeight: 400, margin: '0 0 12px' }}>Error en el proceso</h2>
            <p style={{ color: 'var(--parch-dim)', fontSize: 14, maxWidth: 400, margin: '0 auto 32px' }}>{error}</p>
            <button className="df-btn-primary" onClick={handleReset}>↺ Intentar de nuevo</button>
          </div>
        )}
      </div>

      {/* Footer */}
      <footer style={{ position: 'fixed', bottom: 0, left: 0, right: 0, borderTop: '2px solid #00FFD1', background: '#0F0F0F', padding: '10px 32px', display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', alignItems: 'center', gap: '1rem', backdropFilter: 'blur(12px)' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/FPHS_logo-wt.png" alt="ForumPHs" style={{ height: 16, width: 'auto', opacity: 0.75 }} />
          <span style={{ color: 'rgba(200,196,190,0.2)', fontSize: 10 }}>·</span>
          <span style={{ fontSize: 10, color: 'rgba(200,196,190,0.35)', letterSpacing: '0.04em' }}>Document Factory v1.5</span>
        </div>
        <div style={{ textAlign: 'center', fontSize: 10, color: 'rgba(200,196,190,0.28)', letterSpacing: '0.05em' }}>
          © {new Date().getFullYear()} ForumPHs · Actas PH Panamá · Ley 284 de 2022
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 1 }}>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: '0.1em', flexWrap: 'wrap' as const, justifyContent: 'flex-end' }}>
            <span style={{ fontSize: 7, letterSpacing: '0.12em', textTransform: 'uppercase' as const, color: 'rgba(242,240,236,0.28)' }}>Designed &amp; Developed by&nbsp;</span>
            <UnrlvlSig size={11} />
          </div>
        </div>
      </footer>
    </div>
  )
}
