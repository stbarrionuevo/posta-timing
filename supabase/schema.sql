-- Postas americanas: equipos nadan durante X minutos, cada pasada suma metros.
-- Pensado para un proyecto de Supabase NUEVO, separado del de swim-timing
-- (torneo escolar), que sigue en producción con su propia base.
--
-- Principios:
--   * Todo cuelga de una organización (multi-cliente desde el día 1).
--   * El reloj del evento lo define el servidor; ningún dispositivo lo arranca.
--   * Las pasadas se escriben solo vía funciones (record_lap, void_lap) que
--     validan reglas; nunca se borran, se anulan con motivo.
--   * audit_log registra quién hizo qué, cuándo y por qué. Es append-only.
--   * Metros, número de pasada y parciales se CALCULAN en vistas, no se guardan.

create extension if not exists "pgcrypto";


-- ---------------------------------------------------------------------------
-- Tipos
-- ---------------------------------------------------------------------------

create type member_role as enum ('admin', 'judge', 'operator');

-- draft: se arma el evento. ready: roster confirmado, carriles marcando "listo".
-- running/paused: reloj corriendo/detenido. finished: resultados cerrados.
create type event_status as enum ('draft', 'ready', 'running', 'paused', 'finished');

create type lap_status as enum ('valid', 'void');

-- partial_lap: metros de la pasada incompleta al cortar el tiempo.
-- penalty: metros negativos. manual: corrección del juez.
create type adjustment_kind as enum ('partial_lap', 'penalty', 'manual');

-- Qué hacer con la pasada incompleta al terminar el tiempo (regla a definir
-- con cada cliente, por eso es configurable por evento).
--   ignore: no cuenta. proportional: suma sus metros. tiebreak_only: solo desempata.
create type partial_lap_policy as enum ('ignore', 'proportional', 'tiebreak_only');


-- ---------------------------------------------------------------------------
-- Tablas
-- ---------------------------------------------------------------------------

create table organizations (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  slug text not null unique,
  plan text not null default 'trial',
  created_at timestamptz not null default now()
);

create table memberships (
  organization_id uuid not null references organizations(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role member_role not null,
  display_name text,
  created_at timestamptz not null default now(),
  primary key (organization_id, user_id)
);

create index idx_memberships_user on memberships(user_id);

create table events (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  name text not null,
  venue text,
  event_date date not null,
  pool_length_m int not null default 25 check (pool_length_m between 10 and 100),
  duration_seconds int not null check (duration_seconds > 0),
  -- Anti doble toque: dos pasadas del mismo equipo más juntas que esto se
  -- rechazan (y el rechazo queda en audit_log).
  min_lap_seconds int not null default 8 check (min_lap_seconds >= 0),
  partial_lap_policy partial_lap_policy not null default 'ignore',
  -- Cada pasada registrada pasa el turno al siguiente nadador del orden de relevo.
  auto_rotate boolean not null default true,
  is_public boolean not null default false,
  status event_status not null default 'draft',
  started_at timestamptz,
  paused_at timestamptz,
  -- Segundos acumulados en pausa; corren el final del evento hacia adelante.
  paused_seconds numeric not null default 0,
  finished_at timestamptz,
  roster_locked_at timestamptz,
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (status in ('draft', 'ready') or started_at is not null),
  check (status <> 'paused' or paused_at is not null),
  check (status <> 'finished' or finished_at is not null)
);

create index idx_events_org on events(organization_id, event_date desc);

create table teams (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references events(id) on delete cascade,
  organization_id uuid not null references organizations(id) on delete cascade,
  name text not null,
  lane_number int not null check (lane_number > 0),
  color text,
  -- Nadador que está en el agua ahora. Solo cambia vía set_active_swimmer.
  active_swimmer_id uuid,
  created_at timestamptz not null default now(),
  unique (event_id, lane_number),
  unique (event_id, name)
);

create table swimmers (
  id uuid primary key default gen_random_uuid(),
  team_id uuid not null references teams(id) on delete cascade,
  event_id uuid not null references events(id) on delete cascade,
  organization_id uuid not null references organizations(id) on delete cascade,
  name text not null,
  bib_number text,
  relay_order int check (relay_order > 0),
  is_active boolean not null default true,
  -- true si el juez lo agregó con el roster ya cerrado (alta de último momento).
  added_after_lock boolean not null default false,
  created_at timestamptz not null default now(),
  unique (team_id, relay_order)
);

create index idx_swimmers_team on swimmers(team_id);

alter table teams
  add constraint teams_active_swimmer_fk
  foreign key (active_swimmer_id) references swimmers(id) on delete set null;

-- Un dispositivo operando un carril. ready_at = tocó "Carril listo".
create table lane_sessions (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references events(id) on delete cascade,
  team_id uuid not null references teams(id) on delete cascade,
  organization_id uuid not null references organizations(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  device_id text not null,
  ready_at timestamptz,
  last_seen_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  unique (team_id, device_id)
);

create table laps (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references events(id) on delete cascade,
  team_id uuid not null references teams(id) on delete cascade,
  swimmer_id uuid not null references swimmers(id),
  organization_id uuid not null references organizations(id) on delete cascade,
  -- Lo genera el dispositivo; hace idempotente el reenvío desde la cola offline.
  client_op_id uuid not null unique,
  -- Momento del toque en hora del servidor (el cliente corrige su reloj con
  -- server_now()). received_at es cuándo llegó realmente a la base.
  occurred_at timestamptz not null,
  received_at timestamptz not null default now(),
  recorded_by uuid not null,
  device_id text,
  -- device: toque de un operador. judge: pasada agregada a mano por el juez.
  source text not null default 'device' check (source in ('device', 'judge')),
  status lap_status not null default 'valid',
  void_reason text,
  voided_by uuid,
  voided_at timestamptz,
  check (status = 'valid' or (void_reason is not null and length(trim(void_reason)) > 0))
);

create index idx_laps_team_time on laps(team_id, occurred_at);
create index idx_laps_event on laps(event_id);

create table team_adjustments (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references events(id) on delete cascade,
  team_id uuid not null references teams(id) on delete cascade,
  organization_id uuid not null references organizations(id) on delete cascade,
  kind adjustment_kind not null,
  meters numeric not null,
  reason text not null check (length(trim(reason)) > 0),
  created_by uuid not null,
  created_at timestamptz not null default now(),
  check (kind <> 'partial_lap' or meters >= 0),
  check (kind <> 'penalty' or meters <= 0)
);

create index idx_adjustments_team on team_adjustments(team_id);

-- Sin FKs a propósito: el historial sobrevive aunque se borre el evento.
create table audit_log (
  id bigint generated always as identity primary key,
  organization_id uuid,
  event_id uuid,
  actor_id uuid,
  action text not null,
  entity text not null,
  entity_id uuid,
  reason text,
  before jsonb,
  after jsonb,
  created_at timestamptz not null default clock_timestamp()
);

create index idx_audit_event on audit_log(event_id, created_at);
create index idx_audit_org on audit_log(organization_id, created_at);


-- ---------------------------------------------------------------------------
-- Helpers
-- ---------------------------------------------------------------------------

create or replace function has_org_role(p_org uuid, p_roles member_role[])
returns boolean
language sql stable security definer set search_path = public
as $$
  select exists (
    select 1 from memberships m
    where m.organization_id = p_org
      and m.user_id = auth.uid()
      and m.role = any (p_roles)
  );
$$;

create or replace function require_org_role(p_org uuid, p_roles member_role[])
returns void
language plpgsql stable security definer set search_path = public
as $$
begin
  if auth.uid() is null or not has_org_role(p_org, p_roles) then
    raise exception 'FORBIDDEN: se requiere rol % en la organización', p_roles
      using errcode = '42501';
  end if;
end;
$$;

-- Hora del servidor. El cliente la usa para calcular el desfase de su reloj.
create or replace function server_now()
returns timestamptz
language sql volatile
as $$ select clock_timestamp(); $$;

-- Hora a la que termina (o terminaría) el evento, sumando las pausas.
create or replace function event_ends_at(e events)
returns timestamptz
language sql stable
as $$
  select case
    when e.started_at is null then null
    when e.status = 'finished' then e.finished_at
    else e.started_at
         + make_interval(secs => e.duration_seconds + e.paused_seconds)
         + case when e.status = 'paused'
                then clock_timestamp() - e.paused_at
                else interval '0' end
  end;
$$;

create or replace function write_audit(
  p_org uuid, p_event uuid, p_action text, p_entity text, p_entity_id uuid,
  p_reason text, p_after jsonb default null
)
returns void
language sql security definer set search_path = public
as $$
  insert into audit_log (organization_id, event_id, actor_id, action, entity, entity_id, reason, after)
  values (p_org, p_event, auth.uid(), p_action, p_entity, p_entity_id, p_reason, p_after);
$$;


-- Siguiente nadador activo en el orden de relevo (vuelve al primero al final).
-- El cliente usa el mismo orden: relay_order, created_at, id.
create or replace function next_swimmer(p_team uuid, p_current uuid)
returns uuid
language sql stable security definer set search_path = public
as $$
  with ordered as (
    select id, row_number() over (order by relay_order nulls last, created_at, id) as rn
    from swimmers
    where team_id = p_team and is_active
  )
  select coalesce(
    (select o.id from ordered o
     where o.rn > coalesce((select c.rn from ordered c where c.id = p_current), 0)
     order by o.rn limit 1),
    (select o.id from ordered o order by o.rn limit 1)
  );
$$;


-- ---------------------------------------------------------------------------
-- Triggers
-- ---------------------------------------------------------------------------

create or replace function set_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

create trigger trg_events_updated_at
  before update on events
  for each row execute function set_updated_at();

-- organization_id / event_id se copian del padre: el cliente no puede
-- colgar un equipo o nadador de otra organización.
create or replace function fill_team_parents()
returns trigger
language plpgsql security definer set search_path = public
as $$
begin
  select organization_id into new.organization_id from events where id = new.event_id;
  return new;
end;
$$;

create trigger trg_teams_parents
  before insert on teams
  for each row execute function fill_team_parents();

create or replace function fill_swimmer_parents()
returns trigger
language plpgsql security definer set search_path = public
as $$
begin
  select event_id, organization_id into new.event_id, new.organization_id
  from teams where id = new.team_id;
  return new;
end;
$$;

create trigger trg_swimmers_parents
  before insert or update of team_id on swimmers
  for each row execute function fill_swimmer_parents();

-- Roster cerrado: desde que arranca el evento no se tocan equipos ni nadadores,
-- salvo por las funciones judge_* (que setean app.roster_override y un motivo).
-- Cambiar el nadador activo no cuenta como cambio de roster.
create or replace function enforce_roster_lock()
returns trigger
language plpgsql security definer set search_path = public
as $$
declare
  v_event_id uuid := case when tg_op = 'DELETE' then old.event_id else new.event_id end;
  v_status event_status;
begin
  if tg_op = 'UPDATE' and tg_table_name = 'teams'
     and to_jsonb(new) - 'active_swimmer_id' = to_jsonb(old) - 'active_swimmer_id' then
    return new;
  end if;

  select status into v_status from events where id = v_event_id;

  if v_status not in ('draft', 'ready')
     and coalesce(current_setting('app.roster_override', true), '') <> 'on' then
    raise exception 'ROSTER_LOCKED: el evento ya empezó; los cambios de roster los hace el juez con motivo'
      using errcode = 'P0001';
  end if;

  return case when tg_op = 'DELETE' then old else new end;
end;
$$;

create trigger trg_teams_roster_lock
  before insert or update or delete on teams
  for each row execute function enforce_roster_lock();

create trigger trg_swimmers_roster_lock
  before insert or update or delete on swimmers
  for each row execute function enforce_roster_lock();

-- La configuración de competencia no cambia con el evento en marcha.
create or replace function enforce_event_config_lock()
returns trigger
language plpgsql
as $$
begin
  if old.status not in ('draft', 'ready')
     and (new.pool_length_m, new.duration_seconds, new.min_lap_seconds, new.partial_lap_policy)
         is distinct from
         (old.pool_length_m, old.duration_seconds, old.min_lap_seconds, old.partial_lap_policy) then
    raise exception 'EVENT_CONFIG_LOCKED: no se puede cambiar la configuración de un evento iniciado'
      using errcode = 'P0001';
  end if;
  return new;
end;
$$;

create trigger trg_events_config_lock
  before update on events
  for each row execute function enforce_event_config_lock();

create or replace function audit_row()
returns trigger
language plpgsql security definer set search_path = public
as $$
declare
  r jsonb := case when tg_op = 'DELETE' then to_jsonb(old) else to_jsonb(new) end;
begin
  -- La rotación automática de nadador en cada pasada no se audita: la pasada
  -- misma ya queda registrada. Los cambios manuales sí.
  if tg_table_name = 'teams' and tg_op = 'UPDATE'
     and coalesce(current_setting('app.auto_rotate', true), '') = 'on'
     and to_jsonb(new) - 'active_swimmer_id' = to_jsonb(old) - 'active_swimmer_id' then
    return null;
  end if;

  insert into audit_log (organization_id, event_id, actor_id, action, entity, entity_id, reason, before, after)
  values (
    (r ->> 'organization_id')::uuid,
    case when tg_table_name = 'events' then (r ->> 'id')::uuid else (r ->> 'event_id')::uuid end,
    auth.uid(),
    lower(tg_op),
    tg_table_name,
    (r ->> 'id')::uuid,
    nullif(current_setting('app.audit_reason', true), ''),
    case when tg_op <> 'INSERT' then to_jsonb(old) end,
    case when tg_op <> 'DELETE' then to_jsonb(new) end
  );
  return null;
end;
$$;

create trigger trg_audit_events after insert or update or delete on events
  for each row execute function audit_row();
create trigger trg_audit_teams after insert or update or delete on teams
  for each row execute function audit_row();
create trigger trg_audit_swimmers after insert or update or delete on swimmers
  for each row execute function audit_row();
create trigger trg_audit_laps after insert or update or delete on laps
  for each row execute function audit_row();
create trigger trg_audit_adjustments after insert or update or delete on team_adjustments
  for each row execute function audit_row();
create trigger trg_audit_memberships after insert or update or delete on memberships
  for each row execute function audit_row();

create or replace function forbid_audit_changes()
returns trigger
language plpgsql
as $$
begin
  raise exception 'audit_log es solo de escritura' using errcode = '42501';
end;
$$;

create trigger trg_audit_immutable
  before update or delete on audit_log
  for each row execute function forbid_audit_changes();


-- ---------------------------------------------------------------------------
-- Reloj del evento (solo juez/admin)
-- ---------------------------------------------------------------------------

create or replace function mark_event_ready(p_event uuid)
returns events
language plpgsql security definer set search_path = public
as $$
declare
  e events;
begin
  select * into e from events where id = p_event for update;
  if not found then raise exception 'EVENT_NOT_FOUND'; end if;
  perform require_org_role(e.organization_id, array['admin', 'judge']::member_role[]);

  if e.status <> 'draft' then
    raise exception 'INVALID_STATUS: el evento está en %', e.status;
  end if;
  if not exists (select 1 from teams where event_id = p_event) then
    raise exception 'NO_TEAMS: el evento no tiene equipos';
  end if;
  if exists (
    select 1 from teams t
    where t.event_id = p_event
      and not exists (select 1 from swimmers s where s.team_id = t.id and s.is_active)
  ) then
    raise exception 'EMPTY_TEAM: hay equipos sin nadadores activos';
  end if;

  update events set status = 'ready' where id = p_event returning * into e;
  return e;
end;
$$;

create or replace function reopen_event_draft(p_event uuid)
returns events
language plpgsql security definer set search_path = public
as $$
declare
  e events;
begin
  select * into e from events where id = p_event for update;
  if not found then raise exception 'EVENT_NOT_FOUND'; end if;
  perform require_org_role(e.organization_id, array['admin', 'judge']::member_role[]);
  if e.status <> 'ready' then
    raise exception 'INVALID_STATUS: el evento está en %', e.status;
  end if;

  update lane_sessions set ready_at = null where event_id = p_event;
  update events set status = 'draft' where id = p_event returning * into e;
  return e;
end;
$$;

-- Sin p_force, no arranca si algún carril no confirmó "listo".
-- Con p_force arranca igual y deja en audit_log qué carriles no estaban listos.
create or replace function start_event(p_event uuid, p_force boolean default false)
returns events
language plpgsql security definer set search_path = public
as $$
declare
  e events;
  v_not_ready text;
begin
  select * into e from events where id = p_event for update;
  if not found then raise exception 'EVENT_NOT_FOUND'; end if;
  perform require_org_role(e.organization_id, array['admin', 'judge']::member_role[]);

  if e.status <> 'ready' then
    raise exception 'INVALID_STATUS: el evento está en %', e.status;
  end if;

  select string_agg(format('carril %s (%s)', t.lane_number, t.name), ', ' order by t.lane_number)
  into v_not_ready
  from teams t
  where t.event_id = p_event
    and not exists (
      select 1 from lane_sessions ls where ls.team_id = t.id and ls.ready_at is not null
    );

  if v_not_ready is not null and not p_force then
    raise exception 'LANES_NOT_READY: %', v_not_ready using errcode = 'P0001';
  end if;

  -- Si un equipo no eligió nadador, entra el primero del orden de relevo.
  update teams t
  set active_swimmer_id = (
    select s.id from swimmers s
    where s.team_id = t.id and s.is_active
    order by s.relay_order nulls last, s.created_at
    limit 1
  )
  where t.event_id = p_event and t.active_swimmer_id is null;

  perform set_config('app.audit_reason',
    case when v_not_ready is null then 'inicio con todos los carriles listos'
         else 'inicio forzado; sin confirmar: ' || v_not_ready end,
    true);

  update events
  set status = 'running',
      started_at = clock_timestamp(),
      roster_locked_at = clock_timestamp()
  where id = p_event
  returning * into e;

  perform set_config('app.audit_reason', '', true);
  return e;
end;
$$;

create or replace function pause_event(p_event uuid, p_reason text)
returns events
language plpgsql security definer set search_path = public
as $$
declare
  e events;
begin
  select * into e from events where id = p_event for update;
  if not found then raise exception 'EVENT_NOT_FOUND'; end if;
  perform require_org_role(e.organization_id, array['admin', 'judge']::member_role[]);
  if e.status <> 'running' then
    raise exception 'INVALID_STATUS: el evento está en %', e.status;
  end if;
  if clock_timestamp() >= event_ends_at(e) then
    raise exception 'TIME_OVER: el tiempo del evento ya terminó';
  end if;

  perform set_config('app.audit_reason', coalesce(p_reason, ''), true);
  update events set status = 'paused', paused_at = clock_timestamp()
  where id = p_event returning * into e;
  perform set_config('app.audit_reason', '', true);
  return e;
end;
$$;

create or replace function resume_event(p_event uuid)
returns events
language plpgsql security definer set search_path = public
as $$
declare
  e events;
begin
  select * into e from events where id = p_event for update;
  if not found then raise exception 'EVENT_NOT_FOUND'; end if;
  perform require_org_role(e.organization_id, array['admin', 'judge']::member_role[]);
  if e.status <> 'paused' then
    raise exception 'INVALID_STATUS: el evento está en %', e.status;
  end if;

  update events
  set status = 'running',
      paused_seconds = paused_seconds + extract(epoch from clock_timestamp() - paused_at),
      paused_at = null
  where id = p_event
  returning * into e;
  return e;
end;
$$;

-- finished_at nunca pasa del final oficial, aunque el juez cierre tarde.
create or replace function finish_event(p_event uuid)
returns events
language plpgsql security definer set search_path = public
as $$
declare
  e events;
  v_end timestamptz;
begin
  select * into e from events where id = p_event for update;
  if not found then raise exception 'EVENT_NOT_FOUND'; end if;
  perform require_org_role(e.organization_id, array['admin', 'judge']::member_role[]);
  if e.status not in ('running', 'paused') then
    raise exception 'INVALID_STATUS: el evento está en %', e.status;
  end if;

  if e.status = 'paused' then
    v_end := e.paused_at;
  else
    v_end := least(clock_timestamp(), event_ends_at(e));
  end if;

  update events
  set status = 'finished',
      paused_seconds = case when e.status = 'paused'
        then paused_seconds + extract(epoch from clock_timestamp() - paused_at)
        else paused_seconds end,
      paused_at = null,
      finished_at = v_end
  where id = p_event
  returning * into e;
  return e;
end;
$$;


-- ---------------------------------------------------------------------------
-- Carriles (operadores)
-- ---------------------------------------------------------------------------

create or replace function set_lane_ready(p_team uuid, p_device_id text)
returns lane_sessions
language plpgsql security definer set search_path = public
as $$
declare
  t teams;
  v_status event_status;
  ls lane_sessions;
begin
  select * into t from teams where id = p_team;
  if not found then raise exception 'TEAM_NOT_FOUND'; end if;
  perform require_org_role(t.organization_id, array['admin', 'judge', 'operator']::member_role[]);

  select status into v_status from events where id = t.event_id;
  if v_status <> 'ready' then
    raise exception 'INVALID_STATUS: solo se confirma "listo" con el evento en ready (está en %)', v_status;
  end if;

  insert into lane_sessions (event_id, team_id, organization_id, user_id, device_id, ready_at, last_seen_at)
  values (t.event_id, t.id, t.organization_id, auth.uid(), p_device_id, clock_timestamp(), clock_timestamp())
  on conflict (team_id, device_id) do update
    set user_id = excluded.user_id, ready_at = excluded.ready_at, last_seen_at = excluded.last_seen_at
  returning * into ls;

  perform write_audit(t.organization_id, t.event_id, 'lane_ready', 'lane_sessions', ls.id,
    null, jsonb_build_object('team_id', t.id, 'lane_number', t.lane_number, 'device_id', p_device_id));
  return ls;
end;
$$;

-- Latido del dispositivo. Si el dispositivo no tenía sesión en ese carril la
-- crea (sin "listo"): así se puede sumar un dispositivo de respaldo con el
-- evento en curso. El panel del juez marca "sin señal" si last_seen_at envejece.
create or replace function lane_heartbeat(p_team uuid, p_device_id text)
returns timestamptz
language plpgsql security definer set search_path = public
as $$
declare
  t teams;
  v_status event_status;
  v_now timestamptz := clock_timestamp();
  v_session_id uuid;
  v_inserted boolean;
begin
  select * into t from teams where id = p_team;
  if not found then raise exception 'TEAM_NOT_FOUND'; end if;
  perform require_org_role(t.organization_id, array['admin', 'judge', 'operator']::member_role[]);

  select status into v_status from events where id = t.event_id;
  if v_status not in ('ready', 'running', 'paused') then
    raise exception 'INVALID_STATUS: el evento está en %', v_status;
  end if;

  insert into lane_sessions (event_id, team_id, organization_id, user_id, device_id, last_seen_at)
  values (t.event_id, t.id, t.organization_id, auth.uid(), p_device_id, v_now)
  on conflict (team_id, device_id) do update
    set last_seen_at = excluded.last_seen_at, user_id = excluded.user_id
  returning id, (xmax = 0) into v_session_id, v_inserted;

  if v_inserted and v_status <> 'ready' then
    perform write_audit(t.organization_id, t.event_id, 'lane_device_joined', 'lane_sessions', v_session_id,
      null, jsonb_build_object('team_id', t.id, 'lane_number', t.lane_number, 'device_id', p_device_id));
  end if;

  return v_now;
end;
$$;

create or replace function set_active_swimmer(p_team uuid, p_swimmer uuid)
returns teams
language plpgsql security definer set search_path = public
as $$
declare
  t teams;
  v_status event_status;
begin
  select * into t from teams where id = p_team for update;
  if not found then raise exception 'TEAM_NOT_FOUND'; end if;
  perform require_org_role(t.organization_id, array['admin', 'judge', 'operator']::member_role[]);

  select status into v_status from events where id = t.event_id;
  if v_status = 'finished' then
    raise exception 'INVALID_STATUS: el evento terminó';
  end if;
  if not exists (select 1 from swimmers where id = p_swimmer and team_id = p_team and is_active) then
    raise exception 'SWIMMER_NOT_IN_TEAM: el nadador no es un integrante activo del equipo';
  end if;

  update teams set active_swimmer_id = p_swimmer where id = p_team returning * into t;
  return t;
end;
$$;

-- Registra una pasada. Devuelve {result, lap_id?, error?}:
--   recorded  -> guardada (y, con auto_rotate, el turno pasa al siguiente nadador)
--   duplicate -> ese client_op_id ya estaba (reenvío de la cola offline)
--   too_soon  -> otra pasada del equipo a menos de min_lap_seconds (doble toque)
--   rejected  -> fuera de tiempo, reloj del dispositivo desfasado, nadador ajeno...
-- too_soon y rejected no guardan la pasada pero quedan en audit_log como
-- lap_rejected: es la evidencia ante un "no me tomó el tiempo".
create or replace function record_lap(
  p_team uuid,
  p_swimmer uuid,
  p_client_op_id uuid,
  p_occurred_at timestamptz,
  p_device_id text default null
)
returns jsonb
language plpgsql security definer set search_path = public
as $$
declare
  t teams;
  e events;
  v_existing laps;
  v_close laps;
  v_limit timestamptz;
  v_lap_id uuid;
  v_reject text;
  v_attempt jsonb;
begin
  select * into v_existing from laps where client_op_id = p_client_op_id;
  if found then
    return jsonb_build_object('result', 'duplicate', 'lap_id', v_existing.id);
  end if;

  -- Bloquea el equipo: serializa pasadas del mismo carril.
  select * into t from teams where id = p_team for update;
  if not found then raise exception 'TEAM_NOT_FOUND'; end if;
  perform require_org_role(t.organization_id, array['admin', 'judge', 'operator']::member_role[]);

  select * into e from events where id = t.event_id;
  v_limit := case e.status when 'paused' then e.paused_at else event_ends_at(e) end;

  v_reject := case
    when e.status not in ('running', 'paused', 'finished') then
      format('EVENT_NOT_STARTED: el evento está en %s', e.status)
    when p_occurred_at < e.started_at then
      'BEFORE_START: la pasada es anterior al inicio del evento'
    when p_occurred_at > clock_timestamp() + interval '2 seconds' then
      'FUTURE_TIMESTAMP: revisar sincronización del reloj del dispositivo'
    when p_occurred_at > v_limit then
      'AFTER_END: la pasada es posterior al final del evento'
    when not exists (select 1 from swimmers where id = p_swimmer and team_id = p_team) then
      'SWIMMER_NOT_IN_TEAM: el nadador no pertenece al equipo'
  end;

  v_attempt := jsonb_build_object('team_id', p_team, 'lane_number', t.lane_number, 'swimmer_id', p_swimmer,
                                  'client_op_id', p_client_op_id, 'occurred_at', p_occurred_at,
                                  'device_id', p_device_id);

  if v_reject is null then
    select * into v_close
    from laps
    where team_id = p_team
      and status = 'valid'
      and occurred_at > p_occurred_at - make_interval(secs => e.min_lap_seconds)
      and occurred_at < p_occurred_at + make_interval(secs => e.min_lap_seconds)
    order by occurred_at desc
    limit 1;

    if found then
      perform write_audit(t.organization_id, t.event_id, 'lap_rejected', 'laps', null,
        format('TOO_SOON: doble toque, a menos de %s s de otra pasada', e.min_lap_seconds),
        v_attempt || jsonb_build_object('close_lap_id', v_close.id));
      return jsonb_build_object('result', 'too_soon', 'lap_id', v_close.id);
    end if;
  end if;

  if v_reject is not null then
    perform write_audit(t.organization_id, t.event_id, 'lap_rejected', 'laps', null, v_reject, v_attempt);
    return jsonb_build_object('result', 'rejected', 'error', v_reject);
  end if;

  insert into laps (event_id, team_id, swimmer_id, organization_id, client_op_id,
                    occurred_at, recorded_by, device_id)
  values (t.event_id, p_team, p_swimmer, t.organization_id, p_client_op_id,
          p_occurred_at, auth.uid(), p_device_id)
  returning id into v_lap_id;

  -- Rotación: solo si la pasada es del nadador que estaba en el agua (un
  -- reenvío viejo de la cola offline no mueve el turno).
  if e.auto_rotate and t.active_swimmer_id = p_swimmer then
    perform set_config('app.auto_rotate', 'on', true);
    update teams set active_swimmer_id = next_swimmer(p_team, p_swimmer) where id = p_team;
    perform set_config('app.auto_rotate', '', true);
  end if;

  return jsonb_build_object('result', 'recorded', 'lap_id', v_lap_id);
end;
$$;

-- Anula una pasada con motivo obligatorio.
-- Juez/admin: siempre. Operador: solo una pasada propia de los últimos 30 s
-- (el botón "deshacer última pasada").
-- Si era la última pasada del equipo y el turno ya había rotado por ella,
-- el turno vuelve a ese nadador.
create or replace function void_lap(p_lap uuid, p_reason text)
returns laps
language plpgsql security definer set search_path = public
as $$
declare
  l laps;
  v_auto boolean;
begin
  if p_reason is null or length(trim(p_reason)) = 0 then
    raise exception 'REASON_REQUIRED: anular una pasada requiere motivo';
  end if;

  select * into l from laps where id = p_lap for update;
  if not found then raise exception 'LAP_NOT_FOUND'; end if;
  if l.status = 'void' then
    return l;
  end if;

  if not has_org_role(l.organization_id, array['admin', 'judge']::member_role[]) then
    perform require_org_role(l.organization_id, array['operator']::member_role[]);
    if l.recorded_by <> auth.uid() or clock_timestamp() - l.received_at > interval '30 seconds' then
      raise exception 'FORBIDDEN: el operador solo puede deshacer su última pasada dentro de 30 s'
        using errcode = '42501';
    end if;
  end if;

  select auto_rotate into v_auto from events where id = l.event_id;
  if v_auto and not exists (
    select 1 from laps x
    where x.team_id = l.team_id and x.status = 'valid' and x.id <> l.id
      and (x.occurred_at, x.id) > (l.occurred_at, l.id)
  ) then
    perform set_config('app.auto_rotate', 'on', true);
    update teams set active_swimmer_id = l.swimmer_id
    where id = l.team_id and active_swimmer_id = next_swimmer(l.team_id, l.swimmer_id);
    perform set_config('app.auto_rotate', '', true);
  end if;

  perform set_config('app.audit_reason', p_reason, true);
  update laps
  set status = 'void', void_reason = p_reason, voided_by = auth.uid(), voided_at = clock_timestamp()
  where id = p_lap
  returning * into l;
  perform set_config('app.audit_reason', '', true);
  return l;
end;
$$;



-- ---------------------------------------------------------------------------
-- Correcciones del juez (siempre con motivo)
-- ---------------------------------------------------------------------------

create or replace function add_team_adjustment(
  p_team uuid, p_kind adjustment_kind, p_meters numeric, p_reason text
)
returns team_adjustments
language plpgsql security definer set search_path = public
as $$
declare
  t teams;
  a team_adjustments;
begin
  select * into t from teams where id = p_team;
  if not found then raise exception 'TEAM_NOT_FOUND'; end if;
  perform require_org_role(t.organization_id, array['admin', 'judge']::member_role[]);

  perform set_config('app.audit_reason', coalesce(p_reason, ''), true);
  insert into team_adjustments (event_id, team_id, organization_id, kind, meters, reason, created_by)
  values (t.event_id, t.id, t.organization_id, p_kind, p_meters, p_reason, auth.uid())
  returning * into a;
  perform set_config('app.audit_reason', '', true);
  return a;
end;
$$;

-- Alta de nadador con el roster cerrado (el caso "sumar a último momento").
create or replace function judge_add_swimmer(
  p_team uuid, p_name text, p_reason text,
  p_bib_number text default null, p_relay_order int default null
)
returns swimmers
language plpgsql security definer set search_path = public
as $$
declare
  t teams;
  v_locked boolean;
  s swimmers;
begin
  if p_reason is null or length(trim(p_reason)) = 0 then
    raise exception 'REASON_REQUIRED: el alta fuera de término requiere motivo';
  end if;

  select * into t from teams where id = p_team;
  if not found then raise exception 'TEAM_NOT_FOUND'; end if;
  perform require_org_role(t.organization_id, array['admin', 'judge']::member_role[]);

  select roster_locked_at is not null into v_locked from events where id = t.event_id;

  perform set_config('app.roster_override', 'on', true);
  perform set_config('app.audit_reason', p_reason, true);

  insert into swimmers (team_id, name, bib_number, relay_order, added_after_lock)
  values (p_team, p_name, p_bib_number, p_relay_order, v_locked)
  returning * into s;

  perform set_config('app.roster_override', '', true);
  perform set_config('app.audit_reason', '', true);
  return s;
end;
$$;

-- Baja/alta de un nadador (lesión, reemplazo) con el roster cerrado.
create or replace function judge_set_swimmer_active(p_swimmer uuid, p_active boolean, p_reason text)
returns swimmers
language plpgsql security definer set search_path = public
as $$
declare
  s swimmers;
begin
  if p_reason is null or length(trim(p_reason)) = 0 then
    raise exception 'REASON_REQUIRED: el cambio de roster requiere motivo';
  end if;

  select * into s from swimmers where id = p_swimmer;
  if not found then raise exception 'SWIMMER_NOT_FOUND'; end if;
  perform require_org_role(s.organization_id, array['admin', 'judge']::member_role[]);

  perform set_config('app.roster_override', 'on', true);
  perform set_config('app.audit_reason', p_reason, true);

  update swimmers set is_active = p_active where id = p_swimmer returning * into s;
  if not p_active then
    update teams set active_swimmer_id = null
    where id = s.team_id and active_swimmer_id = p_swimmer;
  end if;

  perform set_config('app.roster_override', '', true);
  perform set_config('app.audit_reason', '', true);
  return s;
end;
$$;

create or replace function require_reason(p_reason text)
returns void
language plpgsql immutable
as $$
begin
  if p_reason is null or length(trim(p_reason)) = 0 then
    raise exception 'REASON_REQUIRED: la corrección requiere motivo';
  end if;
end;
$$;

-- Pasada que el operador no marcó (toque olvidado). No aplica el anti doble
-- toque: la decide el juez. Debe caer dentro del tiempo del evento.
create or replace function judge_add_lap(
  p_team uuid, p_swimmer uuid, p_occurred_at timestamptz, p_reason text
)
returns laps
language plpgsql security definer set search_path = public
as $$
declare
  t teams;
  e events;
  l laps;
begin
  perform require_reason(p_reason);
  select * into t from teams where id = p_team;
  if not found then raise exception 'TEAM_NOT_FOUND'; end if;
  perform require_org_role(t.organization_id, array['admin', 'judge']::member_role[]);

  select * into e from events where id = t.event_id;
  if e.started_at is null then
    raise exception 'EVENT_NOT_STARTED: el evento está en %', e.status;
  end if;
  if p_occurred_at < e.started_at
     or p_occurred_at > least(clock_timestamp(), coalesce(case when e.status = 'paused' then e.paused_at end, event_ends_at(e))) then
    raise exception 'OUT_OF_RANGE: la hora de la pasada está fuera del tiempo del evento';
  end if;
  if not exists (select 1 from swimmers where id = p_swimmer and team_id = p_team) then
    raise exception 'SWIMMER_NOT_IN_TEAM: el nadador no pertenece al equipo';
  end if;

  perform set_config('app.audit_reason', p_reason, true);
  insert into laps (event_id, team_id, swimmer_id, organization_id, client_op_id,
                    occurred_at, recorded_by, source)
  values (t.event_id, p_team, p_swimmer, t.organization_id, gen_random_uuid(),
          p_occurred_at, auth.uid(), 'judge')
  returning * into l;
  perform set_config('app.audit_reason', '', true);
  return l;
end;
$$;

-- La pasada existió pero se le asignó al nadador equivocado.
create or replace function judge_reassign_lap(p_lap uuid, p_swimmer uuid, p_reason text)
returns laps
language plpgsql security definer set search_path = public
as $$
declare
  l laps;
begin
  perform require_reason(p_reason);
  select * into l from laps where id = p_lap for update;
  if not found then raise exception 'LAP_NOT_FOUND'; end if;
  perform require_org_role(l.organization_id, array['admin', 'judge']::member_role[]);
  if not exists (select 1 from swimmers where id = p_swimmer and team_id = l.team_id) then
    raise exception 'SWIMMER_NOT_IN_TEAM: el nadador no pertenece al equipo';
  end if;

  perform set_config('app.audit_reason', p_reason, true);
  update laps set swimmer_id = p_swimmer where id = p_lap returning * into l;
  perform set_config('app.audit_reason', '', true);
  return l;
end;
$$;

-- Vuelve a contar una pasada anulada por error.
create or replace function judge_restore_lap(p_lap uuid, p_reason text)
returns laps
language plpgsql security definer set search_path = public
as $$
declare
  l laps;
begin
  perform require_reason(p_reason);
  select * into l from laps where id = p_lap for update;
  if not found then raise exception 'LAP_NOT_FOUND'; end if;
  perform require_org_role(l.organization_id, array['admin', 'judge']::member_role[]);
  if l.status = 'valid' then
    return l;
  end if;

  perform set_config('app.audit_reason', p_reason, true);
  update laps
  set status = 'valid', void_reason = null, voided_by = null, voided_at = null
  where id = p_lap
  returning * into l;
  perform set_config('app.audit_reason', '', true);
  return l;
end;
$$;

-- Quita una penalización o ajuste cargado por error (el historial lo conserva).
create or replace function judge_remove_adjustment(p_adjustment uuid, p_reason text)
returns void
language plpgsql security definer set search_path = public
as $$
declare
  a team_adjustments;
begin
  perform require_reason(p_reason);
  select * into a from team_adjustments where id = p_adjustment for update;
  if not found then raise exception 'ADJUSTMENT_NOT_FOUND'; end if;
  perform require_org_role(a.organization_id, array['admin', 'judge']::member_role[]);

  perform set_config('app.audit_reason', p_reason, true);
  delete from team_adjustments where id = p_adjustment;
  perform set_config('app.audit_reason', '', true);
end;
$$;


-- ---------------------------------------------------------------------------
-- Usuarios de la organización
-- ---------------------------------------------------------------------------
-- Crear usuarios y cambiar contraseñas requiere la clave de servicio: lo hace
-- la Edge Function admin-users (supabase/functions). Las membresías las
-- escribe el propio administrador (RLS "admin manages members"), así quedan
-- auditadas con su nombre.

-- Solo para la Edge Function (service_role): busca un usuario por email.
create or replace function auth_user_id_by_email(p_email text)
returns uuid
language sql stable security definer set search_path = public, auth
as $$
  select id from auth.users where lower(email) = lower(trim(p_email)) limit 1;
$$;

-- Miembros de la organización con su email y último ingreso (solo admin).
create or replace function list_org_members(p_org uuid)
returns table (
  user_id uuid,
  email text,
  display_name text,
  role member_role,
  created_at timestamptz,
  last_sign_in_at timestamptz
)
language plpgsql stable security definer set search_path = public, auth
as $$
begin
  perform require_org_role(p_org, array['admin']::member_role[]);
  return query
    select m.user_id, u.email::text, m.display_name, m.role, m.created_at, u.last_sign_in_at
    from memberships m
    join auth.users u on u.id = m.user_id
    where m.organization_id = p_org
    order by m.role, coalesce(m.display_name, u.email::text);
end;
$$;

-- Nunca dejar una organización sin administrador.
create or replace function protect_last_admin()
returns trigger
language plpgsql security definer set search_path = public
as $$
begin
  if old.role = 'admin'
     and (tg_op = 'DELETE' or new.role <> 'admin')
     and not exists (
       select 1 from memberships
       where organization_id = old.organization_id and role = 'admin' and user_id <> old.user_id
     ) then
    raise exception 'LAST_ADMIN: la organización tiene que tener al menos un administrador';
  end if;
  return case when tg_op = 'DELETE' then old else new end;
end;
$$;

create trigger trg_memberships_last_admin
  before update or delete on memberships
  for each row execute function protect_last_admin();


-- ---------------------------------------------------------------------------
-- Vistas de resultados (respetan RLS de las tablas: security_invoker)
-- ---------------------------------------------------------------------------

-- Una fila por pasada válida, con número de pasada, parcial y acumulado.
-- split_seconds incluye el tiempo de una pausa si cayó dentro de esa pasada.
create view v_lap_splits with (security_invoker = true) as
select
  l.id as lap_id,
  l.event_id,
  l.team_id,
  l.swimmer_id,
  l.occurred_at,
  l.received_at,
  l.recorded_by,
  row_number() over w_team as lap_number,
  row_number() over (partition by l.team_id, l.swimmer_id order by l.occurred_at, l.id) as swimmer_lap_number,
  extract(epoch from l.occurred_at - coalesce(lag(l.occurred_at) over w_team, e.started_at)) as split_seconds,
  extract(epoch from l.occurred_at - e.started_at) - e.paused_seconds as elapsed_seconds,
  row_number() over w_team * e.pool_length_m as cumulative_meters,
  -- Toque que llegó bastante después de ocurrir: probablemente vino de la
  -- cola offline. No aplica a las pasadas que agrega el juez.
  l.source = 'device' and (l.received_at - l.occurred_at) > interval '5 seconds' as synced_late,
  -- device | judge (pasada agregada a mano por el juez).
  l.source
from laps l
join events e on e.id = l.event_id
where l.status = 'valid'
window w_team as (partition by l.team_id order by l.occurred_at, l.id);

-- Tabla de posiciones. Desempate: más metros de pasada incompleta (si la
-- política lo usa) y después quien completó su última pasada antes.
create view v_team_standings with (security_invoker = true) as
with lap_totals as (
  select team_id, count(*) as laps, max(occurred_at) as last_lap_at
  from laps
  where status = 'valid'
  group by team_id
),
adj as (
  select
    team_id,
    coalesce(sum(meters) filter (where kind = 'partial_lap'), 0) as partial_meters,
    coalesce(sum(meters) filter (where kind = 'penalty'), 0) as penalty_meters,
    coalesce(sum(meters) filter (where kind = 'manual'), 0) as manual_meters
  from team_adjustments
  group by team_id
),
totals as (
  select
    t.event_id,
    t.id as team_id,
    t.name as team_name,
    t.lane_number,
    t.color,
    t.active_swimmer_id,
    coalesce(lt.laps, 0) as laps,
    coalesce(lt.laps, 0) * e.pool_length_m as lap_meters,
    coalesce(a.partial_meters, 0) as partial_meters,
    coalesce(a.penalty_meters, 0) as penalty_meters,
    coalesce(a.manual_meters, 0) as manual_meters,
    coalesce(lt.laps, 0) * e.pool_length_m
      + coalesce(a.penalty_meters, 0)
      + coalesce(a.manual_meters, 0)
      + case when e.partial_lap_policy = 'proportional' then coalesce(a.partial_meters, 0) else 0 end
      as total_meters,
    case when e.partial_lap_policy = 'ignore' then 0 else coalesce(a.partial_meters, 0) end
      as tiebreak_meters,
    lt.last_lap_at
  from teams t
  join events e on e.id = t.event_id
  left join lap_totals lt on lt.team_id = t.id
  left join adj a on a.team_id = t.id
)
select
  totals.*,
  rank() over (
    partition by event_id
    order by total_meters desc, tiebreak_meters desc, last_lap_at asc nulls last
  ) as position
from totals;

-- Resumen por nadador para la pantalla de resultados.
create view v_swimmer_stats with (security_invoker = true) as
select
  s.id as swimmer_id,
  s.event_id,
  s.team_id,
  s.name,
  s.bib_number,
  s.relay_order,
  s.is_active,
  s.added_after_lock,
  count(v.lap_id) as laps,
  count(v.lap_id) * e.pool_length_m as meters,
  min(v.split_seconds) as best_split_seconds,
  avg(v.split_seconds) as avg_split_seconds
from swimmers s
join events e on e.id = s.event_id
left join v_lap_splits v on v.swimmer_id = s.id
group by s.id, e.pool_length_m;


-- ---------------------------------------------------------------------------
-- Seguridad: RLS + permisos
-- ---------------------------------------------------------------------------

alter table organizations enable row level security;
alter table memberships enable row level security;
alter table events enable row level security;
alter table teams enable row level security;
alter table swimmers enable row level security;
alter table lane_sessions enable row level security;
alter table laps enable row level security;
alter table team_adjustments enable row level security;
alter table audit_log enable row level security;

-- Organizaciones: las crea el equipo comercial con la service role.
create policy "org members read" on organizations
  for select using (has_org_role(id, array['admin', 'judge', 'operator']::member_role[]));

create policy "members read" on memberships
  for select using (has_org_role(organization_id, array['admin', 'judge', 'operator']::member_role[]));
create policy "admin manages members" on memberships
  for all
  using (has_org_role(organization_id, array['admin']::member_role[]))
  with check (has_org_role(organization_id, array['admin']::member_role[]));

create policy "events read" on events
  for select using (
    is_public or has_org_role(organization_id, array['admin', 'judge', 'operator']::member_role[])
  );
create policy "events insert" on events
  for insert with check (has_org_role(organization_id, array['admin', 'judge']::member_role[]));
create policy "events update" on events
  for update
  using (has_org_role(organization_id, array['admin', 'judge']::member_role[]))
  with check (has_org_role(organization_id, array['admin', 'judge']::member_role[]));
create policy "events delete draft" on events
  for delete using (status = 'draft' and has_org_role(organization_id, array['admin']::member_role[]));

create policy "teams read" on teams
  for select using (
    has_org_role(organization_id, array['admin', 'judge', 'operator']::member_role[])
    or exists (select 1 from events e where e.id = event_id and e.is_public)
  );
create policy "teams write" on teams
  for all
  using (has_org_role(organization_id, array['admin', 'judge']::member_role[]))
  with check (has_org_role(organization_id, array['admin', 'judge']::member_role[]));

create policy "swimmers read" on swimmers
  for select using (
    has_org_role(organization_id, array['admin', 'judge', 'operator']::member_role[])
    or exists (select 1 from events e where e.id = event_id and e.is_public)
  );
create policy "swimmers write" on swimmers
  for all
  using (has_org_role(organization_id, array['admin', 'judge']::member_role[]))
  with check (has_org_role(organization_id, array['admin', 'judge']::member_role[]));

create policy "lane sessions read" on lane_sessions
  for select using (has_org_role(organization_id, array['admin', 'judge', 'operator']::member_role[]));

create policy "laps read" on laps
  for select using (
    has_org_role(organization_id, array['admin', 'judge', 'operator']::member_role[])
    or exists (select 1 from events e where e.id = event_id and e.is_public)
  );

create policy "adjustments read" on team_adjustments
  for select using (
    has_org_role(organization_id, array['admin', 'judge', 'operator']::member_role[])
    or exists (select 1 from events e where e.id = event_id and e.is_public)
  );

create policy "audit read" on audit_log
  for select using (has_org_role(organization_id, array['admin', 'judge']::member_role[]));

-- Escrituras directas solo donde tiene sentido; lo demás pasa por funciones.
revoke insert, update, delete on laps, lane_sessions, team_adjustments, audit_log, organizations
  from anon, authenticated;
revoke insert, update, delete on events, teams, swimmers, memberships from anon;

-- Estado, reloj y roster_locked_at solo cambian vía start/pause/resume/finish.
revoke update on events from authenticated;
grant update (name, venue, event_date, pool_length_m, duration_seconds, min_lap_seconds,
              partial_lap_policy, is_public, auto_rotate)
  on events to authenticated;

-- active_swimmer_id solo cambia vía set_active_swimmer.
revoke update on teams from authenticated;
grant update (name, lane_number, color) on teams to authenticated;

revoke update on swimmers from authenticated;
grant update (name, bib_number, relay_order, is_active) on swimmers to authenticated;

-- El admin cambia rol y nombre; nunca el usuario ni la organización.
revoke update on memberships from authenticated;
grant update (role, display_name) on memberships to authenticated;

-- Supabase da EXECUTE a anon/authenticated por defecto: se quita todo y se
-- habilita solo lo necesario (write_audit, por ejemplo, nunca desde el cliente).
revoke execute on all functions in schema public from public, anon, authenticated;
grant execute on function server_now() to anon, authenticated;
grant execute on function event_ends_at(events) to anon, authenticated;
grant execute on function has_org_role(uuid, member_role[]) to anon, authenticated;
grant execute on function
  mark_event_ready(uuid),
  reopen_event_draft(uuid),
  start_event(uuid, boolean),
  pause_event(uuid, text),
  resume_event(uuid),
  finish_event(uuid),
  set_lane_ready(uuid, text),
  lane_heartbeat(uuid, text),
  set_active_swimmer(uuid, uuid),
  record_lap(uuid, uuid, uuid, timestamptz, text),
  void_lap(uuid, text),
  add_team_adjustment(uuid, adjustment_kind, numeric, text),
  judge_add_swimmer(uuid, text, text, text, int),
  judge_set_swimmer_active(uuid, boolean, text),
  judge_add_lap(uuid, uuid, timestamptz, text),
  judge_reassign_lap(uuid, uuid, text),
  judge_restore_lap(uuid, text),
  judge_remove_adjustment(uuid, text),
  list_org_members(uuid)
  to authenticated;
grant execute on function auth_user_id_by_email(text) to service_role;

grant select on v_lap_splits, v_team_standings, v_swimmer_stats to anon, authenticated;


-- ---------------------------------------------------------------------------
-- Realtime (marcador en vivo, panel del juez, pantallas de carril)
-- ---------------------------------------------------------------------------

alter table laps replica identity full;
alter table teams replica identity full;

do $$
declare
  t text;
begin
  foreach t in array array['events', 'teams', 'swimmers', 'laps', 'team_adjustments', 'lane_sessions'] loop
    begin
      execute format('alter publication supabase_realtime add table %I', t);
    exception when duplicate_object then null;
    end;
  end loop;
end $$;
