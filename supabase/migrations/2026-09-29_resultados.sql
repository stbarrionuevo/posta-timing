-- 2026-09-29: v_lap_splits expone source (pasadas del juez) y synced_late
-- ignora las pasadas manuales. Correr en el SQL Editor.

-- Una fila por pasada válida, con número de pasada, parcial y acumulado.
-- split_seconds incluye el tiempo de una pausa si cayó dentro de esa pasada.
create or replace view v_lap_splits with (security_invoker = true) as
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
