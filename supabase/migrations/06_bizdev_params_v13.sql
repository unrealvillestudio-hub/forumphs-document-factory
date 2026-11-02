-- ============================================================================
-- 06_bizdev_params_v13.sql — Fee-Calculator: parámetros v1.3 (sin doble conteo del costo por PH)
--
-- ⚠️ PROYECTO DESTINO: unrlvl-db (amlvyycfepwhiindxgzw). No es forumphs-db.
--
-- Origen: Sam, 2026-11-02 — «los $50 de los PH actuales están en los EEFFs».
-- v1.2 (05_bizdev_costo_por_ph.sql) sumaba $50 por PH sobre un costo_total que ya incluía los
-- $400 de los 8 PH actuales: los contaba dos veces. v1.3 los saca del costo repartido y los deja
-- solo como costo directo por PH:
--   costo_total  = 18,921.60 − 8 × 50 = 18,521.60
--   costo_por_ph = 50
-- Todo lo demás, igual que v1.2. Pasa a ser la vigente (misma valid_from, created_at posterior).
-- v1.1 y v1.2 se conservan como historia de versiones.
--
-- Plaza 77 al 30 % con v1.3: 1,541.40 (lib/bizdev/feeModel.test.ts).
-- Idempotente. Sin BEGIN/COMMIT propio (ensayo).
-- Reversión: delete from fphs_fee_params where version='v1.3' (solo si ninguna cotización la usa).
-- ============================================================================

insert into public.fphs_fee_params
  (version, valid_from, costo_total, m2_total, u_total, personas_total, peso_m2, piso_personas,
   cap_unidades, cap_m2, salario_std, carga_planilla, itbms, margenes, tiers, costo_por_ph, fuente, notas)
select 'v1.3', p.valid_from, p.costo_total - 8 * p.costo_por_ph, p.m2_total, p.u_total, p.personas_total,
       p.peso_m2, p.piso_personas, p.cap_unidades, p.cap_m2, p.salario_std, p.carga_planilla, p.itbms,
       p.margenes, p.tiers, p.costo_por_ph,
       'v1.2 sin doble conteo: Sam confirmó el 2026-11-02 que los $50 por PH de los 8 PH actuales están en los EEFF',
       'costo_total = 18,921.60 − 8 × $50 de carga de planillas; los $50 quedan solo como costo directo por PH.'
from public.fphs_fee_params p
where p.version = 'v1.2' and p.costo_por_ph = 50 and p.costo_total = 18921.60
on conflict (version) do nothing;
