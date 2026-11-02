-- ============================================================================
-- 05_bizdev_costo_por_ph.sql — Fee-Calculator: costo directo fijo por PH (parámetros v1.2)
--
-- ⚠️ PROYECTO DESTINO: unrlvl-db (amlvyycfepwhiindxgzw). No es forumphs-db.
--
-- Origen: Sam, 2026-11-02 — Ivette informó de un servicio de carga de planillas que se paga a
-- $50 por cada PH, así que cada PH nuevo suma $50 de costo directo al mes.
--
-- Qué hace:
--   1. Añade fphs_fee_params.costo_por_ph (numeric, default 0). v1.1 queda en 0: sus cotizaciones
--      y sus pruebas no cambian.
--   2. Inserta la versión v1.2 = v1.1 + costo_por_ph 50. Pasa a ser la vigente: misma valid_from,
--      created_at posterior (lib/bizdev/db.ts ordena por valid_from desc, created_at desc).
--
-- Compatible con el código desplegado antes o después: la columna es aditiva con default, y
-- lib/bizdev/feeModel.ts trata su ausencia como 0. Idempotente. Sin BEGIN/COMMIT propio (ensayo).
-- Reversión: delete from fphs_fee_params where version='v1.2' (solo si ninguna cotización la usa)
--            y alter table ... drop column costo_por_ph.
-- ============================================================================

alter table public.fphs_fee_params
  add column if not exists costo_por_ph numeric not null default 0 check (costo_por_ph >= 0);

insert into public.fphs_fee_params
  (version, valid_from, costo_total, m2_total, u_total, personas_total, peso_m2, piso_personas,
   cap_unidades, cap_m2, salario_std, carga_planilla, itbms, margenes, tiers, costo_por_ph, fuente, notas)
select 'v1.2', p.valid_from, p.costo_total, p.m2_total, p.u_total, p.personas_total, p.peso_m2, p.piso_personas,
       p.cap_unidades, p.cap_m2, p.salario_std, p.carga_planilla, p.itbms, p.margenes, p.tiers, 50,
       'v1.1 + costo por PH informado por Ivette a Sam el 2026-11-02',
       'Servicio de carga de planillas: $50 al mes por cada PH administrado. Se suma al costo base antes del margen.'
from public.fphs_fee_params p
where p.version = 'v1.1'
on conflict (version) do nothing;
