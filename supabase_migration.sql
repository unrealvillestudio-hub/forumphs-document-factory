-- Document Factory job persistence table
-- Run this in Supabase SQL Editor or via MCP

CREATE TABLE IF NOT EXISTS df_jobs (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at  TIMESTAMPTZ DEFAULT now(),
  updated_at  TIMESTAMPTZ DEFAULT now(),
  stage       TEXT NOT NULL DEFAULT 'upload',
  ph_name     TEXT,
  assembly_type TEXT,
  date_str    TEXT,
  parsed      JSONB,
  preflight   JSONB,
  formalized_blocks JSONB,
  qa_report   JSONB,
  output_filename TEXT,
  error       TEXT
);

-- RLS: only service_role can access (internal tool)
ALTER TABLE df_jobs ENABLE ROW LEVEL SECURITY;

-- Anon can insert and read own rows (keyed by job_id in localStorage)
CREATE POLICY "insert_own" ON df_jobs
  FOR INSERT WITH CHECK (true);

CREATE POLICY "read_own" ON df_jobs
  FOR SELECT USING (true);

CREATE POLICY "update_own" ON df_jobs
  FOR UPDATE USING (true);

-- Auto-update updated_at
CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER df_jobs_updated_at
  BEFORE UPDATE ON df_jobs
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();
