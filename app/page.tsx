'use client'

import { useState, useCallback } from 'react'
import UploadZone from '@/components/UploadZone'
import PreflightForm from '@/components/PreflightForm'
import ProcessingPipeline from '@/components/ProcessingPipeline'
import QAReport from '@/components/QAReport'
import ICRReport from '@/components/ICRReport'
import ICRResolution from '@/components/ICRResolution'
import type {
  ParsedHypalZip,
  PreflightData,
  PreflightGap,
  DebateBlock,
  QAReport as QAReportType,
  ICRReport as ICRReportType,
} from '@/lib/types'

type Stage =
  | 'upload'
  | 'preflight'
  | 'formalizing'
  | 'generating'
  | 'qa'
  | 'icr'
  | 'done'
  | 'error'

export default function Home() {
  const [stage, setStage] = useState<Stage>('upload')
  const [parsed, setParsed] = useState<ParsedHypalZip | null>(null)
  const [preflightGaps, setPreflightGaps] = useState<PreflightGap[]>([])
  const [preflight, setPreflight] = useState<PreflightData | null>(null)
  const [formalizedBlocks, setFormalizedBlocks] = useState<DebateBlock[]>([])
  const [qaReport, setQaReport] = useState<QAReportType | null>(null)
  const [icrReport, setIcrReport] = useState<ICRReportType | null>(null)
  const [docxBase64, setDocxBase64] = useState<string | null>(null)
  const [filename, setFilename] = useState<string>('')
  const [error, setError] = useState<string>('')
  const [generating, setGenerating] = useState(false)
  const [retryAttempt, setRetryAttempt] = useState(0)

  // ── 1. ZIP uploaded → parse ──────────────────────────────────────────────
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const handleDataReady = useCallback(async (data: Record<string, any>) => {
    setError('')
    try {
      const res = await fetch('/api/parse', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      })
      const json = await res.json()
      if (!json.success) throw new Error(json.error ?? 'Error al parsear el ZIP')
      setParsed(json.parsed)
      setPreflightGaps(json.preflight_gaps ?? [])
      setStage('preflight')
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
      setStage('error')
    }
  }, [])

  // ── 2. Preflight submitted → start formalizing ───────────────────────────
  const handlePreflightSubmit = useCallback((data: PreflightData) => {
    if (!parsed) return
    setPreflight(data)

    // Apply confirmed values to skeleton
    if (data.confirmed_present_units) parsed.skeleton.present_units = data.confirmed_present_units
    if (data.confirmed_time_end) parsed.skeleton.time_end = data.confirmed_time_end
    if (data.confirmed_agenda_items) {
      const lines = data.confirmed_agenda_items.split('\n').filter(Boolean)
      parsed.skeleton.agenda_items = lines.map((line, i) => {
        const m = line.match(/^(\d+)[.)]\s*(.+)/)
        return { number: m ? parseInt(m[1]) : i + 1, title: m ? m[2].trim() : line.trim() }
      })
    }
    if (data.finca) parsed.skeleton.ph_finca = data.finca
    if (data.codigo) parsed.skeleton.ph_codigo = data.codigo

    setStage('formalizing')
  }, [parsed])

  // ── 3. Formalizing done → generate DOCX ─────────────────────────────────
  const handleFormalizeComplete = useCallback(async (blocks: DebateBlock[]) => {
    if (!parsed) return
    setFormalizedBlocks(blocks)
    setGenerating(true)
    setStage('generating')
    try {
      const res = await fetch('/api/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          skeleton: parsed.skeleton,
          attendance: parsed.attendance,
          votations: parsed.votations,
          formalized_blocks: blocks,
          preflight,
          images: parsed.images ?? [],
          chat_notes: parsed.chat_notes ?? [],
        }),
      })
      const json = await res.json()
      if (!json.success) throw new Error(json.error ?? 'Error al generar el acta')
      setDocxBase64(json.docx_base64)
      setFilename(json.filename ?? 'acta.docx')
      setQaReport(json.qa_report ?? null)
      setStage('qa')
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
      setStage('error')
    } finally {
      setGenerating(false)
    }
  }, [parsed, preflight])

  // ── 4. QA approved → ICR ─────────────────────────────────────────────────
  const handleQAApprove = useCallback(async () => {
    if (!docxBase64 || !parsed) return
    try {
      const res = await fetch('/api/icr', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          skeleton: parsed.skeleton,
          attendance: parsed.attendance,
          votations: parsed.votations,
          formalized_blocks: formalizedBlocks,
          docx_base64: docxBase64,
        }),
      })
      const json = await res.json()
      if (!json.success) throw new Error(json.error ?? 'Error en ICR')
      setIcrReport(json.report)
      setStage('icr')
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
      setStage('error')
    }
  }, [docxBase64, parsed, formalizedBlocks])

  // ── 5. ICR apply corrections → done ──────────────────────────────────────
  const handleICRApply = useCallback(async (correctedBase64: string) => {
    setDocxBase64(correctedBase64)
    setStage('done')
  }, [])

  const handleICRSkip = useCallback(() => setStage('done'), [])

  // ── Retry formalizing ────────────────────────────────────────────────────
  const handleRetry = useCallback(() => {
    setRetryAttempt(r => r + 1)
    setStage('formalizing')
  }, [])

  // ── Reset ────────────────────────────────────────────────────────────────
  const handleReset = useCallback(() => {
    setStage('upload')
    setParsed(null)
    setPreflightGaps([])
    setPreflight(null)
    setFormalizedBlocks([])
    setQaReport(null)
    setIcrReport(null)
    setDocxBase64(null)
    setFilename('')
    setError('')
    setGenerating(false)
    setRetryAttempt(0)
  }, [])

  // ── Download ─────────────────────────────────────────────────────────────
  const handleDownload = useCallback(() => {
    if (!docxBase64) return
    const bytes = Uint8Array.from(atob(docxBase64), c => c.charCodeAt(0))
    const blob = new Blob([bytes], { type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = filename || 'acta.docx'
    a.click()
    URL.revokeObjectURL(url)
  }, [docxBase64, filename])

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <div style={{ minHeight: '100vh', background: 'var(--carbon-deep)', paddingTop: 44 }}>
      <div style={{ maxWidth: 780, margin: '0 auto', padding: '40px 24px 100px' }}>

        {/* ── UPLOAD ── */}
        {stage === 'upload' && (
          <UploadZone onDataReady={handleDataReady} loading={false} />
        )}

        {/* ── PREFLIGHT ── */}
        {stage === 'preflight' && parsed && (
          <PreflightForm
            skeleton={parsed.skeleton}
            gaps={preflightGaps}
            onSubmit={handlePreflightSubmit}
          />
        )}

        {/* ── FORMALIZING ── */}
        {stage === 'formalizing' && parsed && (
          <ProcessingPipeline
            key={retryAttempt}
            blocks={parsed.debates}
            skeleton={parsed.skeleton}
            onComplete={handleFormalizeComplete}
            retryAttempt={retryAttempt}
          />
        )}

        {/* ── GENERATING ── */}
        {stage === 'generating' && (
          <div className="fade-in" style={{ textAlign: 'center', padding: '80px 0' }}>
            <div style={{ width: 48, height: 48, border: '2px solid rgba(92,52,114,0.3)', borderTop: '2px solid var(--amatista)', borderRadius: '50%', margin: '0 auto 24px', animation: 'spin-slow 1s linear infinite' }} />
            <h2 style={{ fontFamily: 'EB Garamond, serif', fontSize: 28, fontWeight: 400, color: 'var(--parch)', margin: '0 0 8px' }}>Generando el acta</h2>
            <p style={{ color: 'var(--parch-dim)', fontSize: 14, margin: 0 }}>Claude está construyendo el documento en tercera persona legal…</p>
          </div>
        )}

        {/* ── QA ── */}
        {stage === 'qa' && qaReport && docxBase64 && (
          <QAReport
            report={qaReport}
            onApprove={handleQAApprove}
            onRetry={handleRetry}
            onDownloadAnyway={handleDownload}
          />
        )}

        {/* ── ICR ── */}
        {stage === 'icr' && icrReport && docxBase64 && (
          <ICRReport
            report={icrReport}
            docxBase64={docxBase64}
            filename={filename}
            onApply={handleICRApply}
            onSkip={handleICRSkip}
          />
        )}

        {/* ── DONE ── */}
        {stage === 'done' && docxBase64 && (
          <div className="fade-in" style={{ textAlign: 'center', padding: '60px 0' }}>
            <div style={{ width: 64, height: 64, background: 'rgba(74,222,128,0.1)', border: '2px solid rgba(74,222,128,0.3)', borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 24px', fontSize: 28 }}>✓</div>
            <h2 style={{ fontFamily: 'EB Garamond, serif', fontSize: 36, fontWeight: 400, color: 'var(--parch)', margin: '0 0 8px' }}>Acta lista</h2>
            <p style={{ color: 'var(--parch-dim)', fontSize: 15, margin: '0 0 32px', fontFamily: 'EB Garamond, serif', fontStyle: 'italic' }}>{filename}</p>
            <div style={{ display: 'flex', gap: 12, justifyContent: 'center', flexWrap: 'wrap' }}>
              <button
                onClick={handleDownload}
                style={{ padding: '13px 32px', background: 'var(--amatista)', border: 'none', borderRadius: 10, color: '#fff', fontSize: 15, fontWeight: 700, cursor: 'pointer', letterSpacing: '0.02em' }}
              >
                ⬇ Descargar DOCX
              </button>
              <button
                onClick={handleReset}
                style={{ padding: '13px 24px', background: 'transparent', border: '1px solid rgba(200,196,190,0.2)', borderRadius: 10, color: 'var(--parch-dim)', fontSize: 14, cursor: 'pointer' }}
              >
                Nueva acta
              </button>
            </div>
          </div>
        )}

        {/* ── ERROR ── */}
        {stage === 'error' && (
          <div className="fade-in" style={{ textAlign: 'center', padding: '60px 0' }}>
            <div style={{ fontSize: 48, marginBottom: 20 }}>⚠️</div>
            <h2 style={{ fontFamily: 'EB Garamond, serif', fontSize: 28, color: 'var(--terra)', margin: '0 0 12px' }}>Error en el proceso</h2>
            <p style={{ color: 'var(--parch-dim)', fontSize: 14, margin: '0 0 32px', maxWidth: 480, marginLeft: 'auto', marginRight: 'auto' }}>{error}</p>
            <button
              onClick={handleReset}
              style={{ padding: '12px 28px', background: 'rgba(196,98,45,0.15)', border: '1px solid rgba(196,98,45,0.3)', borderRadius: 10, color: 'var(--terra)', fontSize: 14, cursor: 'pointer' }}
            >
              ↺ Reiniciar
            </button>
          </div>
        )}

      </div>
    </div>
  )
}
