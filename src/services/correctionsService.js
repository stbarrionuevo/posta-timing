import { supabase } from '../lib/supabaseClient'

function unwrap({ data, error }) {
  if (error) throw error
  return data
}

const rpc = async (fn, args) => unwrap(await supabase.rpc(fn, args))

// Todo lo que necesita la pantalla de correcciones, además del bundle en vivo.
export async function fetchCorrectionsData(eventId, organizationId) {
  const [laps, splits, adjustments, audit, members] = await Promise.all([
    supabase
      .from('laps')
      .select('id, team_id, swimmer_id, occurred_at, received_at, recorded_by, device_id, source, status, void_reason')
      .eq('event_id', eventId)
      .order('occurred_at')
      .then(unwrap),
    supabase.from('v_lap_splits').select('lap_id, lap_number, split_seconds, synced_late').eq('event_id', eventId).then(unwrap),
    supabase.from('team_adjustments').select('*').eq('event_id', eventId).order('created_at').then(unwrap),
    supabase
      .from('audit_log')
      .select('id, actor_id, action, entity, entity_id, reason, before, after, created_at')
      .eq('event_id', eventId)
      .order('created_at', { ascending: false })
      .limit(1000)
      .then(unwrap),
    supabase.from('memberships').select('user_id, display_name, role').eq('organization_id', organizationId).then(unwrap),
  ])
  return { laps, splits, adjustments, audit, members }
}

export const voidLapAsJudge = (lapId, reason) => rpc('void_lap', { p_lap: lapId, p_reason: reason })
export const restoreLap = (lapId, reason) => rpc('judge_restore_lap', { p_lap: lapId, p_reason: reason })
export const reassignLap = (lapId, swimmerId, reason) =>
  rpc('judge_reassign_lap', { p_lap: lapId, p_swimmer: swimmerId, p_reason: reason })
export const addLapAsJudge = (teamId, swimmerId, occurredAt, reason) =>
  rpc('judge_add_lap', { p_team: teamId, p_swimmer: swimmerId, p_occurred_at: occurredAt, p_reason: reason })
export const addAdjustment = (teamId, kind, meters, reason) =>
  rpc('add_team_adjustment', { p_team: teamId, p_kind: kind, p_meters: meters, p_reason: reason })
export const removeAdjustment = (adjustmentId, reason) =>
  rpc('judge_remove_adjustment', { p_adjustment: adjustmentId, p_reason: reason })
