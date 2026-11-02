-- ============================================================================
-- 04_bizdev.sql — Tab BizDev: Fee-Calculator, cotizaciones y seguimiento de prospectos
--
-- ⚠️ PROYECTO DESTINO: unrlvl-db (amlvyycfepwhiindxgzw).
--    NO es forumphs-db. Los archivos 01–03 de esta carpeta se aplican a forumphs-db
--    (tajuoqdbnsnzkhyqvdgs); este no. Regla de ubicación del 2026-11-01: lo que es de
--    ForumPHs como empresa (costos, cartera, actividad comercial) va en unrlvl-db.
--
-- Brief: Drive Sales-Kit/Fee-Calculator/BRIEF_DF_BizDev_2026-11-02.md (§3 y §0-bis).
-- Modelo: Fee-Calculator_modelo_v1.1_2026-11-02.md (mismo Drive).
-- Exclusivo de ForumPHs (prefijo fphs_): la regla multimarca no aplica
-- (excepción declarada en MULTIBRAND_RULE.md; decisión de Sam del 2026-11-02).
--
-- Acceso: RLS activa y ninguna política. Solo el servidor del Document Factory lee y
-- escribe, con service_role. Los privilegios se escriben explícitos (CC_PROTOCOL §12):
-- los privilegios por defecto de public en este proyecto dan a service_role solo SELECT
-- (medido el 2026-11-02 en pg_default_acl).
--
-- Comunicaciones: MAIL_PRIVACY_RULE.md rige. Ninguna fila sale de un buzón.
-- origen = 'manual' | 'document_factory' hoy; 'communications_service' queda reservado
-- para el futuro unrlvl-communications-services (no integrado).
--
-- Idempotente: IF NOT EXISTS y ON CONFLICT / NOT EXISTS en la semilla. Sin BEGIN/COMMIT
-- propio para que el ensayo (bloque DO con RAISE EXCEPTION 'ENSAYO_OK') pueda ejecutarlo.
-- Reversión: drop table de las 4 tablas y drop sequence (exportar antes si hay datos reales).
-- ============================================================================

-- ── 1 · Parámetros del modelo, versionados ─────────────────────────────────
create table if not exists public.fphs_fee_params (
  version         text primary key,
  valid_from      date    not null,
  costo_total     numeric not null check (costo_total > 0),
  m2_total        numeric not null check (m2_total > 0),
  u_total         numeric not null check (u_total > 0),
  personas_total  numeric not null check (personas_total > 0),
  peso_m2         numeric not null check (peso_m2 between 0 and 1),
  piso_personas   numeric not null check (piso_personas > 0),
  cap_unidades    numeric not null check (cap_unidades > 0),
  cap_m2          numeric not null check (cap_m2 > 0),
  salario_std     numeric not null check (salario_std > 0),
  carga_planilla  numeric not null check (carga_planilla >= 0),
  itbms           numeric not null check (itbms >= 0),
  margenes        numeric[] not null check (cardinality(margenes) > 0),
  -- Umbrales de tier. Semántica (la aplica lib/bizdev/feeModel.ts):
  --   unidades: [a, b] → < a Esencial · a..b-1 Profesional · >= b Élite
  --   m2:       [a, b] → < a Esencial · a..b Profesional   · >  b Élite
  --   precio:   [p, a, b] → < p bajo piso · < a Esencial · < b Profesional · >= b Élite
  tiers           jsonb   not null,
  fuente          text    not null,
  notas           text,
  created_at      timestamptz not null default now()
);

-- ── 2 · Prospectos ─────────────────────────────────────────────────────────
create sequence if not exists public.fphs_prospects_code_seq;

create table if not exists public.fphs_prospects (
  id               uuid primary key default gen_random_uuid(),
  code             text not null unique
                     default ('FPHS-P-' || lpad(nextval('public.fphs_prospects_code_seq')::text, 4, '0')),
  short_name       text not null,
  full_name        text,
  unidades         int     check (unidades >= 0),
  m2_privados      numeric check (m2_privados >= 0),
  es_casas         boolean not null default false,
  fuente_tamano    text,
  clase_evidencia  text,
  etapa            text not null default 'contacto'
                     check (etapa in ('contacto','levantamiento','confidencialidad','cotizado',
                                      'negociacion','ganado','perdido','pausado')),
  contacto_nombre  text,
  contacto_rol     text,
  proxima_accion   text,
  proxima_fecha    date,
  notas            text,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);

-- ── 3 · Cotizaciones ───────────────────────────────────────────────────────
create table if not exists public.fphs_quotes (
  id                 uuid primary key default gen_random_uuid(),
  prospect_id        uuid not null references public.fphs_prospects(id) on delete cascade,
  params_version     text not null references public.fphs_fee_params(version),
  margen             numeric not null check (margen >= 0 and margen < 1),
  unidades           int     not null check (unidades >= 0),
  m2                 numeric not null check (m2 >= 0),
  es_casas           boolean not null default false,
  personal_incluido  numeric not null check (personal_incluido >= 0),
  personal_extra     jsonb   not null default '[]'::jsonb
                       check (jsonb_typeof(personal_extra) = 'array'),
  costo_base         numeric not null check (costo_base >= 0),
  honorario          numeric not null check (honorario >= 0),
  honorario_itbms    numeric not null check (honorario_itbms >= 0),
  estado             text not null default 'borrador'
                       check (estado in ('borrador','enviada','aceptada','rechazada')),
  enviada_el         date,
  doc_ref            text,
  created_at         timestamptz not null default now()
);
create index if not exists fphs_quotes_prospect_idx on public.fphs_quotes (prospect_id, created_at desc);

-- ── 4 · Comunicaciones (línea de tiempo del prospecto) ─────────────────────
create table if not exists public.fphs_prospect_comms (
  id           uuid primary key default gen_random_uuid(),
  prospect_id  uuid not null references public.fphs_prospects(id) on delete cascade,
  fecha        timestamptz not null default now(),
  canal        text not null
                 check (canal in ('whatsapp','correo','llamada','reunion','documento')),
  sentido      text not null
                 check (sentido in ('enviado','recibido','interno')),
  origen       text not null default 'manual'
                 check (origen in ('manual','document_factory','communications_service')),
  resumen      text not null,
  doc_ref      text,
  quote_id     uuid references public.fphs_quotes(id) on delete set null,
  created_at   timestamptz not null default now()
);
create index if not exists fphs_prospect_comms_prospect_idx on public.fphs_prospect_comms (prospect_id, fecha desc);

-- ── 5 · Acceso: RLS sin políticas + privilegios explícitos ─────────────────
alter table public.fphs_fee_params     enable row level security;
alter table public.fphs_prospects      enable row level security;
alter table public.fphs_quotes         enable row level security;
alter table public.fphs_prospect_comms enable row level security;

revoke all on public.fphs_fee_params, public.fphs_prospects, public.fphs_quotes,
              public.fphs_prospect_comms from anon, authenticated;
revoke all on sequence public.fphs_prospects_code_seq from anon, authenticated;

grant select                 on public.fphs_fee_params     to service_role;
grant select, insert, update on public.fphs_prospects      to service_role;
grant select, insert, update on public.fphs_quotes         to service_role;
grant select, insert, update on public.fphs_prospect_comms to service_role;
grant usage, select on sequence public.fphs_prospects_code_seq to service_role;

-- ── 6 · Semilla ────────────────────────────────────────────────────────────
-- 6.1 Parámetros v1.1 (modelo v1.1, validado por Sam el 2026-11-02).
insert into public.fphs_fee_params
  (version, valid_from, costo_total, m2_total, u_total, personas_total, peso_m2, piso_personas,
   cap_unidades, cap_m2, salario_std, carga_planilla, itbms, margenes, tiers, fuente, notas)
values
  ('v1.1', date '2026-11-02', 18921.60, 149043.44, 1327, 9, 0.5, 0.5,
   132, 11909, 900, 0.375, 0.07, array[0.25, 0.30, 0.35, 0.40]::numeric[],
   '{"unidades":[150,280],"m2":[15000,25000],"precio":[1200,2500,4500]}'::jsonb,
   'Drive Sales-Kit/Fee-Calculator/Fee-Calculator_modelo_v1.1_2026-11-02.md',
   'Costo total ene–sep 2026 de los 8 PH; carga patronal de planilla 37.5 % medida en el EEFF.')
on conflict (version) do nothing;

-- 6.2 Prospecto Plaza 77.
insert into public.fphs_prospects
  (code, short_name, full_name, unidades, m2_privados, es_casas, fuente_tamano, clase_evidencia, etapa)
values
  ('FPHS-P-0001', 'Plaza 77', 'P.H. Plaza 77', 60, 7065.19, false, 'RP 2026-10-24', 'A', 'cotizado')
on conflict (code) do nothing;
-- La secuencia arranca después del código sembrado a mano.
select setval('public.fphs_prospects_code_seq',
              greatest((select coalesce(max(substring(code from 'FPHS-P-(\d+)')::int), 1)
                          from public.fphs_prospects), 1));

-- 6.3 Línea de tiempo de Plaza 77, tomada de documentos del Drive (no de ningún buzón).
insert into public.fphs_prospect_comms (prospect_id, fecha, canal, sentido, origen, resumen, doc_ref)
select p.id, s.fecha, 'documento', s.sentido, 'manual', s.resumen, s.doc_ref
from public.fphs_prospects p
cross join (values
  (timestamptz '2026-09-07 12:00-05', 'enviado', 'Levantamiento del PH',
   'https://drive.google.com/file/d/1brQnA_LwSZLj1uzj6eu4c973G1ELRNXi/view'),
  (timestamptz '2026-09-07 17:00-05', 'enviado', 'Acuerdo de confidencialidad',
   'https://drive.google.com/file/d/1FnKp86yYf3ilIlpU26RsqmThqz9VS8n3/view'),
  (timestamptz '2026-09-19 16:00-05', 'enviado', 'Carta de cotización: $1,200 mensuales más ITBMS',
   'https://docs.google.com/document/d/1e4ttofDAmRELb2GIBl3QNYgc5jcSTEWshpOsSmKMb5k/edit'),
  (timestamptz '2026-09-21 16:00-05', 'enviado', 'Carta de cotización: $1,400 mensuales más ITBMS',
   'https://docs.google.com/document/d/154ug3G1jsREs69koR-0-7KAUzAVmj11YbkmdvTrxaz4/edit'),
  (timestamptz '2026-10-24 10:00-05', 'interno', 'Brief para Ivette: investigación en el Registro Público',
   'https://drive.google.com/file/d/1cXj7EpWvSGgEzTEnQwMmSDdRBLVr9RGX/view')
) as s(fecha, sentido, resumen, doc_ref)
where p.code = 'FPHS-P-0001'
  and not exists (
    select 1 from public.fphs_prospect_comms c
    where c.prospect_id = p.id and c.fecha = s.fecha and c.resumen = s.resumen
  );
