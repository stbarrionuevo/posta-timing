import { supabase } from '../lib/supabaseClient'

function unwrap({ data, error }) {
  if (error) throw error
  return data
}

// --- Eventos ---

export async function fetchEvents(organizationId) {
  return unwrap(
    await supabase
      .from('events')
      .select('id, name, venue, event_date, status, pool_length_m, duration_seconds')
      .eq('organization_id', organizationId)
      .order('event_date', { ascending: false })
  )
}

export async function createEvent(organizationId, config) {
  return unwrap(
    await supabase
      .from('events')
      .insert({ organization_id: organizationId, ...config })
      .select()
      .single()
  )
}

export async function updateEventConfig(eventId, patch) {
  return unwrap(await supabase.from('events').update(patch).eq('id', eventId).select().single())
}

// Todo lo que necesita el panel del juez, en paralelo.
export async function fetchEventBundle(eventId) {
  const [event, teams, swimmers, laneSessions, standings] = await Promise.all([
    supabase.from('events').select('*').eq('id', eventId).single().then(unwrap),
    supabase.from('teams').select('*').eq('event_id', eventId).order('lane_number').then(unwrap),
    supabase
      .from('swimmers')
      .select('*')
      .eq('event_id', eventId)
      .order('relay_order', { nullsFirst: false })
      .order('created_at')
      .then(unwrap),
    supabase.from('lane_sessions').select('*').eq('event_id', eventId).then(unwrap),
    supabase.from('v_team_standings').select('*').eq('event_id', eventId).order('position').then(unwrap),
  ])
  return { event, teams, swimmers, laneSessions, standings }
}

// --- Reloj (funciones del servidor) ---

const rpc = async (fn, args) => unwrap(await supabase.rpc(fn, args))

export const markEventReady = (eventId) => rpc('mark_event_ready', { p_event: eventId })
export const reopenEventDraft = (eventId) => rpc('reopen_event_draft', { p_event: eventId })
export const startEvent = (eventId, force = false) =>
  rpc('start_event', { p_event: eventId, p_force: force })
export const pauseEvent = (eventId, reason) => rpc('pause_event', { p_event: eventId, p_reason: reason })
export const resumeEvent = (eventId) => rpc('resume_event', { p_event: eventId })
export const finishEvent = (eventId) => rpc('finish_event', { p_event: eventId })

// --- Roster ---

export async function createTeam(eventId, { name, laneNumber, color }) {
  return unwrap(
    await supabase
      .from('teams')
      .insert({ event_id: eventId, name, lane_number: laneNumber, color: color || null })
      .select()
      .single()
  )
}

export async function deleteTeam(teamId) {
  unwrap(await supabase.from('teams').delete().eq('id', teamId))
}

export async function createSwimmer(teamId, { name, bibNumber, relayOrder }) {
  return unwrap(
    await supabase
      .from('swimmers')
      .insert({
        team_id: teamId,
        name,
        bib_number: bibNumber || null,
        relay_order: relayOrder || null,
      })
      .select()
      .single()
  )
}

export async function deleteSwimmer(swimmerId) {
  unwrap(await supabase.from('swimmers').delete().eq('id', swimmerId))
}

// Con el roster cerrado (evento iniciado): siempre con motivo, queda auditado.
export const judgeAddSwimmer = (teamId, { name, bibNumber, relayOrder }, reason) =>
  rpc('judge_add_swimmer', {
    p_team: teamId,
    p_name: name,
    p_reason: reason,
    p_bib_number: bibNumber || null,
    p_relay_order: relayOrder || null,
  })

export const judgeSetSwimmerActive = (swimmerId, active, reason) =>
  rpc('judge_set_swimmer_active', { p_swimmer: swimmerId, p_active: active, p_reason: reason })

// --- Tiempo real ---

// Cualquier cambio del evento dispara onChange; el panel recarga el bundle.
export function subscribeToEvent(eventId, onChange, onStatus) {
  const filter = `event_id=eq.${eventId}`
  const channel = supabase
    .channel(`event-${eventId}`)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'events', filter: `id=eq.${eventId}` }, onChange)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'teams', filter }, onChange)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'swimmers', filter }, onChange)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'laps', filter }, onChange)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'lane_sessions', filter }, onChange)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'team_adjustments', filter }, onChange)
    .subscribe((status) => onStatus?.(status))
  return () => supabase.removeChannel(channel)
}

export async function fetchMembers(organizationId) {
  return unwrap(
    await supabase.from('memberships').select('user_id, display_name, role').eq('organization_id', organizationId)
  )
}
