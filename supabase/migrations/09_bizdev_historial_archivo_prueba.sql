-- ============================================================================
-- 09_bizdev_historial_archivo_prueba.sql — Historial por contacto, archivar y prospecto de prueba
--
-- ⚠️ PROYECTO DESTINO: unrlvl-db (amlvyycfepwhiindxgzw). No es forumphs-db.
--
-- Origen: Sam, 2026-11-04.
--   1. «al agregar un contacto, que revise los mensajes desde y hacia ese contacto y extraiga las
--      actualizaciones del prospecto» → la revisión la hace unrlvl-communications-services (el único que
--      lee el buzón), con un tope de 12 meses. BizDev la pide y aquí guarda su estado por contacto.
--      El servicio avisa del final con fphs_bizdev_historial_done(), que recibe solo el id del contacto
--      (opaco para el servicio) y un resumen con conteos: nada del correo.
--   2. «un botón de archivar» → fphs_prospects.archivado_el. Archivar no cambia la etapa ni borra nada.
--   3. «un Nuevo Prospecto de Prueba con todas las funcionalidades visibles» → fphs_prospects.es_prueba y
--      su siembra (sección 4). Decisión de Sam: el prospecto de prueba queda fuera de los indicadores.
--      Todo su contenido es ficticio; sus contactos usan el dominio reservado .test, que no existe.
--
-- Exclusivo de ForumPHs (prefijo fphs_): la regla multimarca no aplica a estas tablas.
-- Acceso: RLS sin políticas; GRANT explícito a service_role (CC_PROTOCOL §12).
-- Idempotente. Sin BEGIN/COMMIT propio (ensayo con RAISE EXCEPTION 'ENSAYO_OK').
-- Reversión: borrar el prospecto con es_prueba = true (cascada a sus filas); drop de la función, de las
-- columnas nuevas y de sus CHECK.
-- ============================================================================

-- ── 1 · Prospectos: archivo y prueba ───────────────────────────────────────
alter table public.fphs_prospects add column if not exists archivado_el timestamptz;
alter table public.fphs_prospects add column if not exists es_prueba boolean not null default false;

-- ── 2 · Contactos: estado de la revisión del historial ─────────────────────
alter table public.fphs_prospect_contacts add column if not exists historial_estado text;
alter table public.fphs_prospect_contacts add column if not exists historial_solicitado_el timestamptz;
alter table public.fphs_prospect_contacts add column if not exists historial_terminado_el timestamptz;
alter table public.fphs_prospect_contacts add column if not exists historial_resultado jsonb;

do $chk$
begin
  if not exists (select 1 from pg_constraint where conname = 'fphs_prospect_contacts_historial_estado') then
    alter table public.fphs_prospect_contacts add constraint fphs_prospect_contacts_historial_estado
      check (historial_estado is null or historial_estado in ('en_curso', 'completado', 'error'));
  end if;
end
$chk$;

grant update (historial_estado, historial_solicitado_el, historial_terminado_el, historial_resultado)
  on public.fphs_prospect_contacts to service_role;

-- ── 3 · Aviso de fin de la revisión (lo llama el servicio) ─────────────────
-- p = { "ref": "<id del contacto que BizDev mandó>", "ok": true|false,
--       "resumen": { "leidos": n, "asentados": n, "duplicados": n, "truncado": bool, ... },
--       "error": "texto corto si ok = false" }
-- Solo cierra una revisión que esté en curso: un aviso tardío o repetido no pisa una revisión nueva.
create or replace function public.fphs_bizdev_historial_done(p jsonb)
returns jsonb
language plpgsql set search_path = public
as $fn$
declare
  v_ref  uuid;
  v_ok   boolean := coalesce((p->>'ok')::boolean, false);
  v_n    int;
begin
  begin
    v_ref := (p->>'ref')::uuid;
  exception when others then
    raise exception 'fphs_bizdev_historial_done: ref inválido: %', p->>'ref';
  end;
  if v_ref is null then raise exception 'fphs_bizdev_historial_done: ref es obligatorio'; end if;
  if p ? 'resumen' and jsonb_typeof(p->'resumen') <> 'object' then
    raise exception 'fphs_bizdev_historial_done: resumen debe ser un objeto';
  end if;

  update fphs_prospect_contacts
     set historial_estado       = case when v_ok then 'completado' else 'error' end,
         historial_terminado_el = now(),
         historial_resultado    = coalesce(p->'resumen', '{}'::jsonb)
                                  || case when v_ok then '{}'::jsonb
                                          else jsonb_build_object('error', left(coalesce(p->>'error', 'sin detalle'), 300)) end
   where id = v_ref and historial_estado = 'en_curso';
  get diagnostics v_n = row_count;
  if v_n = 0 and not exists (select 1 from fphs_prospect_contacts where id = v_ref) then
    raise exception 'fphs_bizdev_historial_done: contacto inexistente: %', v_ref;
  end if;
  return jsonb_build_object('actualizado', v_n = 1);
end
$fn$;

revoke all on function public.fphs_bizdev_historial_done(jsonb) from public, anon, authenticated;
grant execute on function public.fphs_bizdev_historial_done(jsonb) to service_role;

-- ── 4 · Prospecto de prueba (contenido ficticio, fuera de los indicadores) ──
do $seed$
declare
  pid uuid; q_modelo uuid; q_manual uuid; c_rec uuid; c_rec2 uuid; i1 uuid; i2 uuid;
begin
  if exists (select 1 from public.fphs_prospects where es_prueba and short_name = 'Nuevo Prospecto de Prueba') then
    return;
  end if;

  -- La secuencia no se revierte con un ROLLBACK (un ensayo la avanza): se alinea al último código
  -- existente para que el prospecto de prueba no deje un hueco en la numeración.
  perform setval('public.fphs_prospects_code_seq',
                 greatest((select coalesce(max(substring(code from 'FPHS-P-(\d+)')::int), 1) from public.fphs_prospects), 1));

  insert into public.fphs_prospects
    (short_name, full_name, unidades, m2_privados, es_casas, fuente_tamano, clase_evidencia, etapa,
     contacto_nombre, contacto_rol, proxima_accion, proxima_fecha, notas, es_prueba)
  values
    ('Nuevo Prospecto de Prueba', 'P.H. Prospecto de Prueba (demostración)', 160, 16200, false,
     'Dato ficticio de demostración', 'B', 'negociacion',
     'Contacto de prueba', 'Presidencia de la Junta (ficticio)',
     'Enviar el desglose del personal incluido', current_date + 2,
     'PROSPECTO DE PRUEBA: todo su contenido es ficticio y no cuenta en los indicadores. Sirve para ver cada función del tab.',
     true)
  returning id into pid;

  -- Contactos de seguimiento (dominio reservado .test: no existe, ningún correo real coincide).
  insert into public.fphs_prospect_contacts (prospect_id, tipo, valor, rol, historial_estado, historial_solicitado_el, historial_terminado_el, historial_resultado) values
    (pid, 'email',   'presidencia@prospecto-prueba.test', 'Presidencia de la Junta (ficticio)', 'completado', now() - interval '2 days', now() - interval '2 days',
     '{"leidos": 6, "asentados": 4, "duplicados": 2, "truncado": false, "demo": true}'::jsonb),
    (pid, 'email',   'tesoreria.prueba@gmail.test', 'Tesorería (ficticio)', null, null, null, null),
    (pid, 'dominio', 'admin-prueba.test', 'Administración saliente (ficticio)', null, null, null, null);

  -- Cotizaciones: una carta previa al modelo, una del modelo v1.3 enviada y un borrador con personal adicional.
  insert into public.fphs_quotes (prospect_id, origen, unidades, m2, es_casas, personal_extra, honorario, honorario_itbms, estado, enviada_el, created_at)
  values (pid, 'manual', 160, 16200, false, '[]'::jsonb, 2900.00, 3103.00, 'enviada', current_date - 40, now() - interval '40 days')
  returning id into q_manual;

  -- v1.3, 160 uds. y 16,200 m², margen 30 %: costo 2,173.19 · honorario 3,104.55 · con ITBMS 3,321.87 (lib/bizdev/feeModel.ts).
  insert into public.fphs_quotes (prospect_id, origen, params_version, margen, unidades, m2, es_casas, personal_incluido, personal_extra,
                                  costo_base, honorario, honorario_itbms, estado, enviada_el, created_at)
  values (pid, 'modelo', 'v1.3', 0.30, 160, 16200, false, 1.5, '[]'::jsonb, 2173.19, 3104.55, 3321.87, 'enviada', current_date - 10, now() - interval '10 days')
  returning id into q_modelo;

  -- Borrador al 35 % con 1 persona adicional de planilla: costo 3,410.69 · honorario 5,247.21 · con ITBMS 5,614.51.
  insert into public.fphs_quotes (prospect_id, origen, params_version, margen, unidades, m2, es_casas, personal_incluido, personal_extra,
                                  costo_base, honorario, honorario_itbms, estado, created_at)
  values (pid, 'modelo', 'v1.3', 0.35, 160, 16200, false, 1.5, '[{"personas": 1, "salario": 900, "tipo": "planilla"}]'::jsonb,
          3410.69, 5247.21, 5614.51, 'borrador', now() - interval '1 day');

  -- Línea de tiempo: manual, Document Factory y lectura de correo; recibidas, enviadas e internas.
  insert into public.fphs_prospect_comms (prospect_id, fecha, canal, sentido, origen, resumen) values
    (pid, now() - interval '50 days', 'llamada',  'recibido', 'manual', '(Prueba) La presidencia de la Junta llama para pedir una propuesta de administración.'),
    (pid, now() - interval '48 days', 'reunion',  'enviado',  'manual', '(Prueba) Visita al PH y levantamiento de áreas comunes.'),
    (pid, now() - interval '45 days', 'documento','interno',  'manual', '(Prueba) Nota interna: revisar planilla actual del PH antes de cotizar.');
  insert into public.fphs_prospect_comms (prospect_id, fecha, canal, sentido, origen, resumen, quote_id) values
    (pid, now() - interval '40 days', 'documento', 'enviado', 'manual', '(Prueba) Carta de cotización: $2,900 mensuales más ITBMS', q_manual),
    (pid, now() - interval '10 days', 'documento', 'enviado', 'document_factory', '(Prueba) Propuesta de administración enviada: tier Profesional, $3,104.55 mensuales más ITBMS', q_modelo);
  insert into public.fphs_prospect_comms (prospect_id, fecha, canal, sentido, origen, resumen, ext_ref) values
    (pid, now() - interval '6 days', 'correo', 'recibido', 'communications_service', '(Prueba) La Junta acusa recibo y pide comparar con el costo actual.', 'prueba-fphs-0001')
  returning id into c_rec;
  insert into public.fphs_prospect_comms (prospect_id, fecha, canal, sentido, origen, resumen, ext_ref) values
    (pid, now() - interval '5 days', 'correo', 'enviado', 'communications_service', '(Prueba) Se envía la comparación de costos solicitada.', 'prueba-fphs-0002');
  insert into public.fphs_prospect_comms (prospect_id, fecha, canal, sentido, origen, resumen, ext_ref) values
    (pid, now() - interval '1 day', 'correo', 'recibido', 'communications_service', '(Prueba) La tesorería pregunta qué personal incluye la propuesta y si puede sumarse un conserje.', 'prueba-fphs-0003')
  returning id into c_rec2;
  insert into public.fphs_prospect_comms (prospect_id, fecha, canal, sentido, origen, resumen) values
    (pid, now() - interval '20 hours', 'whatsapp', 'recibido', 'manual', '(Prueba) La presidencia confirma que la Junta decide en su sesión del próximo mes.');

  -- Lecturas de correo.
  insert into public.fphs_prospect_insights (prospect_id, comm_id, origen, interpretacion, temperatura, objeciones, generado_por, created_at)
  values (pid, c_rec, 'communications_service', '(Prueba) Interés confirmado, pero la Junta compara contra lo que paga hoy: la decisión es de precio.',
          'tibio', array['precio frente a la administración actual'], 'demo', now() - interval '6 days')
  returning id into i1;
  insert into public.fphs_prospect_insights (prospect_id, comm_id, origen, interpretacion, temperatura, objeciones, generado_por, created_at)
  values (pid, c_rec2, 'communications_service', '(Prueba) La pregunta por un conserje adicional indica que ya evalúan el servicio en detalle: buena señal de cierre.',
          'caliente', array['alcance del personal incluido', 'costo del personal adicional'], 'demo', now() - interval '1 day')
  returning id into i2;

  -- Acciones: 2 pendientes, 1 aprobada (es la próxima acción) y 1 descartada.
  insert into public.fphs_prospect_actions (prospect_id, insight_id, accion, fecha_sugerida, prioridad, estado, decidida_el, created_at) values
    (pid, i1, '(Prueba) Preparar una comparación de costos frente a la administración actual', null, 'media', 'descartada', now() - interval '5 days', now() - interval '6 days'),
    (pid, i2, 'Enviar el desglose del personal incluido', current_date + 2, 'alta', 'aprobada', now() - interval '20 hours', now() - interval '1 day'),
    (pid, i2, '(Prueba) Cotizar la opción con un conserje adicional (borrador ya guardado)', current_date + 3, 'alta', 'pendiente', null, now() - interval '1 day'),
    (pid, i2, '(Prueba) Proponer una reunión corta antes de la sesión de la Junta', null, 'media', 'pendiente', null, now() - interval '1 day');
end
$seed$;
