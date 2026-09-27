import { useEffect, useRef, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { useEventLive } from '../../hooks/useEventLive'
import { useLaneDevice, useWakeLock } from '../../hooks/useLaneDevice'
import { useLapQueue, UNDO_WINDOW_MS } from '../../hooks/useLapQueue'
import { useServerClock } from '../../lib/serverClock'
import { formatClock, getClockState } from '../../lib/eventClock'
import { friendlyError } from '../../lib/errors'
import { beep } from '../../lib/beep'
import { displayedActiveId, nextSwimmerId, sortByRelayOrder } from '../../lib/swimmerOrder'
import { setActiveSwimmer, setLaneReady } from '../../services/lanesService'
import TopBar from '../../components/TopBar'
import Icon from '../../components/Icon'

// Rebote del dedo: dos toques a menos de esto son uno solo. El doble toque
// "real" (segundos) lo decide el servidor y queda auditado.
const BOUNCE_MS = 400
const SIGNAL_OK_MS = 12_000

export default function LaneOperator() {
  const { eventId, teamId } = useParams()
  const live = useEventLive(eventId, { teamId })
  const clockSync = useServerClock()
  const device = useLaneDevice(teamId, live.event?.status)
  const queue = useLapQueue(teamId, live.reload)
  useWakeLock(live.loaded && live.event.status !== 'finished')

  if (!live.loaded) {
    return (
      <>
        <TopBar title="Carril" backTo="/carril" />
        <main className="page">
          {live.error ? (
            <div className="alert alert--danger">{friendlyError(live.error)}</div>
          ) : (
            <p className="muted">Cargando carril…</p>
          )}
        </main>
      </>
    )
  }

  return <LaneScreen live={live} clockSync={clockSync} device={device} queue={queue} teamId={teamId} />
}

function LaneScreen({ live, clockSync, device, queue, teamId }) {
  const { event, teams, swimmers, laneSessions, standings, splits } = live
  const team = teams.find((t) => t.id === teamId)
  const [actionError, setActionError] = useState(null)
  const [choosingSwimmer, setChoosingSwimmer] = useState(false)
  // Último cambio local de nadador (rotación al tocar, elección manual,
  // deshacer) que el servidor todavía no confirmó en una lectura.
  const [cursor, setCursor] = useState(null)
  const lastTapAt = useRef(0)
  const clock = getClockState(event, clockSync.serverNow)

  const prevStatus = useRef(event.status)
  const prevTimeUp = useRef(clock.timeUp)
  useEffect(() => {
    if (prevStatus.current === 'ready' && event.status === 'running') beep({ frequency: 990, durationMs: 700 })
    if (prevStatus.current === 'running' && event.status === 'paused') beep({ frequency: 440 })
    if (prevStatus.current === 'paused' && event.status === 'running') beep({ frequency: 990 })
    prevStatus.current = event.status
  }, [event.status])
  useEffect(() => {
    if (clock.timeUp && !prevTimeUp.current) beep({ frequency: 660, times: 3 })
    prevTimeUp.current = clock.timeUp
  }, [clock.timeUp])

  const teamAll = swimmers.filter((s) => s.team_id === teamId)
  const teamSwimmers = sortByRelayOrder(teamAll.filter((s) => s.is_active))
  const activeId = displayedActiveId({
    serverActiveId: team?.active_swimmer_id,
    cursor,
    loadedFrom: live.loadedFrom,
    hasPending: queue.pending.length > 0,
  })
  const activeSwimmer = swimmers.find((s) => s.id === activeId)
  const nextId = teamSwimmers.length > 1 ? nextSwimmerId(teamAll, activeId) : null
  const nextSwimmer = swimmers.find((s) => s.id === nextId)
  const swimmerName = (id) => swimmers.find((s) => s.id === id)?.name ?? '—'

  const standing = standings.find((s) => s.team_id === teamId)
  const confirmedLaps = standing?.laps ?? 0
  const pendingCount = queue.pending.length
  const myReady = laneSessions.some((s) => s.team_id === teamId && s.device_id === device.deviceId && s.ready_at)
  // Hora local que ya avanza cada 250 ms (evita Date.now() en el render).
  const localNow = clockSync.serverNow - clockSync.offset
  const signalOk = device.lastOkAt && localNow - device.lastOkAt < SIGNAL_OK_MS

  const blockReason =
    event.status === 'ready' ? 'Esperando que el juez inicie'
    : event.status === 'paused' ? 'Evento en pausa'
    : event.status === 'finished' ? 'Evento finalizado'
    : clock.timeUp ? 'Tiempo cumplido'
    : !clockSync.hasOffset ? 'Sincronizando reloj…'
    : !activeSwimmer ? 'Elegí quién está en el agua'
    : null
  const canTap = event.status === 'running' && !blockReason

  const handleTap = () => {
    if (!canTap) return
    const now = Date.now()
    if (now - lastTapAt.current < BOUNCE_MS) return
    lastTapAt.current = now
    navigator.vibrate?.(60)
    queue.tap({ eventId: event.id, swimmer: activeSwimmer, occurredAt: clockSync.getServerNow(), deviceId: device.deviceId })
    // Misma regla que el servidor: el turno pasa al siguiente. Se aplica ya
    // en pantalla, aunque el toque todavía no haya salido.
    if (event.auto_rotate) setCursor({ swimmerId: nextSwimmerId(teamAll, activeSwimmer.id), at: now })
  }

  const run = async (fn) => {
    setActionError(null)
    try {
      await fn()
      await live.reload()
    } catch (err) {
      setActionError(err)
    }
  }

  const chooseSwimmer = (swimmerId) =>
    run(async () => {
      await setActiveSwimmer(teamId, swimmerId)
      setCursor({ swimmerId, at: Date.now() })
    })

  // Deshacer devuelve el turno al nadador de esa pasada.
  const undoTap = (tap) =>
    run(async () => {
      await queue.undo(tap)
      if (event.auto_rotate) setCursor({ swimmerId: tap.swimmerId, at: Date.now() })
    })

  if (!team) return <main className="page"><div className="alert alert--danger">Carril no encontrado.</div></main>

  const recent = [
    ...queue.pending
      .slice()
      .reverse()
      .map((p) => ({ key: p.clientOpId, pending: true, swimmer: swimmerName(p.swimmerId) })),
    ...(splits ?? []).map((s) => ({
      key: s.lap_id,
      lap: s.lap_number,
      swimmer: swimmerName(s.swimmer_id),
      split: Number(s.split_seconds),
    })),
  ].slice(0, 8)

  return (
    <div className={`lane-screen lane-screen--${event.status}`}>
      <TopBar
        title={
          <span className="lane-title">
            <span className="lane-chip" style={team.color ? { background: team.color } : undefined}>{team.lane_number}</span>
            {team.name}
          </span>
        }
        subtitle={event.name}
        backTo="/carril"
      >
        <Link to="/ayuda" className="topbar__back" aria-label="Manual del operador">
          <Icon name="circle-question" />
        </Link>
        <span className={`signal ${signalOk ? 'signal--ok' : 'signal--bad'}`}>
          <Icon name={signalOk ? 'wifi' : 'triangle-exclamation'} /> {signalOk ? 'Conectado' : 'Sin señal'}
        </span>
      </TopBar>

      <main className="lane-main">
        <div className={`lane-clock ${clock.timeUp ? 'lane-clock--up' : ''}`}>
          {formatClock(clock.remainingMs)}
        </div>

        {!signalOk && event.status !== 'finished' && (
          <div className="alert alert--warning">
            Sin conexión con el servidor. Seguí marcando: las pasadas se guardan en este celular y se envían al volver la señal.
          </div>
        )}
        {actionError && <div className="alert alert--danger">{friendlyError(actionError)}</div>}

        {event.status === 'ready' &&
          (myReady ? (
            <div className="ready-box ready-box--ok">
              <Icon name="circle-check" /> Carril listo. Esperando que el juez inicie.
            </div>
          ) : (
            <button
              className="btn btn--accent btn--big ready-btn"
              onClick={() => {
                beep({ frequency: 880, durationMs: 80 }) // habilita el audio del navegador
                run(() => setLaneReady(teamId, device.deviceId))
              }}
            >
              <Icon name="hand" /> CARRIL LISTO
            </button>
          ))}

        <section className="swimmer-box">
          <div className="swimmer-box__label">En el agua</div>
          <div key={activeId ?? 'none'} className={`swimmer-box__name ${activeSwimmer ? '' : 'swimmer-box__name--missing'}`}>
            {activeSwimmer ? activeSwimmer.name : 'Sin nadador'}
          </div>
          {event.auto_rotate && nextSwimmer && activeSwimmer && event.status !== 'finished' && (
            <div className="swimmer-box__next">
              <Icon name="rotate" /> Después de la pasada entra <strong>{nextSwimmer.name}</strong>
            </div>
          )}
          {event.status !== 'finished' && (
            <div className="swimmer-box__actions">
              {nextSwimmer && activeSwimmer && (
                <button
                  className={`btn ${event.auto_rotate ? 'btn--ghost' : 'btn--primary'}`}
                  onClick={() => chooseSwimmer(nextSwimmer.id)}
                >
                  <Icon name="right-left" /> {event.auto_rotate ? 'Saltear a' : 'Cambio:'} {nextSwimmer.name}
                </button>
              )}
              <button className="btn btn--ghost" onClick={() => setChoosingSwimmer((v) => !v)}>
                {activeSwimmer ? 'Elegir otro' : 'Elegir nadador'}
              </button>
            </div>
          )}
          {choosingSwimmer && (
            <div className="swimmer-picker">
              {teamSwimmers.map((s) => (
                <button
                  key={s.id}
                  className={`swimmer-option ${s.id === activeSwimmer?.id ? 'swimmer-option--active' : ''}`}
                  onClick={() => {
                    setChoosingSwimmer(false)
                    chooseSwimmer(s.id)
                  }}
                >
                  {s.relay_order && <span className="muted">{s.relay_order}.</span>} {s.name}
                </button>
              ))}
            </div>
          )}
        </section>

        <button
          className="lap-btn"
          disabled={!canTap}
          onPointerDown={(e) => {
            e.preventDefault()
            handleTap()
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ' ') {
              e.preventDefault()
              handleTap()
            }
          }}
        >
          {canTap ? (
            <>
              <span className="lap-btn__main">PASADA</span>
              <span className="lap-btn__sub">
                N.º {confirmedLaps + pendingCount + 1} · {activeSwimmer.name}
              </span>
            </>
          ) : (
            <span className="lap-btn__blocked">{blockReason}</span>
          )}
        </button>

        <TapFeedback tap={queue.lastTap} minLapSeconds={event.min_lap_seconds} onUndo={undoTap} />

        <section className="lane-stats">
          <div>
            <div className="lane-stats__value">{confirmedLaps + pendingCount}</div>
            <div className="lane-stats__label">Pasadas</div>
          </div>
          <div>
            <div className="lane-stats__value">{Number(standing?.total_meters ?? 0) + pendingCount * event.pool_length_m}</div>
            <div className="lane-stats__label">Metros</div>
          </div>
          <div>
            <div className="lane-stats__value">{standing?.position ?? '—'}</div>
            <div className="lane-stats__label">Posición</div>
          </div>
        </section>
        {pendingCount > 0 && (
          <div className="alert alert--warning">
            <Icon name="clock-rotate-left" /> {pendingCount} pasada{pendingCount !== 1 ? 's' : ''} guardada
            {pendingCount !== 1 ? 's' : ''} en este celular, enviando…
          </div>
        )}

        {queue.rejected.length > 0 && (
          <section className="card rejected">
            <div className="card__head">
              <h2 className="card__title">
                <Icon name="ban" /> No registradas
              </h2>
              <button className="btn btn--ghost btn--small" onClick={queue.clearRejected}>Ocultar</button>
            </div>
            <p className="hint">El servidor rechazó estos toques. Avisale al juez si alguno era una pasada real.</p>
            <ul className="lap-list">
              {queue.rejected.map((r) => (
                <li key={r.clientOpId}>
                  <span>{swimmerName(r.swimmerId)} · {new Date(r.occurredAt).toLocaleTimeString()}</span>
                  <span className="muted small">{friendlyError({ message: r.error })}</span>
                </li>
              ))}
            </ul>
          </section>
        )}

        {recent.length > 0 && (
          <section className="card">
            <h2 className="card__title">Últimas pasadas</h2>
            <ul className="lap-list">
              {recent.map((r) => (
                <li key={r.key} className={r.pending ? 'pending' : ''}>
                  <span className="strong">{r.pending ? <Icon name="clock" /> : `#${r.lap}`}</span>
                  <span>{r.swimmer}</span>
                  <span className="num">{r.pending ? 'enviando…' : `${r.split.toFixed(1)} s`}</span>
                </li>
              ))}
            </ul>
          </section>
        )}
      </main>
    </div>
  )
}

function TapFeedback({ tap, minLapSeconds, onUndo }) {
  const [now, setNow] = useState(() => tap?.tappedAt ?? 0)
  useEffect(() => {
    if (!tap) return
    const id = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(id)
  }, [tap])

  if (!tap) return null
  const age = Math.max(0, now - tap.tappedAt)
  // Margen de 3 s: el servidor corta a los 30 s desde que RECIBIÓ el toque.
  const canUndo = ['pending', 'recorded', 'duplicate'].includes(tap.outcome) && age < UNDO_WINDOW_MS - 3_000
  if (age > 60_000 && tap.outcome !== 'rejected') return null

  const view = {
    pending: { cls: 'info', icon: 'paper-plane', text: `Pasada de ${tap.swimmerName}: enviando…` },
    recorded: { cls: 'ok', icon: 'circle-check', text: `Pasada de ${tap.swimmerName} registrada` },
    duplicate: { cls: 'ok', icon: 'circle-check', text: `Pasada de ${tap.swimmerName} registrada` },
    too_soon: {
      cls: 'warn',
      icon: 'hand',
      text: `Doble toque ignorado: ya había una pasada hace menos de ${minLapSeconds} s`,
    },
    rejected: { cls: 'bad', icon: 'ban', text: `No registrada: ${friendlyError(tap.error)}` },
    undone: { cls: 'info', icon: 'rotate-left', text: 'Pasada deshecha' },
  }[tap.outcome]

  return (
    <div className={`tap-feedback tap-feedback--${view.cls}`}>
      <span>
        <Icon name={view.icon} /> {view.text}
      </span>
      {canUndo && (
        <button className="btn btn--ghost btn--small" onClick={() => onUndo(tap)}>
          <Icon name="rotate-left" /> Deshacer
        </button>
      )}
    </div>
  )
}
