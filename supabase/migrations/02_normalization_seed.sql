-- ============================================================================
-- Fase 2 · 02 — Seed de building_normalization (multi-patrón por edificio)
-- Patrones VALIDADOS read-only contra los unit_code reales (2026-06-01):
-- cubren el 100% de las unidades en los 7 PHs sanos. Venezia queda fuera a
-- propósito (corrupto → reimportación).
--
-- first-match-wins por priority ascendente. Tokens en canonical_template:
-- {tower} {floor} {unit} {wing} {block} {num}. Clave final: UPPER, sin espacios.
-- Idempotente vía ON CONFLICT (building_id, source_pattern).
-- ============================================================================

INSERT INTO building_normalization
  (building_id, source_pattern, tower_strategy, canonical_template, priority, notes)
VALUES
  -- Firenze Tower — '06-A'. 80/80.
  ('16a68732-256d-49d6-ae47-adcd72225c1a',
   '^(?<floor>\d{1,2})-(?<unit>[A-Z])$', 'none', '{floor}-{unit}', 100,
   'Piso-letra. 80/80 finca.'),

  -- Lefevre 75 — '01-E-A' (piso-ala E/O-letra). 184/186.
  ('d30e6888-1fc3-43bc-960c-94a012b753d0',
   '^(?<floor>\d{1,2})-(?<wing>[EO])-(?<unit>[A-Z])$', 'none', '{floor}-{wing}-{unit}', 100,
   'Piso-ala(E/O)-letra. 184/186: faltan 2 finca (deuda datos). E/O es ala, no torre.'),

  -- Los Álamos — 'C-001'. 227/329 finca (102 deuda datos, no del patrón).
  ('e90da0fd-bb6e-4e4d-9015-50e0c17a1794',
   '^(?<block>[A-Z])-(?<num>\d{3})$', 'none', '{block}-{num}', 100,
   'Bloque-número. Patrón cubre 328/329; 102 sin finca = deuda de datos.'),

  -- Luxor Towers 300 — 'T3 07-A' / 'T3 01-OF'. 143/143 VALIDACIÓN.
  ('4a798598-3b94-438e-9b49-bdc15985d365',
   '^(?<tower>T\d)\s+(?<floor>\d{2})-(?<unit>[A-Z]{1,2})$', 'embedded_prefix', '{tower}|{floor}-{unit}', 100,
   'Torre embebida (T3) + piso + tipo(A/B/C/D/OF/LC). 143/143. Caso de validación.'),

  -- Parque Central Arraiján — residencial '1-001' + comercial 'C1-01'. 82/82.
  ('7e11008d-89da-4228-8e16-39bb24d0b37f',
   '^(?<block>\d)-(?<num>\d{3})$', 'none', '{block}-{num}', 100,
   'Residencial edificio-número (72 uds).'),
  ('7e11008d-89da-4228-8e16-39bb24d0b37f',
   '^(?<block>C\d)-(?<num>\d{2})$', 'none', '{block}-{num}', 110,
   'Comercial Cn-NN (10 uds). Total con residencial: 82/82.'),

  -- Plaza España — residencial '1-1A' + locales 'L-01' + planta baja 'PB-A'. 70/70.
  ('3429020f-c002-42c8-97d3-afd5ea2552a2',
   '^(?<block>\d)-(?<floor>\d)(?<unit>[A-Z])$', 'none', '{block}-{floor}{unit}', 100,
   'Residencial edificio-piso+letra (64 uds).'),
  ('3429020f-c002-42c8-97d3-afd5ea2552a2',
   '^(?<block>L)-(?<num>\d{2})$', 'none', '{block}-{num}', 110,
   'Locales L-NN (4 uds).'),
  ('3429020f-c002-42c8-97d3-afd5ea2552a2',
   '^(?<block>PB)-(?<unit>[A-Z])$', 'none', '{block}-{unit}', 120,
   'Planta baja PB-X (2 uds). Total: 70/70.'),

  -- Torres de Castilla — '10-A' + columna tower (A/B). 306/306. Torre OBLIGATORIA en clave.
  ('33560559-1fec-47fc-9086-206817a00153',
   '^(?<floor>\d{1,2})-(?<unit>[A-Z])$', 'explicit', '{tower}|{floor}-{unit}', 100,
   'Piso-letra + tower en columna (A/B). 306/306. Códigos repetidos entre torres → tower disambigua.'),

  -- Venezia Tower — CORRUPTO. Patrón imposible → canonical_key NULL → warning ICR.
  ('2b61944c-6a14-4177-a870-7bbecea17803',
   '^__REQUIERE_REIMPORTACION__$', 'none', '{unit}', 100,
   'CORRUPTO: unit_code = formulas Excel (=SUM..), 364=dup x2 de 182. Patron imposible a proposito. NO normalizar hasta reimportar.')
ON CONFLICT (building_id, source_pattern) DO UPDATE SET
  tower_strategy     = EXCLUDED.tower_strategy,
  canonical_template = EXCLUDED.canonical_template,
  priority           = EXCLUDED.priority,
  notes              = EXCLUDED.notes,
  updated_at         = now();
