-- 2026-09-28: rotación automática de nadador, rechazos auditados en el servidor
-- y correcciones del juez. Correr en el SQL Editor sobre una base que ya tiene
-- schema.sql + 2026-09-27_lane_heartbeat.sql.

alter table events add column if not exists auto_rotate boolean not null default true;
comment on column events.auto_rotate is
  'Cada pasada registrada pasa el turno al siguiente nadador del orden de relevo.';

alter table laps add column if not exists source text not null default 'device'
  check (source in ('device', 'judge'));

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

grant update (auto_rotate) on events to authenticated;

revoke execute on function
  next_swimmer(uuid, uuid),
  require_reason(text),
  judge_add_lap(uuid, uuid, timestamptz, text),
  judge_reassign_lap(uuid, uuid, text),
  judge_restore_lap(uuid, text),
  judge_remove_adjustment(uuid, text)
  from public, anon, authenticated;

grant execute on function
  judge_add_lap(uuid, uuid, timestamptz, text),
  judge_reassign_lap(uuid, uuid, text),
  judge_restore_lap(uuid, text),
  judge_remove_adjustment(uuid, text)
  to authenticated;
