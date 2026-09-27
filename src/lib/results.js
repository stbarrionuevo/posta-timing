import { sortByRelayOrder } from './swimmerOrder.js'

// Arma la vista de resultados: equipos por posición, cada uno con sus
// nadadores (resumen) y sus pasadas válidas en orden.
//   standings: v_team_standings · stats: v_swimmer_stats · splits: v_lap_splits
export function buildResults({ teams, swimmers, standings, stats, splits }) {
  const standingByTeam = new Map(standings.map((s) => [s.team_id, s]))
  const statsBySwimmer = new Map(stats.map((s) => [s.swimmer_id, s]))
  const swimmerById = new Map(swimmers.map((s) => [s.id, s]))

  return teams
    .map((team) => {
      const standing = standingByTeam.get(team.id) ?? null
      const teamSwimmers = sortByRelayOrder(swimmers.filter((s) => s.team_id === team.id)).map((s) => {
        const st = statsBySwimmer.get(s.id)
        return {
          ...s,
          laps: Number(st?.laps ?? 0),
          meters: Number(st?.meters ?? 0),
          bestSplit: st?.best_split_seconds != null ? Number(st.best_split_seconds) : null,
          avgSplit: st?.avg_split_seconds != null ? Number(st.avg_split_seconds) : null,
        }
      })
      const laps = splits
        .filter((l) => l.team_id === team.id)
        .sort((a, b) => a.lap_number - b.lap_number)
        .map((l) => ({
          id: l.lap_id,
          number: Number(l.lap_number),
          swimmerId: l.swimmer_id,
          swimmerName: swimmerById.get(l.swimmer_id)?.name ?? '—',
          occurredAt: l.occurred_at,
          split: Number(l.split_seconds),
          cumulativeMeters: Number(l.cumulative_meters),
          manual: l.source === 'judge',
        }))
      return { team, standing, swimmers: teamSwimmers, laps }
    })
    .sort((a, b) => {
      const pa = a.standing?.position ?? Infinity
      const pb = b.standing?.position ?? Infinity
      return pa - pb || a.team.lane_number - b.team.lane_number
    })
}

const normalize = (text) =>
  String(text ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .trim()

// Búsqueda de nadador sin distinguir acentos ni mayúsculas.
export function searchSwimmers(results, query) {
  const q = normalize(query)
  if (!q) return []
  return results.flatMap((r) =>
    r.swimmers
      .filter((s) => normalize(s.name).includes(q) || normalize(s.bib_number) === q)
      .map((s) => ({ swimmer: s, result: r }))
  )
}
