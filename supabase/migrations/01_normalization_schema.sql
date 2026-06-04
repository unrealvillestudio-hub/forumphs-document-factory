-- ============================================================================
-- fphs-formalize sprint · Fase 2 — Normalización unidad→finca (DECISIÓN PERMANENTE)
-- Proyecto: forumphs-db (tajuoqdbnsnzkhyqvdgs)
--
-- Objetivo: matar a nivel DB el bug de duplicados (Torres de Castilla) y dejar
-- la descomposición unidad→clave canónica como DATOS (config por edificio),
-- no como código. Sumar un PH nuevo = INSERT de una fila, sin deploy.
--
-- Principios (sesión 2026-06-01):
--   - canonical_key GUARDADA (no al vuelo), índice único (building_id, canonical_key).
--   - tower-aware: Torres de Castilla repite '10-A' en torres A y B → la torre
--     DEBE entrar en la clave o las dos unidades reales colisionan.
--   - Auto-diagnosticante: lo que no normaliza falla en voz alta (canonical_key
--     NULL) en vez de devolver finca equivocada en silencio.
--
-- Esta migración es IDEMPOTENTE (IF NOT EXISTS / ON CONFLICT) y NO destructiva:
-- agrega columna y tabla, no borra ni reescribe unit_code existentes.
-- El backfill de canonical_key y la creación del índice ÚNICO van en pasos
-- separados (abajo) para poder inspeccionar colisiones ANTES de imponerlo.
-- ============================================================================

-- ── 1 · Tabla de configuración por edificio ────────────────────────────────
CREATE TABLE IF NOT EXISTS building_normalization (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  building_id        uuid NOT NULL REFERENCES buildings(id) ON DELETE CASCADE,
  -- Regex POSIX con grupos nombrados para descomponer unit_code.
  -- Postgres usa (?<name>...) en substring()/regexp; guardamos el patrón y los
  -- nombres de grupo que el normalizador (SQL o app) sabe leer.
  source_pattern     text NOT NULL,
  -- Cómo se obtiene la torre:
  --   'explicit'        → viene de la columna units.tower
  --   'embedded_prefix' → está dentro de unit_code (capturada por el patrón)
  --   'none'            → el edificio no tiene torres
  tower_strategy     text NOT NULL DEFAULT 'none'
                       CHECK (tower_strategy IN ('explicit','embedded_prefix','none')),
  -- Plantilla de ensamblado de la clave canónica usando los grupos capturados,
  -- p.ej. '{tower}|{floor}-{unit}'. El normalizador sustituye los tokens.
  canonical_template text NOT NULL,
  -- Orden de evaluación: patrones de menor priority se prueban primero
  -- (first-match-wins). Permite varios sub-formatos por edificio (p.ej.
  -- residencial '1-001' + comercial 'C1-01' en Parque Central).
  priority           int NOT NULL DEFAULT 100,
  -- Notas humanas (formato observado, casos borde).
  notes              text,
  is_active          boolean DEFAULT true,
  created_at         timestamptz DEFAULT now(),
  updated_at         timestamptz DEFAULT now()
);

-- Un edificio puede tener varios patrones (sub-formatos). La unicidad es por
-- (building_id, source_pattern) para que el seed sea idempotente sin impedir
-- múltiples reglas por edificio.
CREATE UNIQUE INDEX IF NOT EXISTS ux_building_norm_pattern
  ON building_normalization (building_id, source_pattern);

COMMENT ON TABLE building_normalization IS
  'Reglas de normalización unidad→clave canónica POR EDIFICIO. Editable sin deploy. Sumar PH = INSERT fila.';

-- ── 2 · Columna canónica persistida en units ───────────────────────────────
ALTER TABLE units ADD COLUMN IF NOT EXISTS canonical_key text;

COMMENT ON COLUMN units.canonical_key IS
  'Clave canónica persistida (no al vuelo). Poblada por normalizeUnit(). El lookup de finca SIEMPRE lee esta columna. NULL = no normalizable → warning ICR.';

-- NOTA: el índice ÚNICO se crea en un paso separado (04_unique_index.sql) DESPUÉS
-- de poblar canonical_key y verificar que no hay colisiones. Crear el índice
-- único antes del backfill abortaría la migración si hubiera duplicados.
