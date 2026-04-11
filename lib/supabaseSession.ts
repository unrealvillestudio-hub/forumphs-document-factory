/**
 * supabaseSession.ts
 * Persists Document Factory job state to Supabase.
 * Table: df_jobs (created via migration below)
 *
 * CREATE TABLE IF NOT EXISTS df_jobs (
 *   id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
 *   created_at TIMESTAMPTZ DEFAULT now(),
 *   updated_at TIMESTAMPTZ DEFAULT now(),
 *   stage TEXT NOT NULL,
 *   ph_name TEXT,
 *   assembly_type TEXT,
 *   date_str TEXT,
 *   parsed JSONB,
 *   preflight JSONB,
 *   formalized_blocks JSONB,
 *   qa_report JSONB,
 *   output_filename TEXT,
 *   error TEXT
 * );
 * ALTER TABLE df_jobs ENABLE ROW LEVEL SECURITY;
 * CREATE POLICY "service_role_only" ON df_jobs USING (false);
 */

import type { JobState } from './types'

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://amlvyycfepwhiindxgzw.supabase.co'
const SUPABASE_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || ''

const STORAGE_KEY = 'df_job_id'

// ---- Client-side: save job_id to localStorage ----

export function saveJobId(id: string): void {
  try { localStorage.setItem(STORAGE_KEY, id) } catch { /* ignore */ }
}

export function loadJobId(): string | null {
  try { return localStorage.getItem(STORAGE_KEY) } catch { return null }
}

export function clearJobId(): void {
  try { localStorage.removeItem(STORAGE_KEY) } catch { /* ignore */ }
}

// ---- API calls (client-side, using anon key) ----

async function supabaseFetch(path: string, options: RequestInit = {}) {
  if (!SUPABASE_KEY) return null
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      'apikey': SUPABASE_KEY,
      'Authorization': `Bearer ${SUPABASE_KEY}`,
      ...options.headers,
    },
  })
  if (!res.ok) return null
  const text = await res.text()
  return text ? JSON.parse(text) : null
}

export async function createJob(state: Partial<JobState>): Promise<string | null> {
  const data = await supabaseFetch('df_jobs?select=id', {
    method: 'POST',
    headers: { 'Prefer': 'return=representation' },
    body: JSON.stringify({
      stage: state.stage || 'upload',
      ph_name: state.parsed?.skeleton?.ph_name,
      assembly_type: state.parsed?.skeleton?.assembly_type,
      date_str: state.parsed?.skeleton?.date_str,
      parsed: state.parsed ? JSON.stringify(state.parsed) : null,
      preflight: state.preflight ? JSON.stringify(state.preflight) : null,
    }),
  })
  return data?.[0]?.id || null
}

export async function updateJob(id: string, update: Partial<JobState>): Promise<void> {
  const body: Record<string, unknown> = {
    stage: update.stage,
    updated_at: new Date().toISOString(),
  }
  if (update.preflight) body.preflight = JSON.stringify(update.preflight)
  if (update.formalized_blocks) body.formalized_blocks = JSON.stringify(update.formalized_blocks)
  if (update.qa_report) body.qa_report = JSON.stringify(update.qa_report)
  if (update.output_filename) body.output_filename = update.output_filename
  if (update.error) body.error = update.error

  await supabaseFetch(`df_jobs?id=eq.${id}`, {
    method: 'PATCH',
    body: JSON.stringify(body),
  })
}

export async function loadJob(id: string): Promise<JobState | null> {
  const data = await supabaseFetch(`df_jobs?id=eq.${id}&select=*`)
  if (!data?.[0]) return null
  const row = data[0]
  return {
    id: row.id,
    created_at: row.created_at,
    stage: row.stage,
    parsed: row.parsed ? JSON.parse(row.parsed) : undefined,
    preflight: row.preflight ? JSON.parse(row.preflight) : undefined,
    formalized_blocks: row.formalized_blocks ? JSON.parse(row.formalized_blocks) : undefined,
    qa_report: row.qa_report ? JSON.parse(row.qa_report) : undefined,
    output_filename: row.output_filename,
    error: row.error,
  }
}
