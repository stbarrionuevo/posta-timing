import Icon from './Icon'
import { getLaneAlerts } from '../lib/laneAlerts'

// Tablero en vivo de todos los carriles: posición, metros, nadador en el agua,
// estado del dispositivo y alertas.
export default function LanesBoard({ event, teams, swimmers, laneSessions, standings, clock, serverNow }) {
  const started = ['running', 'paused', 'finished'].includes(event.status)
  const standingByTeam = new Map(standings.map((s) => [s.team_id, s]))
  const swimmerById = new Map(swimmers.map((s) => [s.id, s]))

  const rows = teams
    .map((team) => {
      const standing = standingByTeam.get(team.id)
      const sessions = laneSessions.filter((s) => s.team_id === team.id)
      const lane = { sessions, laps: standing?.laps ?? 0, lastLapAt: standing?.last_lap_at }
      return {
        team,
        standing,
        sessions,
        activeSwimmer: swimmerById.get(team.active_swimmer_id),
        alerts: getLaneAlerts(event.status, lane, clock, serverNow),
      }
    })
    .sort((a, b) =>
      started
        ? (a.standing?.position ?? 99) - (b.standing?.position ?? 99) || a.team.lane_number - b.team.lane_number
        : a.team.lane_number - b.team.lane_number
    )

  const alertCount = rows.reduce((n, r) => n + r.alerts.filter((a) => a.level === 'danger').length, 0)

  return (
    <section className="card">
      <div className="card__head">
        <h2 className="card__title">
          <Icon name="water-ladder" /> Carriles
        </h2>
        {alertCount > 0 && (
          <span className="pill pill--danger">
            <Icon name="triangle-exclamation" /> {alertCount} alerta{alertCount !== 1 ? 's' : ''}
          </span>
        )}
      </div>

      {rows.length === 0 ? (
        <p className="empty">Todavía no hay equipos. Cargalos en el roster.</p>
      ) : (
        <div className="table-wrap">
          <table className="table lanes">
            <thead>
              <tr>
                {started && <th>Pos.</th>}
                <th>Carril</th>
                <th>Equipo</th>
                <th>En el agua</th>
                <th className="num">Pasadas</th>
                <th className="num">Metros</th>
                <th>Dispositivo</th>
              </tr>
            </thead>
            <tbody>
              {rows.map(({ team, standing, sessions, activeSwimmer, alerts }) => (
                <tr key={team.id} className={alerts.some((a) => a.level === 'danger') ? 'row--danger' : ''}>
                  {started && <td className="pos">{standing?.position ?? '—'}</td>}
                  <td>
                    <span className="lane-chip" style={team.color ? { background: team.color } : undefined}>
                      {team.lane_number}
                    </span>
                  </td>
                  <td>
                    <div className="strong">{team.name}</div>
                    {alerts.map((a) => (
                      <div key={a.code} className={`lane-alert lane-alert--${a.level}`}>
                        <Icon name={a.level === 'danger' ? 'circle-exclamation' : 'triangle-exclamation'} /> {a.text}
                      </div>
                    ))}
                  </td>
                  <td>{activeSwimmer ? activeSwimmer.name : <span className="muted">Sin asignar</span>}</td>
                  <td className="num">{standing?.laps ?? 0}</td>
                  <td className="num strong">
                    {Number(standing?.total_meters ?? 0)}
                    {Number(standing?.penalty_meters ?? 0) !== 0 && (
                      <div className="muted small">({Number(standing.penalty_meters)} pen.)</div>
                    )}
                  </td>
                  <td>
                    {sessions.length === 0 ? (
                      <span className="muted">—</span>
                    ) : sessions.some((s) => s.ready_at) ? (
                      <span className="ok">
                        <Icon name="circle-check" /> Listo
                      </span>
                    ) : (
                      <span className="warn">Conectado</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  )
}
