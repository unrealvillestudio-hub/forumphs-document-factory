// ============================================================
// DOCUMENT FACTORY — TYPES
// ============================================================
// ---- Parsed data structures ----
export interface SkeletonData {
  ph_name: string
  ph_finca?: string
  ph_codigo?: string
  assembly_type: 'ORDINARIA' | 'EXTRAORDINARIA'
  acta_number?: string
  date_str: string
  time_start: string
  time_end?: string
  total_units: number
  present_units?: number
  quorum_first_call?: boolean
  quorum_pct?: number
  president_name?: string
  president_unit?: string
  secretary_name?: string
  secretary_unit?: string
  agenda_items: AgendaItem[]
  raw_text: string
}
export interface AgendaItem {
  number: number
  title: string
  raw_text?: string
}
export interface AttendanceRecord {
  unit: string
  owner_name: string
  represented_by?: string
  tower?: string
}
export interface VotationRecord {
  topic: string
  yes_votes: number
  no_votes: number
  abstentions?: number
  total_eligible?: number
  pct_yes?: number
  approved: boolean
  raw?: string
}
export interface DebateBlock {
  timestamp?: string
  speaker_raw: string
  speaker_name: string
  speaker_unit?: string
  speaker_role: 'propietario' | 'propietaria' | 'presidente' | 'secretario' | 'administracion' | 'abogado' | 'logistica' | 'unknown'
  text_raw: string
  text_cleaned?: string
  text_formal?: string  // After Paso 0.5
  agenda_section?: number
  skip?: boolean
  skip_reason?: string
}
export interface ParsedHypalZip {
  skeleton: SkeletonData
  attendance: AttendanceRecord[]
  votations: VotationRecord[]
  debates: DebateBlock[]
  chat_notes: string[]
  raw_files: Record<string, string>  // filename → extracted text
}
// ---- Preflight ----
export interface PreflightData {
  finca?: string
  codigo?: string
  convocatoria_text?: string
  has_informe_gestion: boolean
  informe_gestion_text?: string
  vote_screenshots?: string[]  // base64 or URLs
  confirmed_present_units?: number
  confirmed_time_end?: string
  confirmed_agenda_items?: string  // "1. Item\n2. Item\n..." — editable in pre-flight
}
export interface PreflightGap {
  field: keyof PreflightData | string
  label: string
  description: string
  required: boolean
  type: 'text' | 'textarea' | 'number' | 'boolean' | 'file'
  value?: string | number | boolean
}
// ---- Processing pipeline ----
export type PipelineStage =
  | 'idle'
  | 'uploading'
  | 'parsing'
  | 'preflight'
  | 'formalizing'
  | 'building'
  | 'qa_scan'
  | 'ready'
  | 'error'
export interface PipelineProgress {
  stage: PipelineStage
  pct: number
  message: string
  detail?: string
  blocks_total?: number
  blocks_done?: number
  qa_errors?: number
}
export interface FormalizeProgress {
  block_index: number
  total: number
  speaker: string
  unit?: string
  result?: string
  skipped?: boolean
}
// ---- QA ----
export interface QAError {
  type: QAErrorType
  paragraph_index: number
  text_fragment: string
  suggestion?: string
}
export type QAErrorType =
  | 'FIRST_PERSON'
  | 'ORAL_ARTIFACT'
  | 'REPEATED_WORD'
  | 'DANGLING_CONJ'
  | 'INCOMPLETE_SENTENCE'
  | 'NUMBER_FORMAT'
  | 'GENDER_MISMATCH'
  | 'SPOKEN_WORD'
export interface CompletenessItem {
  label: string
  passed: boolean
  detail?: string
}
export interface CompletenessReport {
  score: number
  items: CompletenessItem[]
}
export interface QAReport {
  formalized_pct?: number
  total_errors: number
  by_type: Partial<Record<QAErrorType, number>>
  errors: QAError[]
  word_count: number
  word_count_pct?: number
  completeness?: CompletenessReport
  passed: boolean
  verdict: 'PASS' | 'WARN' | 'FAIL' | 'STOP'
}
// ---- ICR — Industrial Consistency Review ----
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
// ---- Document generation ----
export interface GeneratedActa {
  docx_buffer?: ArrayBuffer
  docx_base64?: string
  filename: string
  word_count: number
  pages_estimate: number
  qa_report: QAReport
}
// ---- App state ----
export interface JobState {
  id: string
  created_at: string
  stage: PipelineStage
  parsed?: ParsedHypalZip
  preflight?: PreflightData
  preflight_gaps?: PreflightGap[]
  formalized_blocks?: DebateBlock[]
  acta_sections?: ActaSection[]
  qa_report?: QAReport
  output_docx_base64?: string
  output_filename?: string
  error?: string
}
export interface ActaSection {
  section_number?: number
  title: string
  paragraphs: ActaParagraph[]
}
export interface ActaParagraph {
  text: string
  style: 'normal' | 'heading1' | 'heading2' | 'list_bullet' | 'indent' | 'centered' | 'signature'
  bold?: boolean
  italic?: boolean
  underline?: boolean
  spacing_before?: number
  indent_left?: number
  mark?: boolean  // highlight
}
// ---- API responses ----
export interface ParseResponse {
  success: boolean
  parsed?: ParsedHypalZip
  preflight_gaps?: PreflightGap[]
  error?: string
}
export interface FormalizeResponse {
  success: boolean
  blocks?: DebateBlock[]
  error?: string
}
export interface GenerateResponse {
  success: boolean
  docx_base64?: string
  filename?: string
  word_count?: number
  qa_report?: QAReport
  acta_text?: string
  error?: string
}
export interface QAScanResponse {
  success: boolean
  report?: QAReport
  error?: string
}
