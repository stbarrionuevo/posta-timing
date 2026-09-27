import { useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useAuth } from '../../context/AuthContext'
import { fetchOperableEvents, fetchTeams } from '../../services/lanesService'
import { friendlyError } from '../../lib/errors'
import TopBar from '../../components/TopBar'
import StatusBadge from '../../components/StatusBadge'
import Icon from '../../components/Icon'

// Paso previo a operar: elegir evento y carril.
export default function LanePicker() {
  const { user, signOut } = useAuth()
  const navigate = useNavigate()
  const [events, setEvents] = useState(null)
  const [eventId, setEventId] = useState(null)
  const [teams, setTeams] = useState(null)
  const [error, setError] = useState(null)

  useEffect(() => {
    fetchOperableEvents()
      .then((rows) => {
        setEvents(rows)
        if (rows.length === 1) setEventId(rows[0].id)
      })
      .catch(setError)
  }, [])

  useEffect(() => {
    if (!eventId) return
    let cancelled = false
    fetchTeams(eventId)
      .then((rows) => !cancelled && setTeams(rows))
      .catch((err) => !cancelled && setError(err))
    return () => {
      cancelled = true
    }
  }, [eventId])

  const event = events?.find((e) => e.id === eventId)

  return (
    <>
      <TopBar title="Elegir carril" subtitle={user?.email}>
        <Link to="/ayuda" className="topbar__action">
          <Icon name="book" /> Manual
        </Link>
        <button className="topbar__action" onClick={signOut}>
          <Icon name="right-from-bracket" /> Salir
        </button>
      </TopBar>
      <main className="page">
        {error && <div className="alert alert--danger">{friendlyError(error)}</div>}
        {events === null && !error && <p className="muted">Cargando eventos…</p>}
        {events?.length === 0 && (
          <p className="empty">No hay eventos listos para largar. Esperá a que el juez confirme el roster.</p>
        )}

        {events && events.length > 0 && !event && (
          <section className="event-list">
            {events.map((ev) => (
              <button key={ev.id} className="card event-item event-item--button" onClick={() => setEventId(ev.id)}>
                <div>
                  <div className="strong">{ev.name}</div>
                  <div className="muted small">
                    {ev.event_date}
                    {ev.venue && ` · ${ev.venue}`}
                  </div>
                </div>
                <StatusBadge status={ev.status} />
              </button>
            ))}
          </section>
        )}

        {event && (
          <section className="card">
            <div className="card__head">
              <h2 className="card__title">{event.name}</h2>
              {events.length > 1 && (
                <button
                  className="btn btn--ghost btn--small"
                  onClick={() => {
                    setEventId(null)
                    setTeams(null)
                  }}
                >
                  Cambiar evento
                </button>
              )}
            </div>
            <p className="hint">¿Qué carril vas a controlar?</p>
            {teams === null ? (
              <p className="muted">Cargando carriles…</p>
            ) : (
              <div className="lane-grid">
                {teams.map((t) => (
                  <button
                    key={t.id}
                    className="lane-option"
                    style={t.color ? { borderColor: t.color } : undefined}
                    onClick={() => navigate(`/carril/${event.id}/${t.id}`)}
                  >
                    <span className="lane-chip lane-chip--big" style={t.color ? { background: t.color } : undefined}>
                      {t.lane_number}
                    </span>
                    <span className="strong">{t.name}</span>
                  </button>
                ))}
              </div>
            )}
          </section>
        )}
      </main>
    </>
  )
}
