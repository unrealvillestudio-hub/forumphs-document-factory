-- ============================================================================
-- 07_bizdev_cotizaciones_manuales.sql — Cotizaciones fuera del modelo (historial) en BizDev
--
-- ⚠️ PROYECTO DESTINO: unrlvl-db (amlvyycfepwhiindxgzw). No es forumphs-db.
--
-- Origen: Sam, 2026-11-03 — «¿por qué no aparece lo cotizado a Plaza 77?» y opción C:
-- las cartas de $1,200 y $1,400 (sep-2026) se hicieron ANTES del Fee-Calculator, así que
-- fphs_quotes (que exigía versión de parámetros y margen) no podía guardarlas.
--
-- Qué hace:
--   1. fphs_quotes.origen ('modelo' | 'manual', default 'modelo'). Las filas existentes quedan 'modelo'.
--   2. params_version, margen, personal_incluido y costo_base pasan a admitir NULL, pero SOLO
--      en origen = 'manual' (CHECK fphs_quotes_modelo_completo): una cotización del modelo sigue
--      exigiéndolos.
--   3. Siembra las dos cartas de Plaza 77 como cotizaciones manuales enviadas y enlaza cada una
--      con la comunicación de su carta (fphs_prospect_comms.quote_id).
--
-- Idempotente. Sin BEGIN/COMMIT propio (ensayo con RAISE EXCEPTION 'ENSAYO_OK').
-- Reversión: borrar las filas origen='manual', restaurar NOT NULL y quitar la columna origen.
-- ============================================================================

alter table public.fphs_quotes
  add column if not exists origen text not null default 'modelo'
    check (origen in ('modelo', 'manual'));

alter table public.fphs_quotes alter column params_version    drop not null;
alter table public.fphs_quotes alter column margen            drop not null;
alter table public.fphs_quotes alter column personal_incluido drop not null;
alter table public.fphs_quotes alter column costo_base        drop not null;

do $chk$
begin
  if not exists (select 1 from pg_constraint where conname = 'fphs_quotes_modelo_completo') then
    alter table public.fphs_quotes add constraint fphs_quotes_modelo_completo check (
      origen = 'manual'
      or (params_version is not null and margen is not null and personal_incluido is not null and costo_base is not null)
    );
  end if;
end
$chk$;

-- Historial de Plaza 77: las dos cartas enviadas en septiembre (montos sin ITBMS; ITBMS 7 %).
insert into public.fphs_quotes
  (prospect_id, origen, unidades, m2, es_casas, personal_extra, honorario, honorario_itbms, estado, enviada_el, doc_ref, created_at)
select p.id, 'manual', p.unidades, p.m2_privados, p.es_casas, '[]'::jsonb, s.honorario, s.con_itbms, 'enviada',
       s.enviada_el, s.doc_ref, s.creada
from public.fphs_prospects p
cross join (values
  (1200.00::numeric, 1284.00::numeric, date '2026-09-19', timestamptz '2026-09-19 16:00-05',
   'https://docs.google.com/document/d/1e4ttofDAmRELb2GIBl3QNYgc5jcSTEWshpOsSmKMb5k/edit'),
  (1400.00::numeric, 1498.00::numeric, date '2026-09-21', timestamptz '2026-09-21 16:00-05',
   'https://docs.google.com/document/d/154ug3G1jsREs69koR-0-7KAUzAVmj11YbkmdvTrxaz4/edit')
) as s(honorario, con_itbms, enviada_el, creada, doc_ref)
where p.code = 'FPHS-P-0001'
  and not exists (
    select 1 from public.fphs_quotes q
    where q.prospect_id = p.id and q.origen = 'manual' and q.honorario = s.honorario and q.enviada_el = s.enviada_el
  );

-- Enlace carta ↔ cotización (por el documento, que es el mismo en las dos tablas).
update public.fphs_prospect_comms c
set quote_id = q.id
from public.fphs_quotes q
where q.prospect_id = c.prospect_id and q.origen = 'manual' and q.doc_ref = c.doc_ref and c.quote_id is null;
