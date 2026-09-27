import { useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { useEventLive } from '../../hooks/useEventLive'
import { useServerClock } from '../../lib/serverClock'
import { getClockState } from '../../lib/eventClock'
import { friendlyError } from '../../lib/errors'
import { updateEventConfig } from '../../services/eventsService'
import TopBar from '../../components/TopBar'
import ClockCard from '../../components/ClockCard'
import LanesBoard from '../../components/LanesBoard'
import RosterCard from '../../components/RosterCard'
import ShareCard from '../../components/ShareCard'
import EventConfigForm from '../../components/EventConfigForm'
import Icon from '../../components/Icon'

export default function JudgePanel() {
  const { eventId } = useParams()
  const live = useEventLive(eventId)
  const sync = useServerClock()
  const [editingConfig, setEditingConfig] = useState(false)
  const [configError, setConfigError] = useState(null)

  if (!live.loaded) {
    return (
      <>
        <TopBar title="Evento" backTo="/juez" />
        <main className="page">
          {live.error ? (
            <div className="alert alert--danger">{friendlyError(live.error)}</div>
          ) : (
            <p className="muted">Cargando evento…</p>
          )}
        </main>
      </>
    )
  }

  const { event, teams, swimmers, laneSessions, standings } = live
  const clock = getClockState(event, sync.serverNow)
  // Rotación y marcador público se pueden cambiar con el evento en curso.
  const toggle = async (field) => {
    setConfigError(null)
    try {
      await updateEventConfig(event.id, { [field]: !event[field] })
      await live.reload()
    } catch (err) {
      setConfigError(err)
    }
  }

  const notReadyLanes = teams.filter(
    (t) => !laneSessions.some((s) => s.team_id === t.id && s.ready_at)
  )

  return (
    <>
      <TopBar
        title={event.name}
        subtitle={[event.event_date, event.venue].filter(Boolean).join(' · ')}
        backTo="/juez"
        liveStatus={live.liveStatus}
      >
        <Link to={`/juez/evento/${event.id}/checklist`} className="topbar__action">
          <Icon name="list-check" /> Checklist
        </Link>
        <Link to={`/juez/evento/${event.id}/correcciones`} className="topbar__action">
          <Icon name="clipboard-list" /> Correcciones y auditoría
        </Link>
      </TopBar>
      <main className="page page--wide">
        {live.error && (
          <div className="alert alert--warning">
            No se pudo actualizar: {friendlyError(live.error)}. Se reintenta automáticamente.
          </div>
        )}

        <div className="panel-grid">
          <div className="panel-grid__main">
            <ClockCard
              event={event}
              clock={clock}
              sync={sync}
              notReadyLanes={notReadyLanes}
              onChanged={live.reload}
            />
            <LanesBoard
              event={event}
              teams={teams}
              swimmers={swimmers}
              laneSessions={laneSessions}
              standings={standings}
              clock={clock}
              serverNow={sync.serverNow}
            />
          </div>

          <div className="panel-grid__side">
            <RosterCard event={event} teams={teams} swimmers={swimmers} onChanged={live.reload} />
            <ShareCard event={event} />

            <section className="card">
              <div className="card__head">
                <h2 className="card__title">
                  <Icon name="sliders" /> Configuración
                </h2>
                {event.status === 'draft' && !editingConfig && (
                  <button className="btn btn--ghost btn--small" onClick={() => setEditingConfig(true)}>
                    Editar
                  </button>
                )}
              </div>
              {configError && <div className="alert alert--danger">{friendlyError(configError)}</div>}
              {editingConfig ? (
                <EventConfigForm
                  initial={event}
                  submitLabel="Guardar"
                  onCancel={() => setEditingConfig(false)}
                  onSubmit={async (patch) => {
                    await updateEventConfig(event.id, patch)
                    setEditingConfig(false)
                    await live.reload()
                  }}
                />
              ) : (
                <dl className="config">
                  <dt>Duración</dt>
                  <dd>{event.duration_seconds / 60} min</dd>
                  <dt>Pileta</dt>
                  <dd>{event.pool_length_m} m</dd>
                  <dt>Anti doble toque</dt>
                  <dd>{event.min_lap_seconds} s</dd>
                  <dt>Pasada incompleta</dt>
                  <dd>
                    {{ ignore: 'No cuenta', proportional: 'Suma sus metros', tiebreak_only: 'Solo desempata' }[
                      event.partial_lap_policy
                    ]}
                  </dd>
                  <dt>Rotación de nadadores</dt>
                  <dd>
                    {event.auto_rotate ? 'Automática' : 'Manual'}{' '}
                    {event.status !== 'finished' && (
                      <button className="link-btn" onClick={() => toggle('auto_rotate')}>
                        cambiar
                      </button>
                    )}
                  </dd>
                  <dt>Marcador público</dt>
                  <dd>
                    {event.is_public ? 'Sí' : 'No'}{' '}
                    <button className="link-btn" onClick={() => toggle('is_public')}>
                      cambiar
                    </button>
                  </dd>
                </dl>
              )}
            </section>
          </div>
        </div>
      </main>
    </>
  )
}
