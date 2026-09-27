import { useEffect, useRef, useState } from 'react'
import { useParams } from 'react-router-dom'
import { useEventLive } from '../../hooks/useEventLive'
import { useServerClock } from '../../lib/serverClock'
import { formatClock, getClockState } from '../../lib/eventClock'
import { formatDate } from '../../lib/format'
import { resultsUrl } from '../../lib/links'
import QrCode from '../../components/QrCode'
import Icon from '../../components/Icon'

// Muchos espectadores: cada pantalla relee como mucho cada 2 s.
const MIN_INTERVAL_MS = 2_000
const FLASH_MS = 1_200

const STATUS_TEXT = {
  draft: 'Próximamente',
  ready: 'Por largar',
  paused: 'En pausa',
}

// Filas que acaban de sumar metros, para resaltarlas un instante.
function useFlashingTeams(standings) {
  const previous = useRef(new Map())
  const [flashing, setFlashing] = useState(() => new Set())

  useEffect(() => {
    if (!standings) return
    const changed = standings
      .filter((s) => previous.current.has(s.team_id) && previous.current.get(s.team_id) !== Number(s.total_meters))
      .map((s) => s.team_id)
    previous.current = new Map(standings.map((s) => [s.team_id, Number(s.total_meters)]))
    if (changed.length === 0) return
    setFlashing(new Set(changed))
    const id = setTimeout(() => setFlashing(new Set()), FLASH_MS)
    return () => clearTimeout(id)
  }, [standings])

  return flashing
}

export default function Scoreboard() {
  const { eventId } = useParams()
  const live = useEventLive(eventId, { minIntervalMs: MIN_INTERVAL_MS })
  const sync = useServerClock()
  const flashing = useFlashingTeams(live.standings)

  if (!live.loaded) {
    return (
      <main className="board board--empty">
        {live.error ? <p>Este evento no está disponible o no es público.</p> : <p>Cargando marcador…</p>}
      </main>
    )
  }

  const { event, teams, swimmers, standings } = live
  const clock = getClockState(event, sync.serverNow)
  const started = event.status !== 'draft' && event.status !== 'ready'
  const swimmerName = (id) => swimmers.find((s) => s.id === id)?.name
  const standingByTeam = new Map(standings.map((s) => [s.team_id, s]))
  const rows = teams
    .map((t) => ({ team: t, standing: standingByTeam.get(t.id) }))
    .sort((a, b) =>
      started
        ? (a.standing?.position ?? 99) - (b.standing?.position ?? 99) || a.team.lane_number - b.team.lane_number
        : a.team.lane_number - b.team.lane_number
    )

  const toggleFullscreen = () => {
    if (document.fullscreenElement) document.exitFullscreen()
    else document.documentElement.requestFullscreen?.()
  }

  return (
    <main className={`board board--${event.status}`} style={{ '--rows': Math.max(rows.length, 4) }}>
      <header className="board__head">
        <div className="board__title">
          <h1>{event.name}</h1>
          <div className="board__sub">
            {[formatDate(event.event_date), event.venue, `${event.pool_length_m} m`].filter(Boolean).join(' · ')}
          </div>
        </div>
        <div className="board__clock-wrap">
          {event.status !== 'running' && event.status !== 'finished' && <div className="board__status">{STATUS_TEXT[event.status]}</div>}
          {event.status === 'finished' ? (
            <div className="board__clock board__clock--final">FINAL</div>
          ) : (
            <div className={`board__clock ${clock.timeUp ? 'board__clock--up' : ''} ${!clock.timeUp && event.status === 'running' && clock.remainingMs <= 60_000 ? 'board__clock--last' : ''}`}>
              {formatClock(clock.remainingMs)}
            </div>
          )}
        </div>
      </header>

      <ol className="board__rows">
        {rows.map(({ team, standing }) => {
          const pos = standing?.position
          const inWater = event.status === 'running' || event.status === 'paused' ? swimmerName(team.active_swimmer_id) : null
          return (
            <li
              key={team.id}
              className={`board__row ${flashing.has(team.id) ? 'board__row--flash' : ''} ${started && pos <= 3 ? `board__row--p${pos}` : ''}`}
            >
              <span className="board__pos">{started && pos ? pos : ''}</span>
              <span className="board__lane" style={team.color ? { background: team.color } : undefined}>
                {team.lane_number}
              </span>
              <span className="board__team">
                <span className="board__team-name">{team.name}</span>
                {inWater && (
                  <span className="board__swimmer">
                    <Icon name="person-swimming" /> {inWater}
                  </span>
                )}
              </span>
              <span className="board__laps">{started ? `${standing?.laps ?? 0} pas.` : ''}</span>
              <span className="board__meters">
                {Number(standing?.total_meters ?? 0)}
                <small> m</small>
              </span>
            </li>
          )
        })}
      </ol>

      <footer className="board__foot">
        <div className="board__qr">
          <QrCode value={resultsUrl(event.id)} size={72} />
          <span>
            Parciales de cada nadador
            <br />
            <strong>escaneá para ver los resultados</strong>
          </span>
        </div>
        <span className={`board__live board__live--${live.liveStatus}`}>
          <span className="live-dot" /> {live.liveStatus === 'connected' ? 'En vivo' : 'Reconectando…'}
        </span>
        <button className="board__fs" onClick={toggleFullscreen} aria-label="Pantalla completa">
          <Icon name="expand" />
        </button>
      </footer>
    </main>
  )
}
