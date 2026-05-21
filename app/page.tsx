'use client'

import { useState, useCallback } from 'react'
import UploadZone from '@/components/UploadZone'
import PreflightForm from '@/components/PreflightForm'
import ProcessingPipeline from '@/components/ProcessingPipeline'
import QAReport from '@/components/QAReport'
import ICRReportView from '@/components/ICRReport'
import ICRResolution from '@/components/ICRResolution'
import type {
  ParsedHypalZip,
  PreflightData,
  PreflightGap,
  DebateBlock,
  QAReport as QAReportType,
  ICRReport as ICRReportType,
} from '@/lib/types'
import type { ProcessedBlock } from '@/components/ICRResolution'

type Stage =
  | 'upload'
  | 'preflight'
  | 'formalizing'
  | 'generating'
  | 'qa'
  | 'icr'
  | 'icr_resolving'
  | 'regenerating'
  | 'done'
  | 'error'

export default function Home() {
  const [stage, setStage]                     = useState<Stage>('upload')
  const [parsed, setParsed]                   = useState<ParsedHypalZip | null>(null)
  const [preflightGaps, setPreflightGaps]     = useState<PreflightGap[]>([])
  const [preflight, setPreflight]             = useState<PreflightData | null>(null)
  const [formalizedBlocks, setFormalizedBlocks] = useState<DebateBlock[]>([])
  const [wordCount, setWordCount]             = useState(0)
  const [qaReport, setQaReport]               = useState<QAReportType | null>(null)
  const [icrReport, setIcrReport]             = useState<ICRReportType | null>(null)
  const [icrLoading, setIcrLoading]           = useState(false)
  const [docxBase64, setDocxBase64]           = useState<string | null>(null)
  const [filename, setFilename]               = useState('')
  const [error, setError]                     = useState('')
  const [retryAttempt, setRetryAttempt]       = useState(0)

  // ── 1. ZIP → parse ───────────────────────────────────────────────────────
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

  // ── 2. Preflight → formalizing ───────────────────────────────────────────
  const handlePreflightSubmit = useCallback((
    answers: Record<string, string | number | boolean>,
    informe?: string,
  ) => {
    if (!parsed) return

    // Map answers back to PreflightData
    const pf: PreflightData = {
      has_informe_gestion: Boolean(answers['has_informe_gestion'] ?? false),
      finca:                 answers['finca'] ? String(answers['finca']) : undefined,
      codigo:                answers['codigo'] ? String(answers['codigo']) : undefined,
      convocatoria_text:     answers['convocatoria_text'] ? String(answers['convocatoria_text']) : undefined,
      informe_gestion_text:  informe || undefined,
      confirmed_present_units: answers['confirmed_present_units'] ? Number(answers['confirmed_present_units']) : undefined,
      confirmed_time_end:    answers['confirmed_time_end'] ? String(answers['confirmed_time_end']) : undefined,
      confirmed_agenda_items: answers['confirmed_agenda_items'] ? String(answers['confirmed_agenda_items']) : undefined,
    }
    setPreflight(pf)

    // Patch skeleton with confirmed values
    if (pf.confirmed_present_units) parsed.skeleton.present_units = pf.confirmed_present_units
    if (pf.confirmed_time_end)       parsed.skeleton.time_end      = pf.confirmed_time_end
    if (pf.confirmed_agenda_items) {
      const lines = pf.confirmed_agenda_items.split('\n').filter(Boolean)
      parsed.skeleton.agenda_items = lines.map((line, i) => {
        const m = line.match(/^(\d+)[.)]\s*(.+)/)
        return { number: m ? parseInt(m[1]) : i + 1, title: m ? m[2].trim() : line.trim() }
      })
    }
    if (pf.finca)  parsed.skeleton.ph_finca  = pf.finca
    if (pf.codigo) parsed.skeleton.ph_codigo = pf.codigo

    setStage('formalizing')
  }, [parsed])

  // ── 3. Formalize → generate ───────────────────────────────────────────────
  const handleFormalizeComplete = useCallback(async (blocks: DebateBlock[]) => {
    if (!parsed) return
    setFormalizedBlocks(blocks)
    setStage('generating')
    try {
      const res = await fetch('/api/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          skeleton:          parsed.skeleton,
          attendance:        parsed.attendance,
          votations:         parsed.votations,
          formalized_blocks: blocks,
          preflight,
          images:            parsed.images ?? [],
          chat_notes:        parsed.chat_notes ?? [],
        }),
      })
      const json = await res.json()
      if (!json.success) throw new Error(json.error ?? 'Error al generar el acta')
      setDocxBase64(json.docx_base64)
      setFilename(json.filename ?? 'acta.docx')
      setWordCount(json.word_count ?? 0)
      setQaReport(json.qa_report ?? null)
      setStage('qa')
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
      setStage('error')
    }
  }, [parsed, preflight])

  // ── 4. QA → fetch ICR ────────────────────────────────────────────────────
  const handleQAContinue = useCallback(async () => {
    if (!docxBase64 || !parsed) return
    setIcrLoading(true)
    setStage('icr')
    try {
      const res = await fetch('/api/icr', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          skeleton:          parsed.skeleton,
          attendance:        parsed.attendance,
          votations:         parsed.votations,
          formalized_blocks: formalizedBlocks,
          docx_base64:       docxBase64,
        }),
      })
      const json = await res.json()
      if (!json.success) throw new Error(json.error ?? 'Error en ICR')
      setIcrReport(json.report)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
      setStage('error')
    } finally {
      setIcrLoading(false)
    }
  }, [docxBase64, parsed, formalizedBlocks])

  // ── 5. ICR resolution complete ────────────────────────────────────────────
  const handleICRComplete = useCallback(async (
    correctedBlocks: ProcessedBlock[],
    appliedCount: number,
  ) => {
    if (appliedCount === 0 || !parsed) {
      setStage('done')
      return
    }
    // Re-generate with corrected blocks
    setStage('regenerating')
    try {
      const res = await fetch('/api/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          skeleton:          parsed.skeleton,
          attendance:        parsed.attendance,
          votations:         parsed.votations,
          formalized_blocks: correctedBlocks,
          preflight,
          images:            parsed.images ?? [],
          chat_notes:        parsed.chat_notes ?? [],
        }),
      })
      const json = await res.json()
      if (!json.success) throw new Error(json.error ?? 'Error al regenerar')
      setDocxBase64(json.docx_base64)
      setFilename(json.filename ?? 'acta.docx')
      setStage('done')
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
      setStage('error')
    }
  }, [parsed, preflight])

  // ── Retry formalizing ─────────────────────────────────────────────────────
  const handleRegenerate = useCallback(() => {
    setRetryAttempt(r => r + 1)
    setStage('formalizing')
  }, [])

  // ── Reset ─────────────────────────────────────────────────────────────────
  const handleReset = useCallback(() => {
    setStage('upload'); setParsed(null); setPreflightGaps([]); setPreflight(null)
    setFormalizedBlocks([]); setWordCount(0); setQaReport(null)
    setIcrReport(null); setIcrLoading(false); setDocxBase64(null)
    setFilename(''); setError(''); setRetryAttempt(0)
  }, [])

  // ── Download ──────────────────────────────────────────────────────────────
  const handleDownload = useCallback(() => {
    if (!docxBase64) return
    const bytes = Uint8Array.from(atob(docxBase64), c => c.charCodeAt(0))
    const blob  = new Blob([bytes], { type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' })
    const url   = URL.createObjectURL(blob)
    const a     = document.createElement('a')
    a.href = url; a.download = filename || 'acta.docx'; a.click()
    URL.revokeObjectURL(url)
  }, [docxBase64, filename])

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <div style={{ minHeight: '100vh', background: 'var(--carbon-deep)', paddingTop: 44 }}>
      <div style={{ maxWidth: 780, margin: '0 auto', padding: '40px 24px 100px' }}>

        {stage === 'upload' && (
          <UploadZone onDataReady={handleDataReady} loading={false} />
        )}

        {stage === 'preflight' && parsed && (
          <PreflightForm
            gaps={preflightGaps}
            parsed={parsed}
            onSubmit={handlePreflightSubmit}
          />
        )}

        {stage === 'formalizing' && parsed && (
          <ProcessingPipeline
            key={retryAttempt}
            blocks={parsed.debates}
            skeleton={parsed.skeleton}
            onComplete={handleFormalizeComplete}
            retryAttempt={retryAttempt}
          />
        )}

        {(stage === 'generating' || stage === 'regenerating') && (
          <div className="fade-in" style={{ textAlign: 'center', padding: '80px 0' }}>
            <div style={{ width: 48, height: 48, border: '2px solid rgba(92,52,114,0.3)', borderTop: '2px solid var(--amatista)', borderRadius: '50%', margin: '0 auto 24px', animation: 'spin-slow 1s linear infinite' }} />
            <h2 style={{ fontFamily: 'EB Garamond, serif', fontSize: 28, fontWeight: 400, color: 'var(--parch)', margin: '0 0 8px' }}>
              {stage === 'regenerating' ? 'Aplicando correcciones…' : 'Generando el acta…'}
            </h2>
            <p style={{ color: 'var(--parch-dim)', fontSize: 14, margin: 0 }}>
              Claude está construyendo el documento en tercera persona legal…
            </p>
          </div>
        )}

        {stage === 'qa' && qaReport && docxBase64 && (
          <QAReport
            report={qaReport}
            wordCount={wordCount}
            filename={filename}
            onDownload={handleDownload}
            onRegenerate={handleRegenerate}
            showDownload={true}
            onContinue={handleQAContinue}
            continueLabel="Continuar → ICR"
          />
        )}

        {stage === 'icr' && (
          <>
            <ICRReportView report={icrReport!} loading={icrLoading} />
            {!icrLoading && icrReport && (
              <ICRResolution
                findings={icrReport.findings}
                blocks={formalizedBlocks as ProcessedBlock[]}
                onComplete={handleICRComplete}
                onBack={() => setStage('qa')}
              />
            )}
          </>
        )}

        {stage === 'done' && docxBase64 && (
          <div className="fade-in" style={{ textAlign: 'center', padding: '60px 0' }}>
            <div style={{ width: 64, height: 64, background: 'rgba(74,222,128,0.1)', border: '2px solid rgba(74,222,128,0.3)', borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 24px', fontSize: 28 }}>✓</div>
            <h2 style={{ fontFamily: 'EB Garamond, serif', fontSize: 36, fontWeight: 400, color: 'var(--parch)', margin: '0 0 8px' }}>Acta lista</h2>
            <p style={{ color: 'var(--parch-dim)', fontSize: 15, margin: '0 0 32px', fontFamily: 'EB Garamond, serif', fontStyle: 'italic' }}>{filename}</p>
            <div style={{ display: 'flex', gap: 12, justifyContent: 'center', flexWrap: 'wrap' }}>
              <button onClick={handleDownload}
                style={{ padding: '13px 32px', background: 'var(--amatista)', border: 'none', borderRadius: 10, color: '#fff', fontSize: 15, fontWeight: 700, cursor: 'pointer' }}>
                ⬇ Descargar DOCX
              </button>
              <button onClick={handleReset}
                style={{ padding: '13px 24px', background: 'transparent', border: '1px solid rgba(200,196,190,0.2)', borderRadius: 10, color: 'var(--parch-dim)', fontSize: 14, cursor: 'pointer' }}>
                Nueva acta
              </button>
            </div>
          </div>
        )}

        {stage === 'error' && (
          <div className="fade-in" style={{ textAlign: 'center', padding: '60px 0' }}>
            <div style={{ fontSize: 48, marginBottom: 20 }}>⚠️</div>
            <h2 style={{ fontFamily: 'EB Garamond, serif', fontSize: 28, color: 'var(--terra)', margin: '0 0 12px' }}>Error en el proceso</h2>
            <p style={{ color: 'var(--parch-dim)', fontSize: 14, margin: '0 0 32px', maxWidth: 480, marginLeft: 'auto', marginRight: 'auto' }}>{error}</p>
            <button onClick={handleReset}
              style={{ padding: '12px 28px', background: 'rgba(196,98,45,0.15)', border: '1px solid rgba(196,98,45,0.3)', borderRadius: 10, color: 'var(--terra)', fontSize: 14, cursor: 'pointer' }}>
              ↺ Reiniciar
            </button>
          </div>
        )}

      </div>
    </div>
  )
}
