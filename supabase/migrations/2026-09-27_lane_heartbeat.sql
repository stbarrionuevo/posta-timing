-- 2026-09-27: lane_heartbeat crea la sesión si no existe (dispositivo de respaldo
-- con el evento en curso). Correr en el SQL Editor sobre una base con schema.sql.

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

revoke execute on function lane_heartbeat(uuid, text) from public, anon;
grant execute on function lane_heartbeat(uuid, text) to authenticated;
