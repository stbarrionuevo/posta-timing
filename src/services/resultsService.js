import { supabase } from '../lib/supabaseClient'

function unwrap({ data, error }) {
  if (error) throw error
  return data
}

// Complemento del bundle en vivo para resultados: resumen por nadador y
// todas las pasadas válidas con su parcial.
export async function fetchResultsExtras(eventId) {
  const [stats, splits] = await Promise.all([
    supabase.from('v_swimmer_stats').select('*').eq('event_id', eventId).then(unwrap),
    supabase
      .from('v_lap_splits')
      .select('lap_id, team_id, swimmer_id, lap_number, split_seconds, cumulative_meters, occurred_at, source')
      .eq('event_id', eventId)
      .then(unwrap),
  ])
  return { stats, splits }
}
