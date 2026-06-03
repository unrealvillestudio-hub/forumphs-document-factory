-- ============================================================================
-- Fase 2 · 03 — Función normalize_unit() + backfill de canonical_key
-- Determinística: lee building_normalization, aplica el primer patrón que casa
-- (priority asc), sustituye el template con los grupos capturados, devuelve la
-- clave en MAYÚSCULAS sin espacios. Si ningún patrón casa → NULL (auto-
-- diagnosticante: el lookup de finca verá NULL y levantará warning ICR, en vez
-- de devolver una finca equivocada en silencio).
--
-- El "al vuelo" queda SOLO como generación; la ruta de lookup siempre lee la
-- columna persistida units.canonical_key.
-- ============================================================================

CREATE OR REPLACE FUNCTION normalize_unit(
  p_building_id uuid,
  p_unit_code   text,
  p_tower       text
) RETURNS text
LANGUAGE plpgsql
STABLE
AS $$
DECLARE
  rule   record;
  m      text[];
  key    text;
  tok    text;
  gname  text;
  gidx   int;
  names  text[];
BEGIN
  IF p_unit_code IS NULL THEN RETURN NULL; END IF;

  FOR rule IN
    SELECT source_pattern, tower_strategy, canonical_template
    FROM building_normalization
    WHERE building_id = p_building_id AND is_active
    ORDER BY priority ASC
  LOOP
    -- Does this pattern match?
    IF p_unit_code ~ rule.source_pattern THEN
      key := rule.canonical_template;

      -- Substitute each named group {name} in the template with its capture.
      -- Extract group names from the pattern's (?<name>...) occurrences.
      names := ARRAY(
        SELECT (regexp_matches(rule.source_pattern, '\(\?<([a-z]+)>', 'g'))[1]
      );
      m := regexp_match(p_unit_code, rule.source_pattern);
      -- m[1..n] correspond to the named groups in order of appearance.
      gidx := 1;
      FOREACH gname IN ARRAY names LOOP
        key := replace(key, '{' || gname || '}', COALESCE(m[gidx], ''));
        gidx := gidx + 1;
      END LOOP;

      -- Tower handling.
      IF rule.tower_strategy = 'explicit' THEN
        key := replace(key, '{tower}', COALESCE(UPPER(p_tower), 'NA'));
      END IF;
      -- For 'embedded_prefix', {tower} was already captured as a named group.
      -- For 'none', any stray {tower} token is cleared.
      key := replace(key, '{tower}', '');

      -- Normalize: uppercase, strip spaces, collapse separators.
      key := UPPER(regexp_replace(key, '\s+', '', 'g'));
      RETURN key;
    END IF;
  END LOOP;

  -- No pattern matched → NULL (surfaces as [FINCA PENDIENTE] / ICR warning).
  RETURN NULL;
END;
$$;

COMMENT ON FUNCTION normalize_unit(uuid, text, text) IS
  'Determinística unidad→clave canónica. Lee building_normalization (first-match por priority). NULL si nada casa = auto-diagnóstico.';

-- ── Backfill: poblar canonical_key en todas las unidades ────────────────────
UPDATE units u
SET canonical_key = normalize_unit(u.building_id, u.unit_code, u.tower);
