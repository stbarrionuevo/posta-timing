import { supabase } from '../lib/supabaseClient'
import { createLapQueue } from '../lib/lapQueue'

function unwrap({ data, error }) {
  if (error) throw error
  return data
}

const rpc = async (fn, args) => unwrap(await supabase.rpc(fn, args))

// Eventos en los que un operador puede tomar un carril.
export async function fetchOperableEvents() {
  return unwrap(
    await supabase
      .from('events')
      .select('id, name, venue, event_date, status, organization_id')
      .in('status', ['ready', 'running', 'paused'])
      .order('event_date', { ascending: false })
  )
}

export async function fetchTeams(eventId) {
  return unwrap(
    await supabase.from('teams').select('id, name, lane_number, color').eq('event_id', eventId).order('lane_number')
  )
}

export async function fetchTeamSplits(teamId) {
  return unwrap(
    await supabase
      .from('v_lap_splits')
      .select('lap_id, swimmer_id, lap_number, swimmer_lap_number, split_seconds, occurred_at, recorded_by, synced_late')
      .eq('team_id', teamId)
      .order('lap_number', { ascending: false })
  )
}

export const setLaneReady = (teamId, deviceId) => rpc('set_lane_ready', { p_team: teamId, p_device_id: deviceId })
export const laneHeartbeat = (teamId, deviceId) => rpc('lane_heartbeat', { p_team: teamId, p_device_id: deviceId })
export const setActiveSwimmer = (teamId, swimmerId) =>
  rpc('set_active_swimmer', { p_team: teamId, p_swimmer: swimmerId })
export const voidLap = (lapId, reason) => rpc('void_lap', { p_lap: lapId, p_reason: reason })

// Una cola por navegador; sobrevive a recargar la página.
export const lapQueue = createLapQueue({
  storage: typeof localStorage !== 'undefined' ? localStorage : { getItem: () => null, setItem: () => {} },
  key: 'postas:lap-queue',
  send: (item) =>
    rpc('record_lap', {
      p_team: item.teamId,
      p_swimmer: item.swimmerId,
      p_client_op_id: item.clientOpId,
      p_occurred_at: item.occurredAt,
      p_device_id: item.deviceId,
    }),
})
