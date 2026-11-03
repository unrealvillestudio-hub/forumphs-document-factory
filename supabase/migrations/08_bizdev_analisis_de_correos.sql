-- ============================================================================
-- 08_bizdev_analisis_de_correos.sql — BizDev listo para recibir el análisis de correos
--
-- ⚠️ PROYECTO DESTINO: unrlvl-db (amlvyycfepwhiindxgzw). No es forumphs-db.
--
-- Origen: Sam, 2026-11-03. unrlvl-communications-services (en construcción, otra sesión) leerá los
-- correos de seguimiento de ForumPHs con la autorización del buzón. Dos flujos:
--   · prospecto YA registrado → el servicio registra el correo, su análisis y las acciones propuestas
--     aquí, y Sam las aprueba o descarta en la ficha;
--   · remitente que no es de ningún prospecto → el servicio solo avisa por Telegram con un texto fijo
--     y la marca. Aquí no se escribe nada.
-- Esta migración NO lee ningún buzón: prepara dónde se escribe y con qué reglas.
--
-- Qué crea:
--   1. fphs_prospect_contacts — correos y dominios de cada prospecto. Es lo que el servicio usa para
--      saber qué hilos seguir. Cada dirección o dominio pertenece a UN solo prospecto.
--   2. fphs_prospect_comms.ext_ref — referencia externa del mensaje (id del proveedor) para que el
--      servicio no duplique; y un tope de 500 caracteres al resumen de origen communications_service
--      (un resumen, nunca el cuerpo del correo).
--   3. fphs_prospect_insights — la lectura de un correo: interpretación, temperatura y objeciones.
--   4. fphs_prospect_actions — acciones propuestas con estado pendiente | aprobada | descartada.
--   5. fphs_bizdev_match(text) y fphs_bizdev_ingest(jsonb) — el contrato con el servicio: él no
--      escribe en las tablas directamente; llama a estas dos funciones, que validan y fallan en voz alta.
--
-- Exclusivo de ForumPHs (prefijo fphs_): la regla multimarca no aplica a estas tablas. El servicio,
-- que es capa compartida, recibe los nombres de estas funciones como dato de configuración de la marca.
-- Acceso: RLS sin políticas; GRANT explícito a service_role (CC_PROTOCOL §12).
-- Idempotente. Sin BEGIN/COMMIT propio (ensayo con RAISE EXCEPTION 'ENSAYO_OK').
-- Reversión: drop de las dos funciones y de las tablas 1, 3 y 4; drop de la columna ext_ref y del CHECK.
-- ============================================================================

-- ── 1 · Contactos para seguimiento ─────────────────────────────────────────
create table if not exists public.fphs_prospect_contacts (
  id           uuid primary key default gen_random_uuid(),
  prospect_id  uuid not null references public.fphs_prospects(id) on delete cascade,
  tipo         text not null check (tipo in ('email', 'dominio')),
  valor        text not null,
  rol          text,
  created_at   timestamptz not null default now(),
  constraint fphs_prospect_contacts_valor_normalizado check (valor = lower(btrim(valor))),
  constraint fphs_prospect_contacts_valor_formato check (
    (tipo = 'email'   and valor ~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$')
    or (tipo = 'dominio' and valor ~ '^[a-z0-9-]+(\.[a-z0-9-]+)*\.[a-z]{2,}$')
  ),
  constraint fphs_prospect_contacts_unico unique (tipo, valor)
);
create index if not exists fphs_prospect_contacts_prospect_idx on public.fphs_prospect_contacts (prospect_id);

-- ── 2 · Comunicaciones: referencia externa y tope del resumen ─────────────
alter table public.fphs_prospect_comms add column if not exists ext_ref text;
create unique index if not exists fphs_prospect_comms_ext_ref_uidx
  on public.fphs_prospect_comms (ext_ref) where ext_ref is not null;

do $chk$
begin
  if not exists (select 1 from pg_constraint where conname = 'fphs_prospect_comms_resumen_servicio') then
    alter table public.fphs_prospect_comms add constraint fphs_prospect_comms_resumen_servicio check (
      origen <> 'communications_service' or char_length(resumen) <= 500
    );
  end if;
end
$chk$;

-- ── 3 · Lectura de un correo ───────────────────────────────────────────────
create table if not exists public.fphs_prospect_insights (
  id              uuid primary key default gen_random_uuid(),
  prospect_id     uuid not null references public.fphs_prospects(id) on delete cascade,
  comm_id         uuid unique references public.fphs_prospect_comms(id) on delete cascade,
  origen          text not null default 'communications_service'
                    check (origen in ('communications_service', 'manual')),
  interpretacion  text not null check (char_length(interpretacion) between 1 and 2000),
  temperatura     text check (temperatura in ('frio', 'tibio', 'caliente')),
  objeciones      text[] not null default '{}',
  generado_por    text,
  created_at      timestamptz not null default now()
);
create index if not exists fphs_prospect_insights_prospect_idx on public.fphs_prospect_insights (prospect_id, created_at desc);

-- ── 4 · Acciones propuestas ────────────────────────────────────────────────
create table if not exists public.fphs_prospect_actions (
  id              uuid primary key default gen_random_uuid(),
  prospect_id     uuid not null references public.fphs_prospects(id) on delete cascade,
  insight_id      uuid references public.fphs_prospect_insights(id) on delete cascade,
  accion          text not null check (char_length(accion) between 1 and 300),
  fecha_sugerida  date,
  prioridad       text not null default 'media' check (prioridad in ('alta', 'media', 'baja')),
  estado          text not null default 'pendiente' check (estado in ('pendiente', 'aprobada', 'descartada')),
  decidida_el     timestamptz,
  created_at      timestamptz not null default now(),
  constraint fphs_prospect_actions_decision check ((estado = 'pendiente') = (decidida_el is null))
);
create index if not exists fphs_prospect_actions_prospect_idx on public.fphs_prospect_actions (prospect_id, estado, created_at desc);

-- ── 5 · Contrato con el servicio ───────────────────────────────────────────
-- 5.1 ¿De qué prospecto es esta dirección? Primero el correo exacto; si no, el dominio.
--     Sin fila = no es de ningún prospecto registrado (el servicio decide si avisa por Telegram).
create or replace function public.fphs_bizdev_match(p_direccion text)
returns table (prospect_id uuid, code text, short_name text, etapa text, via text)
language sql stable set search_path = public
as $fn$
  with d as (select lower(btrim(p_direccion)) as email, split_part(lower(btrim(p_direccion)), '@', 2) as dominio)
  select p.id, p.code, p.short_name, p.etapa, m.via
  from (
    select c.prospect_id, 'email'::text as via, 1 as orden from public.fphs_prospect_contacts c, d
     where c.tipo = 'email' and c.valor = d.email
    union all
    select c.prospect_id, 'dominio', 2 from public.fphs_prospect_contacts c, d
     where c.tipo = 'dominio' and d.dominio <> '' and c.valor = d.dominio
  ) m
  join public.fphs_prospects p on p.id = m.prospect_id
  order by m.orden
  limit 1;
$fn$;

-- 5.2 Registrar un correo de un prospecto, su lectura y sus acciones, en una sola llamada.
--     Idempotente por ext_ref: la segunda llamada con el mismo ext_ref no duplica y lo dice.
create or replace function public.fphs_bizdev_ingest(p jsonb)
returns jsonb
language plpgsql set search_path = public
as $fn$
declare
  v_prospect  uuid;
  v_ext_ref   text := nullif(btrim(p->>'ext_ref'), '');
  v_sentido   text := p->>'sentido';
  v_resumen   text := btrim(coalesce(p->>'resumen', ''));
  v_fecha     timestamptz;
  v_comm      uuid;
  v_insight   uuid;
  v_acciones  int := 0;
  a           jsonb;
begin
  begin
    v_prospect := (p->>'prospect_id')::uuid;
  exception when others then
    raise exception 'fphs_bizdev_ingest: prospect_id inválido: %', p->>'prospect_id';
  end;
  if v_prospect is null or not exists (select 1 from fphs_prospects where id = v_prospect) then
    raise exception 'fphs_bizdev_ingest: prospecto inexistente: %', p->>'prospect_id';
  end if;
  if v_ext_ref is null then raise exception 'fphs_bizdev_ingest: ext_ref es obligatorio'; end if;
  if v_sentido is null or v_sentido not in ('recibido', 'enviado') then
    raise exception 'fphs_bizdev_ingest: sentido debe ser recibido o enviado, no %', coalesce(v_sentido, 'null');
  end if;
  if v_resumen = '' then raise exception 'fphs_bizdev_ingest: resumen es obligatorio'; end if;
  v_fecha := coalesce((p->>'fecha')::timestamptz, now());

  select id into v_comm from fphs_prospect_comms where ext_ref = v_ext_ref;
  if v_comm is not null then
    return jsonb_build_object('duplicado', true, 'comm_id', v_comm);
  end if;

  insert into fphs_prospect_comms (prospect_id, fecha, canal, sentido, origen, resumen, ext_ref)
  values (v_prospect, v_fecha, 'correo', v_sentido, 'communications_service', v_resumen, v_ext_ref)
  returning id into v_comm;

  if nullif(btrim(coalesce(p->>'interpretacion', '')), '') is not null then
    insert into fphs_prospect_insights (prospect_id, comm_id, origen, interpretacion, temperatura, objeciones, generado_por)
    values (v_prospect, v_comm, 'communications_service', btrim(p->>'interpretacion'), p->>'temperatura',
            coalesce(array(select jsonb_array_elements_text(coalesce(p->'objeciones', '[]'::jsonb))), '{}'),
            p->>'generado_por')
    returning id into v_insight;
  end if;

  if jsonb_typeof(coalesce(p->'acciones', '[]'::jsonb)) <> 'array' then
    raise exception 'fphs_bizdev_ingest: acciones debe ser una lista';
  end if;
  for a in select * from jsonb_array_elements(coalesce(p->'acciones', '[]'::jsonb)) loop
    insert into fphs_prospect_actions (prospect_id, insight_id, accion, fecha_sugerida, prioridad)
    values (v_prospect, v_insight, btrim(a->>'accion'), (a->>'fecha_sugerida')::date, coalesce(a->>'prioridad', 'media'));
    v_acciones := v_acciones + 1;
  end loop;

  update fphs_prospects set updated_at = now() where id = v_prospect;
  return jsonb_build_object('duplicado', false, 'comm_id', v_comm, 'insight_id', v_insight, 'acciones', v_acciones);
end
$fn$;

-- ── 6 · Acceso ─────────────────────────────────────────────────────────────
alter table public.fphs_prospect_contacts enable row level security;
alter table public.fphs_prospect_insights enable row level security;
alter table public.fphs_prospect_actions  enable row level security;

revoke all on public.fphs_prospect_contacts, public.fphs_prospect_insights, public.fphs_prospect_actions
  from anon, authenticated;
grant select, insert, delete         on public.fphs_prospect_contacts to service_role;
grant select, insert                 on public.fphs_prospect_insights to service_role;
grant select, insert, update         on public.fphs_prospect_actions  to service_role;

revoke all on function public.fphs_bizdev_match(text)   from public, anon, authenticated;
revoke all on function public.fphs_bizdev_ingest(jsonb) from public, anon, authenticated;
grant execute on function public.fphs_bizdev_match(text)   to service_role;
grant execute on function public.fphs_bizdev_ingest(jsonb) to service_role;
